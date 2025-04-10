import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';

// Helper function to update sync status
async function updateSyncStatus(
  syncId: string,
  progress: number,
  message: string,
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' = 'IN_PROGRESS'
) {
  try {
    const { error } = await supabaseAdmin
      .from('sync_status')
      .update({
        status,
        progress,
        message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', syncId);
    
    if (error) {
      console.error('Error updating sync status:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to update sync status:', err);
    return false;
  }
}

// Helper function to safely format date
function formatDate(dateValue: any): string {
  if (!dateValue) return new Date().toISOString();
  
  try {
    // If it's a timestamp in milliseconds (number)
    if (typeof dateValue === 'number') {
      return new Date(dateValue).toISOString();
    }
    
    // If it's a string that looks like an ISO date
    if (typeof dateValue === 'string') {
      // Google's lastLoginTime is already in ISO format
      if (dateValue.includes('T') && dateValue.includes('Z')) {
        return dateValue;
      }
      
      // If it's a string with a timestamp in milliseconds
      if (!isNaN(Number(dateValue))) {
        return new Date(Number(dateValue)).toISOString();
      }
      
      // Otherwise try to parse it
      return new Date(Date.parse(dateValue)).toISOString();
    }

    // Default to current time if invalid
    return new Date().toISOString();
  } catch (error) {
    console.warn('Invalid date value:', dateValue);
    return new Date().toISOString();
  }
}

export async function POST(request: Request) {
  try {
    // This ensures the API responds quickly while processing continues
    const { organization_id, sync_id, access_token, refresh_token } = await request.json();
    
    if (!organization_id || !sync_id || !access_token) {
      console.error('Missing required parameters:', { organization_id, sync_id, access_token: !!access_token });
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    console.log('Starting sync process with ID:', sync_id, 'for org:', organization_id);
    
    // Send immediate response
    const responsePromise = Promise.resolve(
      NextResponse.json({ message: 'Sync started in background' })
    );
    
    // Process in background with error handling
    backgroundProcess(organization_id, sync_id, access_token, refresh_token).catch(error => {
      console.error('Background process failed:', error);
      // Try to update the sync status to failed
      updateSyncStatus(
        sync_id,
        -1,
        `Sync failed: ${error.message}`,
        'FAILED'
      ).catch(statusError => {
        console.error('Failed to update sync status after error:', statusError);
      });
    });
    
    return responsePromise;
  } catch (error: any) {
    console.error('Error in background sync API:', error);
    return NextResponse.json(
      { error: 'Failed to start background sync', details: error.message },
      { status: 500 }
    );
  }
}

async function backgroundProcess(organization_id: string, sync_id: string, access_token: string, refresh_token: string) {
  try {
    console.log('Starting background process for org:', organization_id, 'sync:', sync_id);
    
    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await updateSyncStatus(sync_id, 5, 'Setting up Google Workspace connection');
    
    try {
      await googleService.setCredentials({ 
        access_token,
        refresh_token
      });
      console.log('Successfully set credentials for Google Workspace API');
    } catch (error: any) {
      console.error('Failed to set credentials:', error);
      await updateSyncStatus(sync_id, -1, `Failed to connect to Google Workspace: ${error.message}`, 'FAILED');
      return; // Exit early on credential error
    }

    // Step 1: Fetch users list (20% progress)
    await updateSyncStatus(sync_id, 10, 'Fetching users from Google Workspace');
    
    let users = [];
    try {
      users = await googleService.getUsersList();
      console.log(`Fetched ${users.length} users for org ${organization_id}`);
    } catch (error: any) {
      console.error('Error fetching users list:', error);
      await updateSyncStatus(
        sync_id, 
        -1, 
        `Error fetching users: ${error.message}. Check Google Workspace permissions.`, 
        'FAILED'
      );
      return; // Exit early on user fetch error
    }
    
    if (!users || users.length === 0) {
      console.warn('No users found for organization');
      await updateSyncStatus(
        sync_id, 
        -1, 
        'No users found in Google Workspace. Check permissions and try again.', 
        'FAILED'
      );
      return;
    }
    
    await updateSyncStatus(sync_id, 20, `Processing ${users.length} users`);
    
    // Create a batch of all users to upsert
    const usersToUpsert = users.map((user: any) => {
      try {
        // Determine department from orgUnitPath if available
        const department = user.orgUnitPath ? 
          user.orgUnitPath.split('/').filter(Boolean).pop() || null : 
          null;
          
        // Determine role based on isAdmin flag
        const role = user.isAdmin ? 'Admin' : 'User';
        
        // Format the last login time if available
        const lastLogin = user.lastLoginTime ? formatDate(user.lastLoginTime) : null;
        
        return {
          google_user_id: user.id,
          email: user.primaryEmail,
          name: user.name?.fullName || user.primaryEmail,
          role: role,
          department: department,
          organization_id: organization_id,
          last_login: lastLogin,
        };
      } catch (err) {
        console.error('Error processing user:', err, user);
        return null;
      }
    }).filter(Boolean);
    
    console.log(`Prepared ${usersToUpsert.length} users for upsert`);
    
    if (usersToUpsert.length === 0) {
      console.warn('No valid users to insert after processing');
      await updateSyncStatus(
        sync_id, 
        -1, 
        'Failed to process user data. Please try again.', 
        'FAILED'
      );
      return;
    }
    
    // Batch upsert all users
    try {
      const { error: usersError } = await supabaseAdmin
        .from('users')
        .upsert(usersToUpsert);
      
      if (usersError) {
        console.error('Error upserting users:', usersError);
        await updateSyncStatus(
          sync_id, 
          -1, 
          `Database error when storing users: ${usersError.message}`, 
          'FAILED'
        );
        return;
      }
      
      console.log('Successfully upserted users');
    } catch (error: any) {
      console.error('Exception during user upsert:', error);
      await updateSyncStatus(
        sync_id, 
        -1, 
        `Failed to save users to database: ${error.message}`, 
        'FAILED'
      );
      return;
    }

    // Get all users for this organization to create a mapping
    let createdUsers = [];
    try {
      const { data, error: createdUsersError } = await supabaseAdmin
        .from('users')
        .select('id, google_user_id, email')
        .eq('organization_id', organization_id);
      
      if (createdUsersError) {
        console.error('Error fetching created users:', createdUsersError);
        await updateSyncStatus(
          sync_id, 
          -1, 
          `Database error when retrieving users: ${createdUsersError.message}`, 
          'FAILED'
        );
        return;
      }
      
      createdUsers = data || [];
      console.log(`Retrieved ${createdUsers.length} users from database`);
      
      if (createdUsers.length === 0) {
        console.error('No users found in database after upsert');
        await updateSyncStatus(
          sync_id, 
          -1, 
          'Failed to save users to database. Please try again.', 
          'FAILED'
        );
        return;
      }
    } catch (error: any) {
      console.error('Exception during user retrieval:', error);
      await updateSyncStatus(
        sync_id, 
        -1, 
        `Failed to retrieve users from database: ${error.message}`, 
        'FAILED'
      );
      return;
    }

    // Create a mapping for quick lookup
    const userMap = new Map();
    const userEmailMap = new Map();
    createdUsers.forEach(user => {
      userMap.set(user.google_user_id, user.id);
      userEmailMap.set(user.email, user.id);
    });

    // Step 2: Fetch OAuth tokens (40% progress)
    await updateSyncStatus(sync_id, 30, 'Fetching application data from Google Workspace');
    
    let applicationTokens = [];
    try {
      applicationTokens = await googleService.getOAuthTokens();
      console.log(`Fetched ${applicationTokens.length} application tokens`);
      
      if (applicationTokens.length === 0) {
        console.warn('No application tokens found');
        // This isn't a failure, just a warning - continue processing
      }
    } catch (error: any) {
      console.error('Error fetching OAuth tokens:', error);
      await updateSyncStatus(
        sync_id, 
        -1, 
        `Failed to fetch application data: ${error.message}. Check permissions.`, 
        'FAILED'
      );
      return;
    }
    
    await updateSyncStatus(sync_id, 40, `Processing ${applicationTokens.length} application connections`);
    
    // First, prepare all data before database operations
    const appNameMap = new Map<string, any[]>();
    
    // Group tokens by application name
    for (const token of applicationTokens) {
      const appName = token.displayText || 'Unknown App';
      
      if (!appNameMap.has(appName)) {
        appNameMap.set(appName, []);
      }
      
      appNameMap.get(appName)!.push(token);
    }
    
    // Pre-fetch all existing applications for this organization
    const { data: existingApps, error: existingAppsError } = await supabaseAdmin
      .from('applications')
      .select('id, name, total_permissions')
      .eq('organization_id', organization_id);
      
    if (existingAppsError) {
      console.error('Error fetching existing applications:', existingAppsError);
      throw existingAppsError;
    }
    
    // Create a map for quick lookup of existing apps
    const existingAppMap = new Map();
    existingApps?.forEach(app => {
      existingAppMap.set(app.name, app);
    });
    
    // Prepare applications batch for upsert
    const appsToUpsert: any[] = [];
    const appProcessingData: any[] = [];
    
    // Process each group of applications
    let appCount = 0;
    const totalApps = appNameMap.size;
    
    // Process all applications in a single pass
    for (const [appName, tokens] of appNameMap.entries()) {
      appCount++;
      const progressPercent = 40 + Math.floor((appCount / totalApps) * 40);
      
      if (appCount % 10 === 0 || appCount === totalApps) {
        await updateSyncStatus(
          sync_id, 
          progressPercent, 
          `Processing applications: ${appCount}/${totalApps}`
        );
      }
      
      // Find existing application
      const existingApp = existingAppMap.get(appName);
      
      // Calculate total unique permissions across all instances
      const allScopes = new Set<string>();
      tokens.forEach((token: any) => {
        if (token.scopes && Array.isArray(token.scopes)) {
          token.scopes.forEach((scope: string) => allScopes.add(scope));
        }
      });
      
      // Find the most recent last used time
      const lastUsedTime = tokens.reduce((latest: Date, token: any) => {
        const tokenTime = token.lastTimeUsed ? new Date(token.lastTimeUsed) : new Date(0);
        return tokenTime > latest ? tokenTime : latest;
      }, new Date(0));
      
      // Determine highest risk level across all instances
      const highestRiskLevel = tokens.reduce((highest: string, token: any) => {
        const tokenRisk = determineRiskLevel(token.scopes);
        if (tokenRisk === 'HIGH') return 'HIGH';
        if (tokenRisk === 'MEDIUM' && highest !== 'HIGH') return 'MEDIUM';
        return highest;
      }, 'LOW');
      
      // Prepare application for upsert
      appsToUpsert.push({
        id: existingApp?.id, // Include ID if it exists
        google_app_id: tokens.map(t => t.clientId).join(','), // Store all client IDs
        name: appName,
        category: 'Unknown',
        risk_level: highestRiskLevel,
        management_status: existingApp?.id ? existingApp.management_status || 'PENDING' : 'PENDING', // Preserve existing status or set to PENDING for new
        total_permissions: allScopes.size,
        all_scopes: Array.from(allScopes), // Store all unique scopes
        last_login: formatDate(lastUsedTime),
        organization_id: organization_id,
      });
      
      // Store processing data for later
      appProcessingData.push({
        appName,
        tokens,
        existingAppId: existingApp?.id
      });
    }
    
    // Batch upsert all applications at once
    console.log(`Upserting ${appsToUpsert.length} applications`);
    
    let updatedApps: any[] = [];
    
    try {
      // First insert new applications that don't have IDs
      const newApps = appsToUpsert.filter(app => !app.id);
      const existingApps = appsToUpsert.filter(app => app.id);
      
      let newlyCreatedApps: any[] = [];
      
      if (newApps.length > 0) {
        console.log(`Inserting ${newApps.length} new applications`);
        const { data: insertedApps, error: insertError } = await supabaseAdmin
          .from('applications')
          .insert(newApps)
          .select('id, name');
        
        if (insertError) {
          console.error('Error inserting new applications:', insertError);
          await updateSyncStatus(
            sync_id,
            -1,
            `Database error when inserting applications: ${insertError.message}`,
            'FAILED'
          );
          return;
        }
        
        newlyCreatedApps = insertedApps || [];
      }
      
      // Then update existing applications
      let updatedExistingApps: any[] = [];
      
      if (existingApps.length > 0) {
        console.log(`Updating ${existingApps.length} existing applications`);
        
        // Update each existing app individually to avoid constraint violations
        for (const app of existingApps) {
          const { data: updatedApp, error: updateError } = await supabaseAdmin
            .from('applications')
            .update(app)
            .eq('id', app.id)
            .select('id, name');
          
          if (updateError) {
            console.error(`Error updating application ${app.name}:`, updateError);
            // Continue with other apps rather than failing
          } else if (updatedApp && updatedApp.length > 0) {
            updatedExistingApps.push(updatedApp[0]);
          }
        }
      }
      
      // Combine newly created and updated apps
      updatedApps = [...newlyCreatedApps, ...updatedExistingApps];
      
      // Create a map of app names to their IDs
      const appIdMap = new Map();
      updatedApps.forEach((app: any) => {
        appIdMap.set(app.name, app.id);
      });
      
      // For any app that wasn't properly upserted, try to fetch it by name
      for (const { appName } of appProcessingData) {
        if (!appIdMap.has(appName)) {
          console.log(`Need to fetch ID for app: ${appName}`);
          const { data: fetchedApp } = await supabaseAdmin
            .from('applications')
            .select('id, name')
            .eq('name', appName)
            .eq('organization_id', organization_id)
            .maybeSingle();
          
          if (fetchedApp?.id) {
            appIdMap.set(appName, fetchedApp.id);
            updatedApps.push(fetchedApp);
            console.log(`Found ID ${fetchedApp.id} for app ${appName}`);
          }
        }
      }
      
      // Pre-fetch existing user-application relations to avoid duplicates
      const { data: existingRelations, error: relationsError } = await supabaseAdmin
        .from('user_applications')
        .select('id, user_id, application_id, scopes')
        .in('application_id', updatedApps.map((a: any) => a.id) || []);
      
      if (relationsError) {
        console.error('Error fetching existing relations:', relationsError);
        throw relationsError;
      }
      
      // Create a map for quick lookup of existing relations
      const existingRelationMap = new Map();
      existingRelations?.forEach(rel => {
        const key = `${rel.user_id}:${rel.application_id}`;
        existingRelationMap.set(key, rel);
      });
      
      // Prepare user-application relations batch
      const relationsToUpsert: any[] = [];
      const relationsToUpdate: any[] = [];
      
      // Process all tokens to create user-application relations
      for (const { appName, tokens } of appProcessingData) {
        const appId = appIdMap.get(appName);
        if (!appId) {
          console.warn(`No application ID found for ${appName}`);
          continue;
        }
        
        for (const token of tokens) {
          // Try to find user by ID first, then by email
          let userId = userMap.get(token.userKey);
          if (!userId && token.userEmail) {
            userId = userEmailMap.get(token.userEmail);
          }
          
          if (!userId) {
            console.warn('No matching user found for token:', token.userKey || token.userEmail);
            continue;
          }
          
          // Extract this specific user's scopes
          const userScopes = extractScopes(token);
          
          // Check if relation already exists
          const relationKey = `${userId}:${appId}`;
          const existingRelation = existingRelationMap.get(relationKey);
          
          if (existingRelation) {
            // Merge with existing scopes
            const mergedScopes = [...new Set([...existingRelation.scopes, ...userScopes])];
            
            relationsToUpdate.push({
              id: existingRelation.id,
              scopes: mergedScopes,
              last_login: formatDate(token.lastTimeUsed),
              updated_at: new Date().toISOString()
            });
          } else {
            // New relation - ensure each entry has all required fields
            relationsToUpsert.push({
              user_id: userId,
              application_id: appId,
              scopes: userScopes || [],
              last_login: formatDate(token.lastTimeUsed),
              organization_id: organization_id // Add organization_id for extra safety
            });
          }
        }
      }
      
      // Process in batches of 100 to avoid query size limits
      const BATCH_SIZE = 100;
      
      // Insert new relations in batches
      if (relationsToUpsert.length > 0) {
        console.log(`Inserting ${relationsToUpsert.length} new user-application relations`);
        
        for (let i = 0; i < relationsToUpsert.length; i += BATCH_SIZE) {
          const batch = relationsToUpsert.slice(i, i + BATCH_SIZE);
          
          await updateSyncStatus(
            sync_id, 
            80 + Math.floor((i / relationsToUpsert.length) * 10), 
            `Saving application connections: ${i}/${relationsToUpsert.length}`
          );
          
          try {
            const { error: insertError } = await supabaseAdmin
              .from('user_applications')
              .insert(batch);
            
            if (insertError) {
              console.error('Error inserting user-application relations batch:', insertError);
              
              // If it's a constraint violation, try each record individually
              if (insertError.message?.includes('violates') || insertError.code === '23502') {
                console.log('Trying individual inserts instead of batch');
                
                for (const relation of batch) {
                  try {
                    const { error: individualInsertError } = await supabaseAdmin
                      .from('user_applications')
                      .insert(relation);
                    
                    if (individualInsertError) {
                      console.error(`Failed to insert relation for user ${relation.user_id} and app ${relation.application_id}:`, individualInsertError);
                    }
                  } catch (err) {
                    console.error('Error during individual insert:', err);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Exception during batch insert:', error);
            // Continue to next batch rather than failing entire process
          }
        }
      }
      
      // Update existing relations in batches
      if (relationsToUpdate.length > 0) {
        console.log(`Updating ${relationsToUpdate.length} existing user-application relations`);
        
        for (let i = 0; i < relationsToUpdate.length; i += BATCH_SIZE) {
          const batch = relationsToUpdate.slice(i, i + BATCH_SIZE);
          
          await updateSyncStatus(
            sync_id, 
            90 + Math.floor((i / relationsToUpdate.length) * 10), 
            `Updating application connections: ${i}/${relationsToUpdate.length}`
          );
          
          // We need to update one at a time because Supabase doesn't support updating
          // multiple records with different values in a single call
          for (const relation of batch) {
            try {
              const { error: updateError } = await supabaseAdmin
                .from('user_applications')
                .update({
                  scopes: relation.scopes,
                  last_login: relation.last_login,
                  updated_at: relation.updated_at
                })
                .eq('id', relation.id);
              
              if (updateError) {
                console.error('Error updating user-application relation:', updateError);
                // Continue to next relation rather than failing entire process
              }
            } catch (error) {
              console.error('Error during relation update:', error);
              // Continue to next relation rather than failing entire process
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error in sync process:', error);
      await updateSyncStatus(
        sync_id,
        -1,
        `Failed to save data to database: ${error.message}`,
        'FAILED'
      );
      return;
    }
    
    // Finalize (100% progress)
    await updateSyncStatus(
      sync_id, 
      100, 
      `Sync completed - Processed ${updatedApps.length} applications and ${users.length} users`, 
      'COMPLETED'
    );
    
    console.log('Background sync completed successfully');
  } catch (error: any) {
    console.error('Error in background sync process:', error);
    
    // Update status to failed
    await updateSyncStatus(
      sync_id,
      -1,
      `Sync failed: ${error.message}`,
      'FAILED'
    );
  }
}

// Helper function to extract scopes from a token
function extractScopes(token: any): string[] {
  // Make sure we have a valid scopes array
  let userScopes = token.scopes || [];
  
  // Check if we should extract from other token fields
  if (token.scopeData && Array.isArray(token.scopeData)) {
    // Some admin API responses include detailed scope data in a separate field
    const scopesFromData = token.scopeData.map((sd: any) => sd.scope || sd.value || '').filter(Boolean);
    if (scopesFromData.length > 0) {
      userScopes = [...new Set([...userScopes, ...scopesFromData])];
    }
  }
  
  // Some scopes might come from a raw permission field in some API responses
  if (token.permissions && Array.isArray(token.permissions)) {
    const scopesFromPermissions = token.permissions.map((p: any) => p.scope || p.value || p).filter(Boolean);
    if (scopesFromPermissions.length > 0) {
      // Merge with existing scopes if any
      userScopes = [...new Set([...userScopes, ...scopesFromPermissions])];
    }
  }
  
  // If we still don't have scopes and have raw scope data as string
  if (userScopes.length === 0 && token.rawScopes) {
    userScopes = token.rawScopes.split(' ');
  }
  
  // If we have any scope-like fields, try to extract them
  const potentialScopeFields = ['scope_string', 'oauth_scopes', 'accessScopes'];
  for (const field of potentialScopeFields) {
    if (token[field] && typeof token[field] === 'string' && token[field].includes('://')) {
      const extractedScopes = token[field].split(/\s+/);
      userScopes = [...new Set([...userScopes, ...extractedScopes])];
    }
  }
  
  return userScopes;
} 