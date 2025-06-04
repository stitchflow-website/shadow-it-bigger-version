import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { updateCategorizationStatus } from '@/app/api/background/sync/categorize/route';

// Configuration optimized for 1 CPU + 2GB RAM - Balanced for speed vs stability
const PROCESSING_CONFIG = {
  MAX_CONCURRENT_OPERATIONS: 1, // Sequential processing only for single CPU
  BATCH_SIZE: 5, // Increased from 3 for better throughput
  DELAY_BETWEEN_BATCHES: 175, // Reduced from 250ms for faster processing
  MAX_APPS_PER_BATCH: 25, // Increased from 15 for better throughput
  DB_OPERATION_DELAY: 75, // Reduced from 100ms for faster operations
  USER_BATCH_SIZE: 25, // Increased from 15 for better throughput
  MEMORY_CLEANUP_INTERVAL: 40, // Increased from 25 for better speed
};

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to process in controlled batches with proper error handling
async function processInBatches<T>(
  items: T[], 
  processor: (batch: T[]) => Promise<void>,
  batchSize: number = PROCESSING_CONFIG.BATCH_SIZE,
  delay: number = PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    try {
      await processor(batch);
    } catch (error) {
      console.error(`Error processing batch ${i / batchSize + 1}:`, error);
      // Continue with next batch instead of failing completely
    }
    
    // Add delay between batches to prevent overwhelming the system
    if (i + batchSize < items.length) {
      await sleep(delay);
    }
  }
}

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
    
    // Process in smaller batches to avoid overwhelming the database
    await processInBatches(
      userTokens,
      async (tokenBatch) => {
        // Get all users by email in one query for this batch
        const userEmails = tokenBatch.map(t => t.userEmail).filter(Boolean);
        if (userEmails.length === 0) return;
        
        const { data: existingUsers, error: usersError } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .eq('organization_id', organizationId)
          .in('email', userEmails);
        
        if (usersError) {
          console.error('❌ Error fetching users for batch:', usersError);
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
        
        // Get existing relationships for this app and users
        const userIds = Array.from(userEmailToId.values());
        if (userIds.length === 0) return;
        
        const { data: existingRelationships, error: relationshipsError } = await supabaseAdmin
          .from('user_applications')
          .select('id, user_id, scopes')
          .eq('application_id', appId)
          .in('user_id', userIds);
          
        if (relationshipsError) {
          console.error('❌ Error fetching relationships for batch:', relationshipsError);
        }
        
        // Create map of existing relationships
        const existingRelationshipsMap = new Map();
        existingRelationships?.forEach(rel => {
          existingRelationshipsMap.set(rel.user_id, { id: rel.id, scopes: rel.scopes || [] });
        });
        
        // Prepare batch operations
        const toUpdate = [];
        const toInsert = [];
        
        // Process each token in this batch
        for (const token of tokenBatch) {
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
        
        // Execute batch operations with error handling
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
        
        // Add delay between relationship batches
        await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
      },
      PROCESSING_CONFIG.USER_BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );
    
    console.log(`✅ Processed ${userTokens.length} user-application relationships for app ${appId}`);
  } catch (error) {
    console.error('❌ Error in batch relationship processing:', error);
  }
}

// Helper function to force garbage collection and memory cleanup
const forceMemoryCleanup = () => {
  if (global.gc) {
    global.gc();
  }
  // Clear any lingering references
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 800 * 1024 * 1024) { // If using > 800MB heap (conservative for 2GB total)
      console.log(`Memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, forcing cleanup`);
      if (global.gc) global.gc();
    }
  }
};

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

    // Store users in database using batched processing
    console.log('💾 Storing users in database in batches...');
    
    await processInBatches(
      users,
      async (userBatch) => {
        const usersToUpsert = userBatch.map((user: any) => ({
          organization_id: syncRecord.organization_id,
          microsoft_user_id: user.id,
          email: user.mail || user.userPrincipalName,
          name: user.displayName,
          role: user.jobTitle || 'User',
          created_at: user.createdDateTime || new Date().toISOString(),
          department: user.department,
          updated_at: new Date().toISOString()
        }));

        const { error: usersError } = await supabaseAdmin
          .from('users')
          .upsert(usersToUpsert);

        if (usersError) {
          console.error('❌ Error storing users batch:', usersError);
          // Continue with next batch instead of failing completely
        }
        
        // Add delay between user batches
        await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
      },
      PROCESSING_CONFIG.USER_BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );

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

    // Process applications and user permissions with better batching
    console.log('⚙️ Processing applications and user permissions in controlled batches...');
    
    // Track unique applications and their users with scopes
    const processedApps = new Map();
    const userAppScopes = new Map(); // Map to track user-app pairs and their scopes
    const processedUserApps = new Set(); // Track unique user-app combinations

    // Process tokens in batches to avoid memory overload
    await processInBatches(
      tokens,
      async (tokenBatch) => {
        for (const token of tokenBatch) {
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
      },
      PROCESSING_CONFIG.MAX_APPS_PER_BATCH,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );

    // Process applications with better control and error handling
    await updateSyncStatus(syncRecord.id, 75, `Processing ${processedApps.size} applications in controlled batches...`);
    
    // Convert Map to array for controlled processing
    const appEntries = Array.from(processedApps.entries());
    
    // Track apps that need categorization
    const needsCategorization = { count: 0 };

    // Process applications in smaller, controlled batches
    await processInBatches(
      appEntries,
      async (appBatch) => {
        // Process each app in the batch sequentially (not in parallel)
        for (const [appId, appInfo] of appBatch) {
          try {
            // Force memory cleanup periodically
            if (needsCategorization.count % PROCESSING_CONFIG.MEMORY_CLEANUP_INTERVAL === 0) {
              forceMemoryCleanup();
            }
            
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
                category: existingApp?.category || 'Unknown',
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
              continue; // Continue with next app instead of failing
            }

            // Process user-application relationships for this app
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
            
            // Clear app-specific data from memory
            appInfo.allScopes.clear();
            appUsers.length = 0;
            
            // Small delay between individual app processing
            await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
          } catch (error) {
            console.error(`❌ Error processing application ${appId}:`, error);
            // Continue with next app instead of failing
          }
        }
      },
      PROCESSING_CONFIG.BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );

    // Clear memory
    processedApps.clear();
    userAppScopes.clear();
    processedUserApps.clear();

    // Update sync status for categorization
    await updateSyncStatus(syncRecord.id, 90, `Finalizing sync... ${needsCategorization.count} apps need categorization`);

    // Only trigger categorization if apps need it, and do it safely with proper error handling
    if (needsCategorization.count > 0) {
      console.log(`🔄 Triggering application categorization for ${needsCategorization.count} apps...`);
      try {
        // We'll await this operation to ensure categorization is properly triggered
        // but we won't wait for the actual categorization to complete
        const categorizationResponse = await fetch(`https://www.stitchflow.com/tools/shadow-it-scan/api/background/sync/categorize`, {
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