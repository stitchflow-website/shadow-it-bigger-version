import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';

// Configure the route to use Edge runtime
export const runtime = 'edge';
export const maxDuration = 300; // 5 minutes max (supported by Edge functions)

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

export async function POST(request: Request) {
  const { organization_id, sync_id, access_token, refresh_token } = await request.json();
  
  // Create a streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // Send initial message
  writer.write(encoder.encode(JSON.stringify({ message: 'Sync started' })));
  
  // Process in background without awaiting
  backgroundProcess(organization_id, sync_id, access_token, refresh_token).catch(error => {
    console.error('Error in background process:', error);
  });
  
  // Close the stream and return the response
  writer.close();
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}

async function backgroundProcess(organization_id: string, sync_id: string, access_token: string, refresh_token: string) {
  try {
    console.log(`Starting background process for organization: ${organization_id}, sync: ${sync_id}`);
    
    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ 
      access_token,
      refresh_token
    });

    // Step 1: Fetch users list using pagination (20% progress)
    await updateSyncStatus(sync_id, 10, 'Fetching users from Google Workspace');
    
    let users = [];
    try {
      // Use the new paginated method to get all users
      users = await googleService.getUsersListPaginated();
      console.log(`Fetched ${users.length} users`);
    } catch (userFetchError) {
      console.error('Error fetching users:', userFetchError);
      await updateSyncStatus(sync_id, -1, 'Failed to fetch users from Google Workspace', 'FAILED');
      throw userFetchError;
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
      
        // Safely access user name or use email as fallback
        const fullName = user.name && typeof user.name === 'object' ? 
          (user.name.fullName || `${user.name.givenName || ''} ${user.name.familyName || ''}`.trim() || user.primaryEmail) : 
          user.primaryEmail;
        
      return {
        google_user_id: user.id,
        email: user.primaryEmail,
          name: fullName,
        role: role,
        department: department,
        organization_id: organization_id
      };
      } catch (userError) {
        console.error(`Error processing user ${user.primaryEmail || 'unknown'}:`, userError);
        // Return a minimal valid record
        return {
          google_user_id: user.id || `unknown-${Date.now()}-${Math.random()}`,
          email: user.primaryEmail || 'unknown@example.com',
          name: 'Unknown User',
          role: 'User',
          department: null,
          organization_id: organization_id
        };
      }
    });
    
    // Use a single batch upsert operation for all users (more efficient)
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert(usersToUpsert);
    
    if (usersError) throw usersError;
    
    // Get all users for this organization to create a mapping
    const { data: createdUsers } = await supabaseAdmin
      .from('users')
      .select('id, google_user_id')
      .eq('organization_id', organization_id);
    
    // Create a mapping for quick lookup
    const userMap = new Map();
    createdUsers?.forEach(user => {
      userMap.set(user.google_user_id, user.id);
    });

    // Step 2: Fetch OAuth tokens (40% progress)
    await updateSyncStatus(sync_id, 30, 'Fetching application data from Google Workspace');
    
    try {
      // Use the optimized parallel method with a timeout
      const fetchTokensPromise = googleService.getOAuthTokens();
      
      // Set a timeout for token fetching (90 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout fetching OAuth tokens')), 90000);
      });
      
      // Race between the fetch and the timeout
      const applicationTokens = await Promise.race([
        fetchTokensPromise,
        timeoutPromise
      ]) as any[];
      
      console.log(`Fetched ${applicationTokens.length} application tokens`);
      await updateSyncStatus(sync_id, 40, `Processing ${applicationTokens.length} application connections`);
    
      // Continue with application processing
      // Group applications by display name (for better batching)
      const appNameMap = new Map<string, any[]>();
      
      // First pass: Group tokens by application name
      for (const token of applicationTokens) {
        const appName = token.displayText || 'Unknown App';
        
        if (!appName) {
          console.warn('Skipping token with missing app name');
          continue;
        }
        
        if (!appNameMap.has(appName)) {
          appNameMap.set(appName, []);
        }
        
        // Add token with user info
        appNameMap.get(appName)!.push(token);
      }
      
      // Prepare bulk upsert operations
      const applicationsToUpsert: any[] = [];
      const userAppRelationsToProcess: { appName: string, userId: string, userEmail: string, token: any }[] = [];
      
      // Process all applications (40% to 60% progress)
      let appCount = 0;
      const totalApps = appNameMap.size;
      
      // Process in smaller batches
      const appBatchSize = 10; // Process 10 apps at a time
      const appEntries = Array.from(appNameMap.entries());
      
      for (let batchIndex = 0; batchIndex < appEntries.length; batchIndex += appBatchSize) {
        const currentBatch = appEntries.slice(batchIndex, batchIndex + appBatchSize);
        const progressPercent = 40 + Math.floor((batchIndex / appEntries.length) * 20);
        
        await updateSyncStatus(
          sync_id, 
          progressPercent, 
          `Processing application batch ${batchIndex / appBatchSize + 1} of ${Math.ceil(appEntries.length / appBatchSize)}`
        );
      
        // Process each app in the current batch
        for (const [appName, tokens] of currentBatch) {
          // Calculate total unique permissions across all instances
          const allScopes = new Set<string>();
          tokens.forEach((token: any) => {
            if (token.scopes && Array.isArray(token.scopes)) {
              token.scopes.forEach((scope: string) => allScopes.add(scope));
            }
          });
          
          // Determine highest risk level across all instances
          const highestRiskLevel = tokens.reduce((highest: string, token: any) => {
            const tokenRisk = determineRiskLevel(token.scopes);
            if (tokenRisk === 'HIGH') return 'HIGH';
            if (tokenRisk === 'MEDIUM' && highest !== 'HIGH') return 'MEDIUM';
            return highest;
          }, 'LOW');
          
          // Check if app already exists first
          const { data: existingApp } = await supabaseAdmin
            .from('applications')
            .select('id')
            .eq('name', appName)
            .eq('organization_id', organization_id)
            .maybeSingle();
          
          // Add to batch of applications to upsert
          const appRecord: any = {
            google_app_id: tokens.map(t => t.clientId).join(','), // Store all client IDs
            name: appName,
            category: 'Unknown',
            risk_level: highestRiskLevel,
            total_permissions: allScopes.size,
            all_scopes: Array.from(allScopes),
            organization_id: organization_id
          };
          
          // Only set the ID if it exists (for updates)
          if (existingApp?.id) {
            appRecord.id = existingApp.id;
          } else {
            // Only set management_status for new records
            appRecord.management_status = 'PENDING';
          }
          
          // Add to the batch
          applicationsToUpsert.push(appRecord);
          
          // Process each token to create user-application relationships
          for (const token of tokens) {
            const userKey = token.userKey;
            if (!userKey) {
              console.warn('Skipping token with missing user key');
              continue;
            }
            
            const userId = userMap.get(userKey);
            if (!userId) {
              console.warn('No matching user found for token:', userKey);
              continue;
            }
            
            userAppRelationsToProcess.push({
              appName,
              userId,
              userEmail: token.userEmail || '',
              token
            });
          }
        }
        
        // Process this batch of apps immediately
        if (applicationsToUpsert.length > 0) {
          await processApplicationBatch(applicationsToUpsert, organization_id, sync_id);
          applicationsToUpsert.length = 0; // Clear the array
        }
      }
      
      // Get all applications to create a mapping
      const { data: allApps, error: fetchAppsError } = await supabaseAdmin
        .from('applications')
        .select('id, name')
        .eq('organization_id', organization_id);
      
      if (fetchAppsError) {
        console.error('Error fetching applications after upsert:', fetchAppsError);
        throw fetchAppsError;
      }
      
      // Create a mapping of app names to IDs
      const appIdMap = new Map<string, string>();
      allApps?.forEach(app => {
        appIdMap.set(app.name, app.id);
      });
      
      // Process user-application relationships (60% to 90% progress)
      await updateSyncStatus(sync_id, 70, `Processing ${userAppRelationsToProcess.length} user-application relations`);
      
      // First, get all existing relationships with scopes
      const { data: existingRelations, error: relError } = await supabaseAdmin
        .from('user_applications')
        .select('id, user_id, application_id, scopes');
      
      if (relError) {
        console.error('Error fetching existing relationships:', relError);
        throw relError;
      }
      
      // Create a map for quick lookup
      const existingRelMap = new Map<string, {id: string, scopes: string[]}>(); 
      existingRelations?.forEach(rel => {
        const key = `${rel.user_id}-${rel.application_id}`;
        existingRelMap.set(key, {
          id: rel.id,
          scopes: rel.scopes || []
        });
      });
      
      // Group relations by user-app pair to combine scopes more efficiently
      const relationsByUserAppPair = new Map<string, {
        userId: string,
        appId: string,
        appName: string,
        scopes: Set<string>
      }>();
      
      // Process each relationship, grouping by user-app pair and combining scopes
      for (const relation of userAppRelationsToProcess) {
        const appId = appIdMap.get(relation.appName);
        if (!appId) {
          console.warn(`No application ID found for ${relation.appName}`);
          continue;
        }
        
        // Extract scopes from this specific token
        const userScopes = extractScopesFromToken(relation.token);
        
        const relationKey = `${relation.userId}-${appId}`;
        
        if (!relationsByUserAppPair.has(relationKey)) {
          relationsByUserAppPair.set(relationKey, {
            userId: relation.userId,
            appId: appId,
            appName: relation.appName,
            scopes: new Set(userScopes)
          });
        } else {
          // Add scopes to existing relation
          const existingScopes = relationsByUserAppPair.get(relationKey)!.scopes;
          userScopes.forEach(scope => existingScopes.add(scope));
        }
      }
      
      // Prepare batches for processing
      const relationsToUpdate: any[] = [];
      const relationsToInsert: any[] = [];
      
      // Process the grouped relations
      for (const [relationKey, relationData] of relationsByUserAppPair.entries()) {
        const { userId, appId, scopes } = relationData;
        const scopesArray = Array.from(scopes);
        
        const existingRel = existingRelMap.get(relationKey);
        
        if (existingRel) {
          // For existing relationships, merge with existing scopes
          const mergedScopes = [...new Set([...existingRel.scopes, ...scopesArray])];
          
          relationsToUpdate.push({
            id: existingRel.id,
            user_id: userId,
            application_id: appId,
            scopes: mergedScopes,
            updated_at: new Date().toISOString()
          });
        } else {
          relationsToInsert.push({
            user_id: userId,
            application_id: appId,
            scopes: scopesArray,
            updated_at: new Date().toISOString()
          });
        }
      }
      
      console.log(`Processing ${relationsToUpdate.length} updates and ${relationsToInsert.length} inserts`);
      
      // Handle updates first
      if (relationsToUpdate.length > 0) {
        const { error: updateError } = await supabaseAdmin
          .from('user_applications')
          .upsert(relationsToUpdate);
        
        if (updateError) {
          console.error('Error updating user-application relationships:', updateError);
          // Continue with inserts even if updates fail
        }
      }
      
      // Process inserts in smaller batches
      const batchSize = 50;
      for (let i = 0; i < relationsToInsert.length; i += batchSize) {
        const batch = relationsToInsert.slice(i, i + batchSize);
        const { error: insertError } = await supabaseAdmin
          .from('user_applications')
          .insert(batch);
        
        if (insertError) {
          console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
        }
      }
      
    } catch (tokenError) {
      console.error('Error in token processing:', tokenError);
      
      // Update status but continue with sync
      await updateSyncStatus(
        sync_id, 
        70, 
        `Partial sync completed - token fetch timeout, but user data processed successfully`,
        'PARTIAL'
      );
      
      return;
    }
    
    // Finalize (100% progress)
    await updateSyncStatus(
      sync_id, 
      100, 
      `Sync completed successfully`,
      'COMPLETED'
    );
    
    console.log('Background sync completed successfully');
  } catch (error: any) {
    console.error('Error in background sync process:', error);
    console.error('Stack trace:', error.stack);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      details: error.details
    });
    
    // Update status to failed
    await updateSyncStatus(
      sync_id,
      -1,
      `Sync failed: ${error.message}`,
      'FAILED'
    );
  }
}

// Helper function to process a batch of applications
async function processApplicationBatch(applicationsToUpsert: any[], organization_id: string, sync_id: string) {
  // For safety, split into inserts and updates
  const appsToInsert = applicationsToUpsert.filter(app => !app.id);
  const appsToUpdate = applicationsToUpsert.filter(app => app.id);
  
  // Handle inserts
  const insertPromises = [];
  for (let i = 0; i < appsToInsert.length; i += 50) {
    const batch = appsToInsert.slice(i, i + 50);
    insertPromises.push(
      supabaseAdmin
        .from('applications')
        .insert(batch)
    );
  }
  
  // Handle updates
  const updatePromises = [];
  for (let i = 0; i < appsToUpdate.length; i += 50) {
    const batch = appsToUpdate.slice(i, i + 50);
    updatePromises.push(
      supabaseAdmin
        .from('applications')
        .upsert(batch)
    );
  }
  
  // Wait for all operations to complete
  try {
    await Promise.all([...insertPromises, ...updatePromises]);
  } catch (error) {
    console.error('Error during application batch processing:', error);
    throw error;
  }
}

// Helper function to extract scopes from a token
function extractScopesFromToken(token: any): string[] {
  // If token is undefined or null, return empty array
  if (!token) return [];
  
  let scopes = new Set<string>();
  
  // Add scopes from the token if available
  if (token.scopes && Array.isArray(token.scopes)) {
    token.scopes.forEach((s: string) => scopes.add(s));
  }
  
  // Check scope_data field
  if (token.scopeData && Array.isArray(token.scopeData)) {
    token.scopeData.forEach((sd: any) => {
      if (sd.scope) scopes.add(sd.scope);
      if (sd.value) scopes.add(sd.value);
    });
  }
  
  // Check raw scope string if available
  if (token.scope && typeof token.scope === 'string') {
    token.scope.split(/\s+/).forEach((s: string) => scopes.add(s));
  }
  
  // Some scopes might come from a permissions field
  if (token.permissions && Array.isArray(token.permissions)) {
    const scopesFromPermissions = token.permissions.map((p: any) => p.scope || p.value || p).filter(Boolean);
    if (scopesFromPermissions.length > 0) {
      scopesFromPermissions.forEach((s: string) => scopes.add(s));
    }
  }
  
  // If we have any scope-like fields, try to extract them
  const potentialScopeFields = ['scope_string', 'oauth_scopes', 'accessScopes'];
  for (const field of potentialScopeFields) {
    if (token[field] && typeof token[field] === 'string' && token[field].includes('://')) {
      const extractedScopes = token[field].split(/\s+/);
      extractedScopes.forEach((s: string) => scopes.add(s));
    }
  }

  // If no scopes were found, add a placeholder
  if (scopes.size === 0) {
    scopes.add('unknown_scope');
  }
  
  return Array.from(scopes);
} 