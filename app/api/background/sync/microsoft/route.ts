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

async function sendSyncCompletedEmail(userEmail: string, syncId?: string) {
  const transactionalId = process.env.LOOPS_TRANSACTIONAL_ID_SYNC_COMPLETED;
  const loopsApiKey = process.env.LOOPS_API_KEY;

  if (!transactionalId) {
    console.error(`[Microsoft Sync ${syncId || ''}] LOOPS_TRANSACTIONAL_ID_SYNC_COMPLETED is not set. Cannot send email.`);
    return;
  }
  if (!loopsApiKey) {
    console.warn(`[Microsoft Sync ${syncId || ''}] LOOPS_API_KEY is not set. Email might not send if API key is required.`);
    // Depending on Loops API, you might want to return here if key is strictly required
  }
  if (!userEmail) {
    console.error(`[Microsoft Sync ${syncId || ''}] User email is not available. Cannot send completion email.`);
    return;
  }

  try {
    const response = await fetch('https://app.loops.so/api/v1/transactional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${loopsApiKey}`,
      },
      body: JSON.stringify({
        transactionalId: transactionalId,
        email: userEmail,
      }),
    });

    if (response.ok) {
      const responseData = await response.json();
      console.log(`[Microsoft Sync ${syncId || ''}] Sync completed email sent successfully to ${userEmail}:`, responseData);
    } else {
      const errorData = await response.text();
      console.error(`[Microsoft Sync ${syncId || ''}] Failed to send sync completed email to ${userEmail}. Status: ${response.status}, Response: ${errorData}`);
    }
  } catch (error) {
    console.error(`[Microsoft Sync ${syncId || ''}] Error sending sync completed email to ${userEmail}:`, error);
  }
}

// Helper function to create user-application relationships in batches
async function createUserAppRelationships(appId: string, userTokens: any[], organizationId: string) {
  try {
    // Skip if no tokens to process
    if (userTokens.length === 0) return;
    
    // Get all users by email in one query
    const userEmails = userTokens.map(t => t.userEmail).filter(Boolean);
    if (userEmails.length === 0) return;
    
    const { data: existingUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('organization_id', organizationId)
      .in('email', userEmails);
    
    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }
    
    // Create a map for quick lookups
    const userEmailToId = new Map();
    existingUsers?.forEach(user => {
      userEmailToId.set(user.email, user.id);
    });
    
    // Find emails not in the database
    const missingUserEmails = userEmails.filter(email => !userEmailToId.has(email));
    
    // Insert missing users in a batch if needed
    if (missingUserEmails.length > 0) {
      const newUsers = missingUserEmails.map(email => ({
        organization_id: organizationId,
        email: email,
        name: email.split('@')[0],
        role: 'User',
        updated_at: new Date().toISOString()
      }));
      
      const { data: insertedUsers, error: insertError } = await supabaseAdmin
        .from('users')
        .insert(newUsers)
        .select('id, email');
        
      if (insertError) {
        console.error('❌ Error creating users in batch:', insertError);
      } else if (insertedUsers) {
        // Add newly inserted users to our map
        insertedUsers.forEach(user => {
          userEmailToId.set(user.email, user.id);
        });
      }
    }
    
    // Get existing relationships in one query
    const userIds = Array.from(userEmailToId.values());
    const { data: existingRelationships, error: relationshipsError } = await supabaseAdmin
      .from('user_applications')
      .select('id, user_id, scopes')
      .eq('application_id', appId)
      .in('user_id', userIds);
      
    if (relationshipsError) {
      console.error('❌ Error fetching relationships:', relationshipsError);
    }
    
    // Create map of existing relationships
    const existingRelationshipsMap = new Map();
    existingRelationships?.forEach(rel => {
      existingRelationshipsMap.set(rel.user_id, { id: rel.id, scopes: rel.scopes || [] });
    });
    
    // Prepare batch operations
    const toUpdate = [];
    const toInsert = [];
    
    // Process each token
    for (const token of userTokens) {
      const userId = userEmailToId.get(token.userEmail);
      if (!userId) continue;
      
      const scopes = token.scopes || [];
      const existing = existingRelationshipsMap.get(userId);
      
      if (existing) {
        // Merge scopes for existing relationship
        const mergedScopes = [...new Set([...existing.scopes, ...scopes])];
        toUpdate.push({
          id: existing.id,
          scopes: mergedScopes,
          updated_at: new Date().toISOString()
        });
      } else {
        // New relationship
        toInsert.push({
          user_id: userId,
          application_id: appId,
          scopes: scopes,
          updated_at: new Date().toISOString()
        });
      }
    }
    
    // Execute batch operations
    if (toUpdate.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('user_applications')
        .upsert(toUpdate);
        
      if (updateError) {
        console.error('❌ Error batch updating user-application relationships:', updateError);
      }
    }
    
    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('user_applications')
        .insert(toInsert);
        
      if (insertError) {
        console.error('❌ Error batch inserting user-application relationships:', insertError);
      }
    }
    
    console.log(`✅ Processed ${userTokens.length} user-application relationships for app ${appId}`);
  } catch (error) {
    console.error('❌ Error in batch relationship processing:', error);
  }
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

    console.log("tenant_id before init microsoft service", process.env.MICROSOFT_TENANT_ID)

    // Initialize Microsoft service with credentials
    console.log('🔑 Initializing Microsoft service...');
    const microsoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: process.env.MICROSOFT_TENANT_ID!
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
      
      // Make sure this represents a valid user-app assignment
      // We only want to track users who actually have access to the app
      if (!token.scopes || token.scopes.length === 0) {
        console.log(`⚠️ Skipping token with no scopes for ${userAppKey}`);
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

    // Process applications in parallel for better performance
    await updateSyncStatus(syncRecord.id, 75, `Processing ${processedApps.size} applications in parallel...`);
    
    // Convert Map to array for parallel processing
    const appEntries = Array.from(processedApps.entries());
    
    // Track apps that need categorization
    const needsCategorization = { count: 0 };

    // Process in batches of 10 to avoid overwhelming the database
    const BATCH_SIZE = 10;
    for (let i = 0; i < appEntries.length; i += BATCH_SIZE) {
      const batch = appEntries.slice(i, i + BATCH_SIZE);
      
      // Process each batch in parallel
      await Promise.all(batch.map(async ([appId, appInfo]) => {
        try {
          // Find if app already exists
          const { data: existingApp } = await supabaseAdmin
            .from('applications')
            .select('*')
            .eq('microsoft_app_id', appId)
            .eq('organization_id', syncRecord.organization_id)
            .single() as { data: Application | null };

          const allAppScopes = Array.from(appInfo.allScopes);
          
          // Determine risk level based on permissions
          let riskLevel = 'LOW';
          // Aggregate scopes to determine risk level
          const highRiskScopes = allAppScopes.filter(scope => 
            typeof scope === 'string' && classifyPermissionRisk(scope) === 'high'
          );
          const mediumRiskScopes = allAppScopes.filter(scope => 
            typeof scope === 'string' && classifyPermissionRisk(scope) === 'medium'
          );
          
          if (highRiskScopes.length > 0) {
            riskLevel = 'HIGH';
          } else if (mediumRiskScopes.length > 0) {
            riskLevel = 'MEDIUM';
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
            return;
          }

          // Process user-application relationships in batches
          const appUsers = Array.from(userAppScopes.values())
            .filter(ua => ua.appId === appId)
            .map(userApp => ({
              userEmail: userApp.userEmail,
              scopes: Array.from(userApp.scopes)
            }));
            
          await createUserAppRelationships(newApp.id, appUsers, syncRecord.organization_id);

          // Track if app needs categorization without creating individual records
          if (!existingApp?.category || existingApp.category === 'uncategorized' || existingApp.category === 'Unknown' || existingApp.category === 'Others') {
            needsCategorization.count++;
          }
        } catch (error) {
          console.error(`❌ Error processing application ${appId}:`, error);
        }
      }));
      
      // Update progress as we go through batches
      const progress = 75 + Math.floor((i / appEntries.length) * 10);
      await updateSyncStatus(syncRecord.id, progress, `Processed ${Math.min(i + BATCH_SIZE, appEntries.length)} of ${appEntries.length} applications...`);
    }

    // Update sync status for categorization
    await updateSyncStatus(syncRecord.id, 90, `Finalizing sync... ${needsCategorization.count} apps need categorization`);

    // Only trigger categorization if apps need it, and do it safely with proper error handling
    if (needsCategorization.count > 0) {
      console.log(`🔄 Triggering application categorization for ${needsCategorization.count} apps...`);
      try {
        // We'll await this operation to ensure categorization is properly triggered
        // but we won't wait for the actual categorization to complete
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

        const categorizationResult = await categorizationResponse.json();
        
        if (!categorizationResponse.ok) {
          console.error('❌ Failed to trigger categorization:', categorizationResult);
        } else {
          console.log('✅ Successfully triggered categorization:', categorizationResult);
        }
      } catch (error) {
        // Log but don't fail the overall sync
        console.error('❌ Error triggering categorization:', error);
      }
    } else {
      console.log('⏭️ No apps need categorization, skipping categorization step');
    }

    // Mark sync as completed
    await updateSyncStatus(syncRecord.id, 100, 'Microsoft Entra ID sync completed', 'COMPLETED');

    // Send email in the background without awaiting the result
    if (syncRecord.user_email) {
      // Create a detached promise that handles its own errors
      (async () => {
        try {
          await sendSyncCompletedEmail(syncRecord.user_email, syncRecord.id);
          console.log(`✅ Email notification sent successfully to ${syncRecord.user_email}`);
        } catch (error) {
          console.error(`❌ Error sending completion email: ${error}`);
        }
      })();
    }

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
  console.log(`📊 Updating sync status for ${syncId}: ${progress}% - ${message} - ${status}`);
  
  try {
    const { error } = await supabaseAdmin
      .from('sync_status')
      .update({
        progress,
        message,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', syncId);

    if (error) {
      console.error(`❌ Error updating sync status in Supabase for ${syncId}:`, error);
    }
  } catch (error) {
    console.error('❌ Error updating sync status:', error);
  }
} 