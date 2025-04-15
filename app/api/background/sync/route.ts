import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';

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

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    console.log('1. Starting background sync API endpoint');
    
    const requestData = await request.json();
    console.log('2. Received request data:', {
      organization_id: requestData.organization_id ? 'present' : 'missing',
      sync_id: requestData.sync_id ? 'present' : 'missing',
      access_token: requestData.access_token ? 'present' : 'missing',
      refresh_token: requestData.refresh_token ? 'present' : 'missing',
      user_email: requestData.user_email ? 'present' : 'missing',
      user_hd: requestData.user_hd ? 'present' : 'missing'
    });

    const { organization_id, sync_id, access_token, refresh_token } = requestData;

    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      console.error('3. Missing required fields:', {
        organization_id: !organization_id,
        sync_id: !sync_id,
        access_token: !access_token,
        refresh_token: !refresh_token
      });
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    console.log('4. All required fields present, sending immediate response');
    
    // Create a record in the database to track this sync job's progress
    await updateSyncStatus(sync_id, 5, 'Sync started - initializing credentials');
    
    try {
      // Initialize Google Workspace service
      console.log(`Initializing Google Workspace service for organization: ${organization_id}`);
      const googleService = new GoogleWorkspaceService({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      });

      // Set credentials
      console.log('Setting credentials');
      await googleService.setCredentials({ 
        access_token,
        refresh_token
      });
      
      // Update status and trigger the first phase
      await updateSyncStatus(sync_id, 10, 'Fetching users from Google Workspace');
      
      // Make a request to self to start the user fetching process
      const selfUrl = request.headers.get('host') || 'localhost:3000';
      const protocol = selfUrl.includes('localhost') ? 'http://' : 'https://';
      const fetchUsersUrl = `${protocol}${selfUrl}/api/background/sync/users`;
      
      console.log(`Triggering user fetch at: ${fetchUsersUrl}`);
      
      // Trigger the first phase of processing
      const fetchResponse = await fetch(fetchUsersUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id,
          sync_id,
          access_token,
          refresh_token
        }),
      });
      
      if (!fetchResponse.ok) {
        console.error('Failed to trigger user fetch:', await fetchResponse.text());
      } else {
        console.log('User fetch job triggered successfully');
      }
    } catch (error) {
      console.error('Error initializing background process:', error);
      await updateSyncStatus(
        sync_id,
        -1,
        `Failed to start background process: ${(error as Error).message}`,
        'FAILED'
      );
    }
    
    // Send immediate response
    return NextResponse.json({ message: 'Sync started in background' });
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
    console.log(`[Background ${sync_id}] 1. Starting background process for organization: ${organization_id}`);
    
    // Initialize Google Workspace service
    console.log(`[Background ${sync_id}] 2. Initializing Google Workspace service`);
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    console.log(`[Background ${sync_id}] 3. Setting credentials`);
    try {
    await googleService.setCredentials({ 
      access_token,
      refresh_token
    });
      console.log(`[Background ${sync_id}] Credentials set successfully`);
    } catch (credError: any) {
      console.error(`[Background ${sync_id}] Error setting credentials:`, {
        message: credError?.message,
        code: credError?.code,
        status: credError?.status,
        stack: credError?.stack
      });
      await updateSyncStatus(sync_id, -1, 'Failed to set Google API credentials', 'FAILED');
      throw credError;
    }

    // Step 1: Fetch users list using pagination (20% progress)
    console.log(`[Background ${sync_id}] 4. Starting user fetch`);
    await updateSyncStatus(sync_id, 10, 'Fetching users from Google Workspace');
    
    let users = [];
    try {
      console.log(`[Background ${sync_id}] Calling getUsersListPaginated`);
      users = await googleService.getUsersListPaginated();
      console.log(`[Background ${sync_id}] 5. Successfully fetched ${users.length} users`);
    } catch (userFetchError: any) {
      console.error(`[Background ${sync_id}] Error fetching users:`, {
        name: userFetchError?.name,
        message: userFetchError?.message,
        code: userFetchError?.code,
        status: userFetchError?.status,
        response: userFetchError?.response?.data,
        stack: userFetchError?.stack
      });

      let errorMessage = 'Failed to fetch users from Google Workspace';
      if (userFetchError?.response?.data?.error?.message) {
        errorMessage += `: ${userFetchError.response.data.error.message}`;
      } else if (userFetchError?.message) {
        errorMessage += `: ${userFetchError.message}`;
      }

      await updateSyncStatus(sync_id, -1, errorMessage, 'FAILED');
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
    let applicationTokens = [];
    try {
      applicationTokens = await googleService.getOAuthTokens();
    console.log(`Fetched ${applicationTokens.length} application tokens`);
    } catch (tokenError) {
      console.error('Error fetching OAuth tokens:', tokenError);
      await updateSyncStatus(sync_id, -1, 'Failed to fetch application data from Google Workspace', 'FAILED');
      throw tokenError;
    }
    
    await updateSyncStatus(sync_id, 40, `Processing ${applicationTokens.length} application connections`);
    
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
    
    // First build the list of applications to upsert in a single batch
    for (const [appName, tokens] of appNameMap.entries()) {
      appCount++;
      const progressPercent = 40 + Math.floor((appCount / totalApps) * 20);
      
      if (appCount % 10 === 0 || appCount === totalApps) {
        await updateSyncStatus(
          sync_id, 
          progressPercent, 
          `Preparing applications batch: ${appCount}/${totalApps}`
        );
      }
      
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
    
    // Bulk upsert all applications at once
    await updateSyncStatus(sync_id, 60, `Upserting ${applicationsToUpsert.length} applications`);
    
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
      console.error('Error during application upsert operations:', error);
      throw error;
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