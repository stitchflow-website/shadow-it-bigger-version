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
  try {
    console.log('Starting token fetch processing');
    
    const requestData = await request.json();
    const { organization_id, sync_id, access_token, refresh_token, users } = requestData;

    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Send immediate response
    const response = NextResponse.json({ message: 'Token fetch started' });
    
    // Process in the background - pass the request object
    processTokens(organization_id, sync_id, access_token, refresh_token, users, request)
      .catch(async (error) => {
        console.error('Token processing failed:', error);
        await updateSyncStatus(
          sync_id,
          -1,
          `Token fetch failed: ${error.message}`,
          'FAILED'
        );
      });
    
    return response;
  } catch (error: any) {
    console.error('Error in token fetch API:', error);
    return NextResponse.json(
      { error: 'Failed to process tokens' },
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

    console.log(`[Tokens ${sync_id}] Setting credentials`);
    await googleService.setCredentials({ 
      access_token,
      refresh_token
    });
    
    // Create a user map if one was not provided
    let userMap = new Map<string, string>();
    if (!users || users.length === 0) {
      console.log(`[Tokens ${sync_id}] No user mapping provided, fetching from database`);
      
      // First try to fetch users with their Google user IDs
      const { data: dbUsers, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, google_user_id, email')
        .eq('organization_id', organization_id);
      
      if (userError) {
        console.error(`[Tokens ${sync_id}] Error fetching users:`, userError);
      }
        
      if (dbUsers && dbUsers.length > 0) {
        console.log(`[Tokens ${sync_id}] Found ${dbUsers.length} users in the database`);
        
        // Map users by Google ID
        dbUsers.forEach(user => {
          if (user.google_user_id) {
            userMap.set(user.google_user_id, user.id);
          }
          // Also map by email as a fallback
          if (user.email) {
            userMap.set(user.email.toLowerCase(), user.id);
          }
        });
        
        // Log first few entries for debugging
        const mapEntries = Array.from(userMap.entries()).slice(0, 5);
        console.log(`[Tokens ${sync_id}] Sample user map entries:`, mapEntries);
      } else {
        console.warn(`[Tokens ${sync_id}] No users found in the database for organization ${organization_id}`);
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
      
      // Calculate total unique permissions
      const allScopes = new Set<string>();
      tokens.forEach((token: any) => {
        if (token.scopes && Array.isArray(token.scopes)) {
          token.scopes.forEach((scope: string) => allScopes.add(scope));
        }
      });
      
      // Determine highest risk level
      const highestRiskLevel = tokens.reduce((highest: string, token: any) => {
        const tokenRisk = determineRiskLevel(token.scopes);
        if (tokenRisk === 'HIGH') return 'HIGH';
        if (tokenRisk === 'MEDIUM' && highest !== 'HIGH') return 'MEDIUM';
        return highest;
      }, 'LOW');
      
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
        total_permissions: allScopes.size,
        all_scopes: Array.from(allScopes),
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
        
        userAppRelationsToProcess.push({
          appName,
          userId,
          userEmail: userEmail || '',
          token: simplifiedToken
        });
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
    
    // Fire and forget - don't await the response
    fetch(categorizeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id,
        sync_id
      }),
    }).catch(error => {
      console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      // Continue with main sync process even if categorization fails
    });
    
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
    
    // If no relations were found, log the issue and complete
    if (userAppRelationsToProcess.length === 0) {
      console.warn(`[Tokens ${sync_id}] No user-application relations to process - check user mapping and token data`);
      await updateSyncStatus(
        sync_id, 
        90, 
        `Completed with partial data. No user-application relations could be created - user IDs may not match.`,
        'COMPLETED'
      );
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
        
        // Despite the error, mark as partially complete since we have user and app data
        await updateSyncStatus(
          sync_id, 
          90, 
          `Completed with partial data. User and app information was saved, but relationships could not be processed.`,
          'COMPLETED'
        );
        return;
      }
      
      console.log(`[Tokens ${sync_id}] Token processing completed successfully`);
    } catch (error: any) {
      console.error(`[Tokens ${sync_id}] Error triggering relations processing:`, error);
      
      // Mark as partially complete
      await updateSyncStatus(
        sync_id, 
        90, 
        `Completed with partial data. User and app information was saved, but relationships could not be processed: ${error.message}`,
        'COMPLETED'
      );
    }
    
  } catch (error: any) {
    console.error(`[Tokens ${sync_id}] Error in token processing:`, error);
    throw error;
  }
}