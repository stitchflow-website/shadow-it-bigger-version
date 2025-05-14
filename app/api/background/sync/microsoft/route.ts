import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { updateCategorizationStatus } from '@/app/api/background/sync/categorize/route';

// Helper function to classify Microsoft Graph permissions by risk level
function classifyPermissionRisk(permission: string): 'high' | 'medium' | 'low' {
  // High risk permissions - full admin access or write permissions
  const highRiskPatterns = [
    'ReadWrite.All',
    'Write.All',
    '.ReadWrite',
    '.Write',
    'FullControl.All',
    'AccessAsUser.All',
    'Directory.ReadWrite',
    'Files.ReadWrite',
    'Mail.ReadWrite',
    'Mail.Send',
    'Group.ReadWrite',
    'User.ReadWrite',
    'Application.ReadWrite',
    'Sites.FullControl',
    'User.Export',
    'User.Invite',
    'User.ManageIdentities',
    'User.EnableDisableAccount',
    'DelegatedPermissionGrant.ReadWrite'
  ];

  // Medium risk permissions - read access to sensitive data
  const mediumRiskPatterns = [
    'Read.All',
    '.Read',
    'Directory.Read',
    'Files.Read',
    'User.Read.All',
    'Mail.Read',
    'AuditLog.Read',
    'Reports.Read',
    'Sites.Read'
  ];

  // Check for high risk first
  for (const pattern of highRiskPatterns) {
    if (permission.includes(pattern)) {
      return 'high';
    }
  }

  // Then check for medium risk
  for (const pattern of mediumRiskPatterns) {
    if (permission.includes(pattern)) {
      return 'medium';
    }
  }

  // Default to low risk
  return 'low';
}

interface Application {
  id: string;
  category?: string;
  organization_id: string;
  name: string;
  microsoft_app_id: string;
  risk_level?: string;
  management_status?: string;
  total_permissions: number;
  all_scopes: string[];
  user_count: number;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  let syncRecord: any = null;
  
  try {
    console.log('🔄 Starting Microsoft Entra ID sync process...');

    // Get pending sync record with status IN_PROGRESS
    const { data: syncRecords, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('status', 'IN_PROGRESS')
      .order('created_at', { ascending: false })
      .limit(1);

    console.log('📊 Sync records query result:', { 
      recordsFound: syncRecords?.length || 0, 
      hasError: !!syncError 
    });

    if (syncError) {
      console.error('❌ Error fetching sync records:', syncError);
      return NextResponse.json({ error: 'Failed to fetch sync records' }, { status: 500 });
    }

    if (!syncRecords || syncRecords.length === 0) {
      console.log('⚠️ No pending Microsoft sync records found');
      return NextResponse.json({ message: 'No pending sync records' });
    }

    syncRecord = syncRecords[0];
    console.log('✅ Found sync record to process:', {
      id: syncRecord.id,
      organization_id: syncRecord.organization_id,
      status: syncRecord.status
    });

    console.log(process.env.MICROSOFT_TENANT_ID)
    // Initialize Microsoft service with credentials
    console.log('🔑 Initializing Microsoft service...');

    const tenantId = process.env.MICROSOFT_TENANT_ID;
    if (!tenantId || tenantId === 'common') { // Also explicitly disallow 'common' for client secret flow
      console.error('❌ CRITICAL: MICROSOFT_TENANT_ID is not set or is invalid for background sync. Please provide a specific tenant ID.');
      // Optionally, update sync status to reflect this critical configuration error
      if (syncRecord?.id) {
        await updateSyncStatus(
          syncRecord.id,
          0,
          'Configuration error: MICROSOFT_TENANT_ID is missing or invalid for background sync.',
          'FAILED'
        );
      }
      return NextResponse.json({ error: 'Configuration error: MICROSOFT_TENANT_ID is missing for background sync.' }, { status: 500 });
    }

    const microsoftService = new MicrosoftWorkspaceService({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenant_id: tenantId // Use the validated tenantId
    });

    await microsoftService.setCredentials({
      access_token: syncRecord.access_token,
      refresh_token: syncRecord.refresh_token
    });

    // Update sync status to indicate progress
    await updateSyncStatus(syncRecord.id, 10, 'Connected to Microsoft Entra ID...');

    // STEP 1: Fetch all users from Microsoft Entra ID
    console.log('👥 Fetching users from Microsoft Entra ID...');
    const users = await microsoftService.getUsersList();
    console.log(`✅ Successfully fetched ${users.length} users from Microsoft Entra ID`);
    
    // Update progress
    await updateSyncStatus(syncRecord.id, 30, `Found ${users.length} users in your organization...`);

    // Store users in database
    console.log('💾 Storing users in database...');
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert(
        users.map((user: any) => ({
          organization_id: syncRecord.organization_id,
          microsoft_user_id: user.id,
          email: user.mail || user.userPrincipalName,
          name: user.displayName,
          role: user.jobTitle || 'User',
          created_at: user.createdDateTime || new Date().toISOString(),
          department: user.department,
          updated_at: new Date().toISOString()
        }))
      );

    if (usersError) {
      console.error('❌ Error storing users:', usersError);
      throw usersError;
    }
    console.log('✅ Successfully stored users in database');

    // STEP 2: Fetch OAuth tokens (applications and permissions)
    await updateSyncStatus(syncRecord.id, 50, 'Discovering applications and permissions...');
    
    console.log('🔍 Fetching OAuth application tokens...');
    const tokens = await microsoftService.getOAuthTokens();
    console.log(`✅ Successfully fetched ${tokens.length} application tokens`);
    
    // Log some sample token data for debugging
    if (tokens.length > 0) {
      console.log('📝 Sample token data structure:', JSON.stringify(tokens[0], null, 2));
    }

    await updateSyncStatus(syncRecord.id, 70, `Processing ${tokens.length} application connections...`);

    // Process applications and user permissions
    console.log('⚙️ Processing applications and user permissions...');
    
    // Track unique applications and their users with scopes
    const processedApps = new Map();
    const userAppScopes = new Map(); // Map to track user-app pairs and their scopes
    const processedUserApps = new Set(); // Track unique user-app combinations

    // First pass: Group tokens by app and collect all users with their scopes
    for (const token of tokens) {
      if (!token.clientId || !token.userEmail) {
        console.log('⚠️ Skipping invalid token:', token);
        continue;
      }
      
      const appId = token.clientId;
      const userAppKey = `${token.userEmail}-${appId}`;
      
      // Skip if we've already processed this user-app combination
      if (processedUserApps.has(userAppKey)) {
        console.log(`⚠️ Skipping duplicate user-app combination: ${userAppKey}`);
        continue;
      }
      
      processedUserApps.add(userAppKey);
      
      // Initialize or update user-app scopes
      if (!userAppScopes.has(userAppKey)) {
        console.log(`📝 Creating new user-app mapping: ${userAppKey}`);
        userAppScopes.set(userAppKey, {
          userEmail: token.userEmail,
          appId: appId,
          scopes: new Set()
        });
      }
      
      // Add all scopes (including admin and user consented)
      const userApp = userAppScopes.get(userAppKey);
      let scopeCount = 0;
      token.scopes?.forEach(scope => {
        userApp.scopes.add(scope);
        scopeCount++;
      });
      token.adminScopes?.forEach(scope => {
        userApp.scopes.add(scope);
        scopeCount++;
      });
      token.userScopes?.forEach(scope => {
        userApp.scopes.add(scope);
        scopeCount++;
      });
      token.appRoleScopes?.forEach(scope => {
        userApp.scopes.add(scope);
        scopeCount++;
      });

      console.log(`📊 Added ${scopeCount} scopes for ${userAppKey}`);

      // Track unique applications
      if (!processedApps.has(appId)) {
        processedApps.set(appId, {
          id: appId,
          displayText: token.displayText,
          userCount: 0,
          allScopes: new Set()
        });
      }
      
      // Update app scopes
      const app = processedApps.get(appId);
      token.scopes?.forEach(scope => app.allScopes.add(scope));
      token.adminScopes?.forEach(scope => app.allScopes.add(scope));
      token.userScopes?.forEach(scope => app.allScopes.add(scope));
      token.appRoleScopes?.forEach(scope => app.allScopes.add(scope));
    }

    // Second pass: Process each application
    for (const [appId, appInfo] of processedApps) {
      try {
        console.log(`🔍 Processing application: ${appInfo.displayText} (${appId})`);
        // Find if app already exists
        const { data: existingApp } = await supabaseAdmin
          .from('applications')
          .select('*')
          .eq('microsoft_app_id', appId)
          .eq('organization_id', syncRecord.organization_id)
          .single() as { data: Application | null };

        const allAppScopes = Array.from(appInfo.allScopes);
        console.log(`📊 App ${appInfo.displayText || appId} has ${allAppScopes.length} unique scopes`);

        // Determine risk level based on permissions
        let riskLevel = 'LOW';
        const highRiskScopes = allAppScopes.filter(scope => classifyPermissionRisk(scope as string) === 'high');
        const mediumRiskScopes = allAppScopes.filter(scope => classifyPermissionRisk(scope as string) === 'medium');
        
        if (highRiskScopes.length > 0) {
          riskLevel = 'HIGH';
          console.log(`⚠️ Setting HIGH risk level for ${appInfo.displayText || appId} due to ${highRiskScopes.length} high-risk permissions`);
        } else if (mediumRiskScopes.length > 0) {
          riskLevel = 'MEDIUM';
          console.log(`⚠️ Setting MEDIUM risk level for ${appInfo.displayText || appId} due to ${mediumRiskScopes.length} medium-risk permissions`);
        }

        // Store application data
        const { data: newApp, error: appError } = await supabaseAdmin
          .from('applications')
          .upsert({
            id: existingApp?.id,
            organization_id: syncRecord.organization_id,
            name: appInfo.displayText || 'Unknown App',
            microsoft_app_id: appId,
            category: existingApp?.category || 'uncategorized',
            risk_level: existingApp?.risk_level || riskLevel,
            management_status: existingApp?.management_status || 'NEEDS_REVIEW',
            total_permissions: allAppScopes.length,
            all_scopes: allAppScopes,
            user_count: Array.from(userAppScopes.values()).filter(ua => ua.appId === appId).length,
            updated_at: new Date().toISOString()
          } as Application)
          .select()
          .single();

        if (appError) {
          console.error(`❌ Error storing application ${appId}:`, appError);
          continue;
        }

        // Create user-application relationships
        const appUsers = Array.from(userAppScopes.values()).filter(ua => ua.appId === appId);
        for (const userApp of appUsers) {
          await createUserAppRelationship(newApp.id, {
            userEmail: userApp.userEmail,
            scopes: Array.from(userApp.scopes)
          }, syncRecord.organization_id);
        }

        // Handle categorization if needed
        if (!existingApp?.category || existingApp.category === 'uncategorized' || existingApp.category === 'Unknown' || existingApp.category === 'Others') {
          console.log(`🏷️ App ${appInfo.displayText || appId} needs categorization`);
          try {
            // Create a categorization status record
            const { data: statusRecord, error: statusError } = await supabaseAdmin
              .from('categorization_status')
              .insert({
                organization_id: syncRecord.organization_id,
                status: 'PENDING',
                progress: 0,
                message: 'Initializing categorization process',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();

            if (statusError) {
              console.error('❌ Error creating categorization status record:', statusError);
            } else if (statusRecord) {
              console.log(`✅ Created categorization status record ${statusRecord.id}`);
              // Start categorization in the background
              const categorizeModule = await import('../categorize/route');
              (categorizeModule as any).categorizeApplications(syncRecord.organization_id, statusRecord.id).catch((error: Error) => {
                console.error('❌ Background categorization failed:', error);
                updateCategorizationStatus(
                  statusRecord.id,
                  0,
                  `Categorization failed: ${error.message}`,
                  'FAILED'
                ).catch(err => {
                  console.error('❌ Error updating categorization status:', err);
                });
              });
            }
          } catch (categorizationError) {
            console.error('❌ Error initiating categorization:', categorizationError);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing application ${appId}:`, error);
        continue;
      }
    }

    // Update sync status for categorization
    await updateSyncStatus(syncRecord.id, 85, 'Categorizing applications...');

    // Trigger categorization
    console.log('🔄 Triggering application categorization...');
    try {
      const categorizationResponse = await fetch(`${request.nextUrl.origin}/tools/shadow-it-scan/api/background/sync/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id: syncRecord.organization_id,
          sync_id: syncRecord.id
        }),
      });

      if (!categorizationResponse.ok) {
        console.error('❌ Failed to trigger categorization:', await categorizationResponse.text());
      } else {
        console.log('✅ Successfully triggered categorization');
      }
    } catch (error) {
      console.error('❌ Error triggering categorization:', error);
    }

    // Mark sync as completed
    await updateSyncStatus(syncRecord.id, 100, 'Microsoft Entra ID sync completed', 'COMPLETED');

    console.log('🎉 Microsoft sync completed successfully');
    return NextResponse.json({ 
      success: true, 
      message: 'Microsoft Entra ID sync completed',
      sync_id: syncRecord.id,
      organization_id: syncRecord.organization_id
    });
  } catch (error) {
    console.error('❌ Microsoft sync error:', error);
    
    // Update sync status to failed
    if (syncRecord?.id) {
      await updateSyncStatus(
        syncRecord.id, 
        0, 
        'Microsoft sync failed: ' + (error as Error).message,
        'FAILED'
      );
    }
      
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

// Helper function to update sync status
async function updateSyncStatus(
  syncId: string, 
  progress: number, 
  message: string, 
  status: string = 'IN_PROGRESS'
) {
  console.log(`📊 Updating sync status: ${progress}% - ${message}`);
  
  try {
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress,
        message,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', syncId);
  } catch (error) {
    console.error('❌ Error updating sync status:', error);
  }
}

// Helper function to create user-application relationship with scopes
async function createUserAppRelationship(appId: string, token: any, organizationId: string) {
  try {
    // Get user by email or Microsoft user ID using proper parameterized query
    let { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('organization_id', organizationId)
      .or(`email.eq."${token.userEmail}",microsoft_user_id.eq."${token.userKey}"`)
      .single();

    if (userError) {
      console.error('❌ Error finding user:', userError);
      return;
    }

    if (!userData) {
      console.log(`⚠️ No user found for email: ${token.userEmail}. Creating new user record.`);
      
      // Create user if they don't exist
      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          organization_id: organizationId,
          microsoft_user_id: token.userKey,
          email: token.userEmail,
          name: token.userEmail.split('@')[0],
          role: 'User',
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (createError) {
        console.error('❌ Error creating user:', createError);
        return;
      }
      
      userData = newUser;
    }

    // First, check if there's an existing relationship we need to update
    const { data: existingRelationship, error: relationshipQueryError } = await supabaseAdmin
      .from('user_applications')
      .select('id, scopes')
      .eq('user_id', userData.id)
      .eq('application_id', appId)
      .single();

    // Store the user-application relationship with permissions (scopes)
    console.log(`📝 Storing permissions for user ${token.userEmail} and app ${token.displayText || appId}`);
    console.log(`   Scopes: ${token.scopes ? JSON.stringify(token.scopes) : 'None'}`);
    
    if (existingRelationship) {
      console.log(`   ℹ️ Found existing relationship, updating scopes`);
      // Merge existing scopes with new scopes to avoid duplicates
      const existingScopes = existingRelationship.scopes || [];
      const mergedScopes = [...new Set([...existingScopes, ...(token.scopes || [])])];
      
      const { error: updateError } = await supabaseAdmin
        .from('user_applications')
        .update({
          scopes: mergedScopes,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingRelationship.id);

      if (updateError) {
        console.error('❌ Error updating user-application relationship:', updateError);
      } else {
        console.log(`✅ Successfully updated app-user relationship with ${mergedScopes.length} permissions`);
      }
    } else {
      console.log(`   ℹ️ Creating new user-application relationship`);
      // Create new relationship
      const { error: insertError } = await supabaseAdmin
        .from('user_applications')
        .upsert({
          user_id: userData.id,
          application_id: appId,
          scopes: token.scopes || [],
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,application_id',
          ignoreDuplicates: true
        });

      if (insertError) {
        console.error('❌ Error creating user-application relationship:', insertError);
        console.error('   Details:', insertError.details);
        console.error('   Message:', insertError.message);
      } else {
        console.log(`✅ Successfully created app-user relationship with ${token.scopes?.length || 0} permissions`);
      }
    }
  } catch (error) {
    console.error('❌ Error in createUserAppRelationship:', error);
  }
} 