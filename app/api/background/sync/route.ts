import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';

// Define batch sizes for better performance
const BATCH_SIZE = 50;
const PARALLEL_BATCH_SIZE = 5;

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  return await supabaseAdmin
    .from('sync_status')
    .update({
      status,
      progress,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', syncId);
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

// Helper function to process data in batches
async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processBatch: (batch: T[]) => Promise<R[]>,
  parallelBatches: number = 1
): Promise<R[]> {
  const results: R[] = [];
  
  // Create batches
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  // Process batches with parallelism
  for (let i = 0; i < batches.length; i += parallelBatches) {
    const currentBatches = batches.slice(i, i + parallelBatches);
    const batchResults = await Promise.all(
      currentBatches.map(batch => processBatch(batch))
    );
    
    batchResults.forEach(result => results.push(...result));
  }
  
  return results;
}

export async function POST(request: Request) {
  try {
    // This ensures the API responds quickly while processing continues
    const { organization_id, sync_id, access_token, refresh_token } = await request.json();
    
    if (!organization_id || !sync_id || !access_token) {
      console.error('Missing required parameters for sync');
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }
    
    // Send immediate response
    const responsePromise = Promise.resolve(
      NextResponse.json({ message: 'Sync started in background' })
    );
    
    // Process in background
    backgroundProcess(organization_id, sync_id, access_token, refresh_token).catch(error => {
      console.error('Background process failed:', error);
    });
    
    return responsePromise;
  } catch (error: any) {
    console.error('Error in background sync API:', error);
    return NextResponse.json(
      { error: 'Failed to start background sync' },
      { status: 500 }
    );
  }
}

async function backgroundProcess(organization_id: string, sync_id: string, access_token: string, refresh_token: string) {
  try {
    console.log(`Starting background process for org: ${organization_id}`);
    
    // Initialize Google Workspace service with optimized settings
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ 
      access_token,
      refresh_token
    });

    // Start parallel fetching of data from Google APIs
    await updateSyncStatus(sync_id, 5, 'Fetching data from Google Workspace');
    
    // Fetch both users and application tokens in parallel
    const [users, applicationTokens] = await Promise.all([
      googleService.getUsersList(),
      googleService.getOAuthTokens(),
    ]);
    
    console.log(`Fetched ${users.length} users and ${applicationTokens.length} tokens`);
    await updateSyncStatus(sync_id, 10, `Processing ${users.length} users and ${applicationTokens.length} application connections`);
    
    // Process users
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
    
    console.log(`Processing ${usersToUpsert.length} users in batches`);
    
    // Process users in batches
    const processBatchOfUsers = async (batch: any[]): Promise<any[]> => {
      const { error } = await supabaseAdmin.from('users').upsert(batch);
      if (error) {
        console.error('Error upserting users batch:', error);
        throw error;
      }
      return batch;
    };
    
    // Process users in batches with parallelism
    await processBatches(usersToUpsert, BATCH_SIZE, processBatchOfUsers, PARALLEL_BATCH_SIZE);
    await updateSyncStatus(sync_id, 20, 'Users processed, retrieving user IDs');
    
    // Get all users for this organization to create a mapping
    const { data: createdUsers, error: createdUsersError } = await supabaseAdmin
      .from('users')
      .select('id, google_user_id')
      .eq('organization_id', organization_id);
    
    if (createdUsersError) {
      console.error('Error fetching created users:', createdUsersError);
      throw createdUsersError;
    }
    
    await updateSyncStatus(sync_id, 30, 'Creating user map and processing applications');
    
    // Create a mapping for quick lookup
    const userMap = new Map();
    createdUsers?.forEach(user => {
      userMap.set(user.google_user_id, user.id);
    });
    
    // Group applications by display name for faster processing
    const appNameMap = new Map<string, any[]>();
    
    // First pass: Group tokens by application name
    for (const token of applicationTokens) {
      const appName = token.displayText || 'Unknown App';
      
      if (!appNameMap.has(appName)) {
        appNameMap.set(appName, []);
      }
      
      appNameMap.get(appName)!.push(token);
    }
    
    console.log(`Processing ${appNameMap.size} unique applications`);
    await updateSyncStatus(sync_id, 40, `Processing ${appNameMap.size} applications`);
    
    // Convert map to array for batch processing
    const appEntries = Array.from(appNameMap.entries());
    
    // Process applications in batches
    const processAppBatch = async (batch: [string, any[]][]): Promise<any[]> => {
      const results: any[] = [];
      
      for (const [appName, tokens] of batch) {
        try {
          // Find or create application record using the app name
          const { data: existingApp } = await supabaseAdmin
            .from('applications')
            .select('id, total_permissions')
            .eq('name', appName)
            .eq('organization_id', organization_id)
            .maybeSingle();
          
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
          
          // Create or update the application
          const { data: appData, error: appError } = await supabaseAdmin
            .from('applications')
            .upsert({
              id: existingApp?.id, // Include ID if it exists
              google_app_id: tokens.map(t => t.clientId).join(','), // Store all client IDs
              name: appName,
              category: 'Unknown',
              risk_level: highestRiskLevel,
              management_status: existingApp?.id ? undefined : 'PENDING', // Only set for new apps
              total_permissions: allScopes.size,
              all_scopes: Array.from(allScopes), // Store all unique scopes
              last_login: formatDate(lastUsedTime),
              organization_id: organization_id,
            })
            .select('id')
            .single();
          
          if (appError) throw appError;
          
          // Prepare user-application relationships
          const userAppBatch: any[] = [];
          
          for (const token of tokens) {
            const userId = userMap.get(token.userKey);
            if (!userId) continue;
            
            // Extract scopes from token, same as before...
            let userScopes = token.scopes || [];
            
            if (token.scopeData && Array.isArray(token.scopeData)) {
              const scopesFromData = token.scopeData.map((sd: any) => sd.scope || sd.value || '').filter(Boolean);
              if (scopesFromData.length > 0) {
                userScopes = [...new Set([...userScopes, ...scopesFromData])];
              }
            }
            
            if (token.permissions && Array.isArray(token.permissions)) {
              const scopesFromPermissions = token.permissions.map((p: any) => p.scope || p.value || p).filter(Boolean);
              if (scopesFromPermissions.length > 0) {
                userScopes = [...new Set([...userScopes, ...scopesFromPermissions])];
              }
            }
            
            if (userScopes.length === 0 && token.rawScopes) {
              userScopes = token.rawScopes.split(' ');
            }
            
            const potentialScopeFields = ['scope_string', 'oauth_scopes', 'accessScopes'];
            for (const field of potentialScopeFields) {
              if (token[field] && typeof token[field] === 'string' && token[field].includes('://')) {
                const extractedScopes = token[field].split(/\s+/);
                userScopes = [...new Set([...userScopes, ...extractedScopes])];
              }
            }
            
            userAppBatch.push({
              user_id: userId,
              application_id: appData.id,
              scopes: userScopes,
              last_login: formatDate(token.lastTimeUsed)
            });
          }
          
          // Process user-app relationships in a single batch upsert
          if (userAppBatch.length > 0) {
            const { error: batchError } = await supabaseAdmin
              .from('user_applications')
              .upsert(userAppBatch, {
                onConflict: 'user_id,application_id',
                ignoreDuplicates: false
              });
              
            if (batchError) {
              console.error('Error upserting user-application batch:', batchError);
              // Continue processing other apps even if this one fails
            }
          }
          
          results.push(appData);
        } catch (error) {
          console.error(`Error processing app ${appName}:`, error);
          // Continue with other apps
        }
      }
      
      return results;
    };
    
    // Process all applications with batching
    await processBatches(appEntries, 5, processAppBatch, 2);
    
    // Finalize (100% progress)
    await updateSyncStatus(
      sync_id, 
      100, 
      `Sync completed - Processed ${appNameMap.size} applications and ${users.length} users`, 
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