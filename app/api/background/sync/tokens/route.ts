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

async function sendSyncCompletedEmail(userEmail: string, syncId?: string) {
  const transactionalId = process.env.LOOPS_TRANSACTIONAL_ID_SYNC_COMPLETED;
  const loopsApiKey = process.env.LOOPS_API_KEY;

  if (!transactionalId) {
    console.error(`[Tokens Sync ${syncId || ''}] LOOPS_TRANSACTIONAL_ID_SYNC_COMPLETED is not set. Cannot send email.`);
    return;
  }
  if (!loopsApiKey) {
    console.warn(`[Tokens Sync ${syncId || ''}] LOOPS_API_KEY is not set. Email might not send if API key is required.`);
  }
  if (!userEmail) {
    console.error(`[Tokens Sync ${syncId || ''}] User email is not available. Cannot send completion email.`);
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
      console.log(`[Tokens Sync ${syncId || ''}] Sync completed email sent successfully to ${userEmail}:`, responseData);
    } else {
      const errorData = await response.text();
      console.error(`[Tokens Sync ${syncId || ''}] Failed to send sync completed email to ${userEmail}. Status: ${response.status}, Response: ${errorData}`);
    }
  } catch (error) {
    console.error(`[Tokens Sync ${syncId || ''}] Error sending sync completed email to ${userEmail}:`, error);
  }
}

export const maxDuration = 3600; // Set max duration to 1 hour for Railway (supports long-running processes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Railway optimized runtime

export async function POST(request: Request) {
  const startTime = Date.now();
  
  try {
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token,
      users 
    } = await request.json();
    
    if (!organization_id || !access_token || !sync_id) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    console.log(`[Tokens ${sync_id}] Starting token processing for organization: ${organization_id}`);
    
    await processTokens(organization_id, sync_id, access_token, refresh_token, users, request);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Token processing completed successfully',
      processingTime: Date.now() - startTime
    });

  } catch (error: any) {
    console.error('Error in token processing:', error);
    
    // Make sure to update sync status on error
    try {
      await updateSyncStatus(
        'sync_id' in (await request.json()) ? (await request.json()).sync_id : 'unknown',
        -1,
        `Token processing failed: ${error.message}`,
        'FAILED'
      );
    } catch (statusError) {
      console.error('Error updating sync status:', statusError);
    }

    return NextResponse.json(
      { 
        error: 'Failed to process tokens', 
        details: error.message,
        processingTime: Date.now() - startTime
      },
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
    
    // ⭐ MEMORY OPTIMIZATION: Process tokens in batches instead of loading all at once
    await updateSyncStatus(sync_id, 40, 'Starting memory-efficient token processing');
    
    // First, get a count or sample to estimate the workload
    let allApplicationTokens = [];
    try {
      allApplicationTokens = await googleService.getOAuthTokens();
      console.log(`[Tokens ${sync_id}] Found ${allApplicationTokens.length} total application tokens`);
    } catch (tokenError) {
      console.error(`[Tokens ${sync_id}] Error fetching OAuth tokens:`, tokenError);
      await updateSyncStatus(sync_id, -1, 'Failed to fetch application tokens from Google Workspace', 'FAILED');
      throw tokenError;
    }
    
    // ⭐ BATCH PROCESSING: Adaptive batch size based on total tokens for massive organizations
    let BATCH_SIZE = 500; // Default batch size
    
    // Adaptive batching for massive organizations (50k+ users)
    if (allApplicationTokens.length > 10000) {
      BATCH_SIZE = 1000; // Larger batches for big orgs
      console.log(`[Tokens ${sync_id}] Large organization detected, using batch size: ${BATCH_SIZE}`);
    } else if (allApplicationTokens.length > 50000) {
      BATCH_SIZE = 2000; // Even larger batches for massive orgs
      console.log(`[Tokens ${sync_id}] Massive organization detected, using batch size: ${BATCH_SIZE}`);
    }
    
    const totalBatches = Math.ceil(allApplicationTokens.length / BATCH_SIZE);
    
    console.log(`[Tokens ${sync_id}] Processing ${allApplicationTokens.length} tokens in ${totalBatches} batches of ${BATCH_SIZE}`);
    
    // Track processed applications globally
    const globalAppNameMap = new Map<string, any[]>();
    const globalAppsToUpsert: any[] = [];
    const globalUserAppRelations: { appName: string, userId: string, userEmail: string, token: any }[] = [];
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIdx = batchIndex * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, allApplicationTokens.length);
      const tokenBatch = allApplicationTokens.slice(startIdx, endIdx);
      
      const batchProgress = 40 + Math.floor((batchIndex / totalBatches) * 35);
      await updateSyncStatus(
        sync_id, 
        batchProgress, 
        `Processing batch ${batchIndex + 1}/${totalBatches} (${tokenBatch.length} tokens) - ${globalUserAppRelations.length} relations found`
      );
      
      console.log(`[Tokens ${sync_id}] Processing batch ${batchIndex + 1}/${totalBatches}: tokens ${startIdx}-${endIdx}`);
      
      // Group applications in this batch
      const batchAppNameMap = new Map<string, any[]>();
      
      for (const token of tokenBatch) {
      const appName = token.displayText || 'Unknown App';
      
      if (!appName) {
        console.warn('Skipping token with missing app name');
        continue;
      }
      
        if (!batchAppNameMap.has(appName)) {
          batchAppNameMap.set(appName, []);
      }
      
      // Add token with user info
        batchAppNameMap.get(appName)!.push(token);
        
        // Also add to global map for final processing
        if (!globalAppNameMap.has(appName)) {
          globalAppNameMap.set(appName, []);
        }
        globalAppNameMap.get(appName)!.push(token);
      }
      
      // Process batch applications  
      for (const [appName, tokens] of batchAppNameMap.entries()) {
        // Process user relationships for this batch
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
            // Minimal logging for massive organizations to avoid log overflow
            if (globalUserAppRelations.length < 5) {
              console.warn('No matching user found for token:', {
                userKey: userKey || 'missing',
                userEmail: userEmail || 'missing',
                appName: appName
              });
            }
            continue;
          }
          
          // Extract only essential token data to minimize memory usage
          const simplifiedToken = {
            scopes: token.scopes || [],
            displayText: token.displayText || ''
          };
    
          // Check if this user-app relationship already exists
          const existingRelationIndex = globalUserAppRelations.findIndex(rel => 
            rel.appName === appName && rel.userId === userId
          );
          
          if (existingRelationIndex !== -1) {
            // Merge token scopes with existing record
            const existingToken = globalUserAppRelations[existingRelationIndex].token;
            existingToken.scopes = [...new Set([...(existingToken.scopes || []), ...(simplifiedToken.scopes || [])])];
          } else {
            // Add a new relationship
            globalUserAppRelations.push({
              appName,
              userId,
              userEmail: userEmail || '',
              token: simplifiedToken
            });
          }
        }
      }
      
      // Clear batch variables to free memory
      tokenBatch.length = 0;
      batchAppNameMap.clear();
      
      // ⭐ AGGRESSIVE MEMORY CLEANUP for massive organizations
      if (batchIndex % 3 === 0 && global.gc) {
        console.log(`[Tokens ${sync_id}] Memory cleanup after batch ${batchIndex + 1} - ${globalUserAppRelations.length} relations processed`);
        global.gc();
      }
      
      // Dynamic pause based on organization size
      const pauseTime = allApplicationTokens.length > 50000 ? 100 : 50;
      if (batchIndex < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, pauseTime));
      }
    }
    
    // Clear the large array to free memory before final processing
    allApplicationTokens.length = 0;
    
    await updateSyncStatus(sync_id, 75, `Preparing final application data for ${globalAppNameMap.size} applications`);
    
    // Now process the global app map to create final application records
    for (const [appName, tokens] of globalAppNameMap.entries()) {
      // Determine highest risk level based on ALL scopes combined
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
        appRecord.id = existingApp.id;
      } else {
        appRecord.id = crypto.randomUUID();
      }
      
      globalAppsToUpsert.push(appRecord);
    }
    
    // Clear global app map to free memory
    globalAppNameMap.clear();
    
    // Save applications in batches - optimized for massive organizations
    await updateSyncStatus(sync_id, 75, `Saving ${globalAppsToUpsert.length} applications to database`);
    
    // Chunk applications for database operations (Railway can handle larger chunks)
    const APP_CHUNK_SIZE = 100; // Process 100 apps at a time
    let upsertError = null;
    
    try {
      for (let i = 0; i < globalAppsToUpsert.length; i += APP_CHUNK_SIZE) {
        const chunk = globalAppsToUpsert.slice(i, i + APP_CHUNK_SIZE);
        console.log(`[Tokens ${sync_id}] Saving application chunk ${Math.floor(i/APP_CHUNK_SIZE) + 1}/${Math.ceil(globalAppsToUpsert.length/APP_CHUNK_SIZE)} (${chunk.length} apps)`);
        
        const { error } = await supabaseAdmin
          .from('applications')
          .upsert(chunk);
          
        if (error) {
          upsertError = error;
          break;
    }
    
        // Brief pause between chunks for massive datasets
        if (i + APP_CHUNK_SIZE < globalAppsToUpsert.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
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
    console.log(`Prepared ${globalUserAppRelations.length} user-app relations and ${appMap.length} app mappings`);
    if (globalUserAppRelations.length === 0) {
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
          userAppRelations: globalUserAppRelations,
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

      // Fetch user_email and send email
      const { data: syncInfo, error: syncInfoError } = await supabaseAdmin
        .from('sync_status')
        .select('user_email')
        .eq('id', sync_id)
        .single();

      if (syncInfoError) {
        console.error(`[Tokens ${sync_id}] Error fetching sync info for email:`, syncInfoError.message);
      } else if (syncInfo && syncInfo.user_email) {
        await sendSyncCompletedEmail(syncInfo.user_email, sync_id);
      } else {
        console.warn(`[Tokens ${sync_id}] User email not found for sync_id ${sync_id}. Cannot send completion email.`);
      }

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