import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';
import crypto from 'crypto';

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

// Helper function to wait for users with exponential backoff
async function waitForUsers(organization_id: string, sync_id: string, maxAttempts = 5): Promise<any[]> {
  let attempt = 1;
  let delay = 2000; // Start with 2 seconds

  while (attempt <= maxAttempts) {
    console.log(`[Tokens ${sync_id}] Checking for users attempt ${attempt}/${maxAttempts}`);
    
    const { data: fetchedUsers, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, google_user_id, email')
      .eq('organization_id', organization_id);

    if (userError) {
      console.error(`[Tokens ${sync_id}] Error fetching users:`, userError);
      throw userError;
    }

    if (fetchedUsers && fetchedUsers.length > 0) {
      console.log(`[Tokens ${sync_id}] Found ${fetchedUsers.length} users on attempt ${attempt}`);
      return fetchedUsers;
    }

    // Check sync status to see if user sync failed
    const { data: syncStatus } = await supabaseAdmin
      .from('sync_status')
      .select('status, message')
      .eq('id', sync_id)
      .single();

    if (syncStatus?.status === 'FAILED') {
      throw new Error(`User sync failed: ${syncStatus.message}`);
    }

    console.log(`[Tokens ${sync_id}] No users found yet, waiting ${delay/1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Exponential backoff with max of 10 seconds
    delay = Math.min(delay * 2, 10000);
    attempt++;
  }

  throw new Error('Timeout waiting for users to be processed');
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

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  // Declare requestData here to make sync_id available in catch
  let requestData; 
  try {
    requestData = await request.json();
    const { organization_id, sync_id, access_token, refresh_token, users } = requestData;
    
    console.log(`[Tokens API ${sync_id}] Starting token fetch processing`);
    
    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      console.error(`[Tokens API ${sync_id}] Missing required fields`);
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Await the processTokens function
    await processTokens(organization_id, sync_id, access_token, refresh_token, users, request);
    
    console.log(`[Tokens API ${sync_id}] Token fetch completed successfully`);
    return NextResponse.json({ 
      message: 'Token fetch completed successfully',
      syncId: sync_id,
      organizationId: organization_id
    });

  } catch (error: any) {
    const sync_id_for_error = requestData?.sync_id; // Use optional chaining
    console.error(`[Tokens API ${sync_id_for_error || 'unknown'}] Error:`, error);
    // processTokens is responsible for updating sync_status to FAILED.
    // This handler just ensures a 500 response is sent.
    return NextResponse.json(
      { error: 'Failed to process tokens', details: error.message },
      { status: 500 }
    );
  }
}

async function processTokens(
  organization_id: string, 
  sync_id: string, 
  access_token: string,
  refresh_token: string,
  users: Array<{googleId: string, userId: string}> | undefined,
  request: Request
) {
  try {
    console.log(`[Tokens ${sync_id}] Starting token fetch for organization: ${organization_id}`);
    
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
    
    // Create a user map if one was not provided
    let userMap = new Map<string, string>();
    if (!users || users.length === 0) {
      console.log(`[Tokens ${sync_id}] No user mapping provided, waiting for users in database`);
      
      try {
        const dbUsers = await waitForUsers(organization_id, sync_id);
        
        // Map users by Google ID and email
        dbUsers.forEach(user => {
          if (user.google_user_id) {
            userMap.set(user.google_user_id, user.id);
          }
          if (user.email) {
            userMap.set(user.email.toLowerCase(), user.id);
          }
        });
        
        console.log(`[Tokens ${sync_id}] Successfully mapped ${userMap.size} users`);
      } catch (error) {
        console.error(`[Tokens ${sync_id}] Error waiting for users:`, error);
        await updateSyncStatus(sync_id, -1, `Failed to get users: ${(error as Error).message}`, 'FAILED');
        throw error;
      }
    } else {
      console.log(`[Tokens ${sync_id}] Using provided user mapping with ${users.length} entries`);
      users.forEach(user => {
        userMap.set(user.googleId, user.userId);
      });
    }
    
    console.log(`[Tokens ${sync_id}] User map has ${userMap.size} entries`);
    
    // Fetch OAuth tokens
    let applicationTokens = [];
    try {
      await updateSyncStatus(sync_id, 40, 'Fetching application tokens from Google Workspace');
      applicationTokens = await googleService.getOAuthTokens();
      console.log(`[Tokens ${sync_id}] Fetched ${applicationTokens.length} application tokens`);
    } catch (tokenError) {
      console.error(`[Tokens ${sync_id}] Error fetching OAuth tokens:`, tokenError);
      await updateSyncStatus(sync_id, -1, 'Failed to fetch application tokens from Google Workspace', 'FAILED');
      throw tokenError;
    }
    
    await updateSyncStatus(sync_id, 50, `Processing ${applicationTokens.length} application tokens`);
    
    // Group applications by display name
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
    
    console.log(`[Tokens ${sync_id}] Grouped tokens into ${appNameMap.size} applications`);
    
    // Prepare bulk upsert operations
    const applicationsToUpsert: any[] = [];
    const userAppRelationsToProcess: { appName: string, userId: string, userEmail: string, token: any }[] = [];
    
    // Process each application
    let appCount = 0;
    const totalApps = appNameMap.size;
    
    for (const [appName, tokens] of appNameMap.entries()) {
      appCount++;
      const progressPercent = 50 + Math.floor((appCount / totalApps) * 25);
      
      if (appCount % 10 === 0 || appCount === totalApps) {
        await updateSyncStatus(
          sync_id, 
          progressPercent, 
          `Processing application ${appCount}/${totalApps}`
        );
      }
      
      // Determine highest risk level based on ALL scopes combined
      // This ensures app risk level properly reflects all scopes across all users
      const allScopesForRiskEvaluation = new Set<string>();
      tokens.forEach((token: any) => {
        if (token.scopes && Array.isArray(token.scopes)) {
          token.scopes.forEach((scope: string) => allScopesForRiskEvaluation.add(scope));
        }
      });

      // Now evaluate risk based on the combined set of scopes
      const highestRiskLevel = determineRiskLevel(Array.from(allScopesForRiskEvaluation));
      
      // Check if app already exists
      const { data: existingApp } = await supabaseAdmin
        .from('applications')
        .select('id')
        .eq('name', appName)
        .eq('organization_id', organization_id)
        .maybeSingle();
      
      // Add to batch of applications to upsert
      const appRecord: any = {
        google_app_id: tokens.map(t => t.clientId).join(','),
        name: appName,
        category: 'Unknown',
        risk_level: highestRiskLevel,
        total_permissions: allScopesForRiskEvaluation.size,
        all_scopes: Array.from(allScopesForRiskEvaluation),
        organization_id: organization_id,
        updated_at: new Date().toISOString()
      };
      
      if (existingApp) {
        // Update existing app with its ID
        appRecord.id = existingApp.id;
      } else {
        // Generate a new UUID for new applications
        appRecord.id = crypto.randomUUID();
      }
      
      applicationsToUpsert.push(appRecord);
      
      // Process each token to create user-application relationships
      for (const token of tokens) {
        const userKey = token.userKey;
        const userEmail = token.userEmail;
        
        // Try to get user ID from map using different keys
        let userId = null;
        
        // Try by Google user ID first
        if (userKey && userMap.has(userKey)) {
          userId = userMap.get(userKey);
        }
        
        // Fall back to email if available
        if (!userId && userEmail) {
          // Try normalized email
          const normalizedEmail = userEmail.toLowerCase();
          if (userMap.has(normalizedEmail)) {
            userId = userMap.get(normalizedEmail);
          }
        }
        
        if (!userId) {
          // Log the missing user details for debugging
          console.warn('No matching user found for token:', {
            userKey: userKey || 'missing',
            userEmail: userEmail || 'missing',
            appName: appName
          });
          continue;
        }
        
        // Extract only the necessary parts of the token to avoid serialization issues
        const simplifiedToken = {
          scopes: token.scopes || [],
          scopeData: token.scopeData || [],
          scope: token.scope || '',
          permissions: token.permissions || [],
          displayText: token.displayText || ''
        };
        
        // Log the first token for debugging
        if (userAppRelationsToProcess.length === 0) {
          console.log('First token example (simplified):', JSON.stringify(simplifiedToken));
        }
        
        // Check if this user-app relationship already exists in our processing list
        const existingRelationIndex = userAppRelationsToProcess.findIndex(rel => 
          rel.appName === appName && rel.userId === userId
        );
        
        if (existingRelationIndex !== -1) {
          // Merge token scopes with existing record instead of duplicating
          const existingToken = userAppRelationsToProcess[existingRelationIndex].token;
          existingToken.scopes = [...new Set([...(existingToken.scopes || []), ...(simplifiedToken.scopes || [])])];
          
          // Merge other scope data if needed
          if (simplifiedToken.scopeData && simplifiedToken.scopeData.length > 0) {
            existingToken.scopeData = [...(existingToken.scopeData || []), ...simplifiedToken.scopeData];
          }
          
          // Update the scope string if needed
          if (simplifiedToken.scope) {
            existingToken.scope = existingToken.scope 
              ? `${existingToken.scope} ${simplifiedToken.scope}`
              : simplifiedToken.scope;
          }
          
          // Update permissions if needed
          if (simplifiedToken.permissions && simplifiedToken.permissions.length > 0) {
            existingToken.permissions = [...(existingToken.permissions || []), ...simplifiedToken.permissions];
          }
        } else {
          // Add a new relationship if none exists
          userAppRelationsToProcess.push({
            appName,
            userId,
            userEmail: userEmail || '',
            token: simplifiedToken
          });
        }
      }
    }
    
    // Save applications in batches
    await updateSyncStatus(sync_id, 75, `Saving ${applicationsToUpsert.length} applications`);
    
    let upsertError = null;
    try {
      const { error } = await supabaseAdmin
        .from('applications')
        .upsert(applicationsToUpsert);
        
      upsertError = error;
    } catch (err) {
      console.error('Error during application upsert:', err);
      upsertError = err;
    }
    
    if (upsertError) {
      console.error(`[Tokens ${sync_id}] Error upserting applications:`, upsertError);
      await updateSyncStatus(sync_id, -1, 'Failed to save application data', 'FAILED');
      throw upsertError;
    }
    
    // Get the latest application IDs for the relationship mapping
    const { data: dbApps } = await supabaseAdmin
      .from('applications')
      .select('id, name')
      .eq('organization_id', organization_id);
    
    // Create a mapping for quick lookup (app name -> app ID)
    const appNameToIdMap = new Map<string, string>();
    if (dbApps) {
      dbApps.forEach(app => {
        appNameToIdMap.set(app.name, app.id);
      });
    }
    
    // Get URL info for API calls
    const selfUrl = request.headers.get('host') || process.env.VERCEL_URL || 'localhost:3000';
    const protocol = selfUrl.includes('localhost') ? 'http://' : 'https://';
    
    // Trigger app categorization process in parallel
    const categorizeUrl = `${protocol}${selfUrl}/api/background/sync/categorize`;
    
    console.log(`[Tokens ${sync_id}] Triggering app categorization at: ${categorizeUrl}`);
    
    // Prepare user app relationships for the next phase
    await updateSyncStatus(sync_id, 80, `Preparing user-application relationships`);
    // Construct a data structure for relations processing
    const appMap = Array.from(appNameToIdMap.entries()).map(([appName, appId]) => ({ appName, appId }));
    // Trigger the final phase - the relationships processing
    await updateSyncStatus(sync_id, 80, 'Saving application token relationships');
    // Use the same URL variables defined earlier
    const nextUrl = `${protocol}${selfUrl}/api/background/sync/relations`;
    console.log(`Triggering relations processing at: ${nextUrl}`);
    console.log(`Prepared ${userAppRelationsToProcess.length} user-app relations and ${appMap.length} app mappings`);
    if (userAppRelationsToProcess.length === 0) {
      console.warn(`[Tokens ${sync_id}] No user-application relations to process - check user mapping and token data`);
      // Mark sync as completed even if no relations (fixes 'unknown' category issue)
      await updateSyncStatus(
        sync_id, 
        100, 
        `Processing complete. No user-application relations could be created - user IDs may not match.`,
        'COMPLETED'
      );
      // Fire-and-forget categorization
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id, sync_id }),
      }).catch(error => {
        console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      });
      return;
    }
    try {
      const nextResponse = await fetch(nextUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id,
          sync_id,
          userAppRelations: userAppRelationsToProcess,
          appMap: appMap
        }),
      });
      if (!nextResponse.ok) {
        const errorText = await nextResponse.text();
        console.error(`Failed to trigger relations processing: ${nextResponse.status} ${nextResponse.statusText}`);
        console.error(`Response details: ${errorText}`);
        // Mark sync as completed even if some relations failed
        await updateSyncStatus(
          sync_id, 
          100, 
          `Processing continuing with some issues. Some relationships could not be processed.`,
          'COMPLETED'
        );
        // Fire-and-forget categorization
        fetch(categorizeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organization_id, sync_id }),
        }).catch(error => {
          console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
        });
        return;
      }
      // Mark sync as completed after user-app mapping, before categorization
      await updateSyncStatus(
        sync_id, 
        100, 
        `Token processing complete, finalizing data...`,
        'COMPLETED'
      );
      // Fire-and-forget categorization (do not await)
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id, sync_id }),
      }).catch(error => {
        console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      });
      console.log(`[Tokens ${sync_id}] Token processing completed successfully`);
    } catch (relationError) {
      console.error(`[Tokens ${sync_id}] Error triggering relations processing:`, relationError);
      // Mark sync as completed even if some relations failed
      await updateSyncStatus(
        sync_id, 
        100, 
        `Processing continuing with some issues. Some relationships could not be processed.`,
        'COMPLETED'
      );
      // Fire-and-forget categorization
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id, sync_id }),
      }).catch(error => {
        console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      });
    }
  } catch (error: any) {
    console.error(`[Tokens ${sync_id}] Error in token processing:`, error);
    // Ensure sync_status is updated to FAILED
    await updateSyncStatus(
      sync_id,
      -1,
      `Token processing failed: ${error.message}`,
      'FAILED'
    );
    throw error; // Rethrow to be caught by the POST handler's catch for HTTP response
  }
}