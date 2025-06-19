import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Configuration optimized for 1 CPU + 2GB RAM - Balanced for speed vs stability
const PROCESSING_CONFIG = {
  BATCH_SIZE: 25, // Increased from 15 for better throughput
  DELAY_BETWEEN_BATCHES: 100, // Reduced from 150ms for faster processing
  DB_OPERATION_DELAY: 50, // Reduced from 75ms for faster DB operations
  MAX_RELATIONS_PER_BATCH: 50, // Increased from 30 for better throughput
  MEMORY_CLEANUP_INTERVAL: 100, // Increased from 75 for better speed
};

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to process in controlled batches
async function processInBatches<T>(
  items: T[], 
  processor: (batch: T[]) => Promise<void>,
  batchSize: number = PROCESSING_CONFIG.BATCH_SIZE,
  delay: number = PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processor(batch);
    
    // Add delay between batches to prevent overwhelming the system
    if (i + batchSize < items.length) {
      await sleep(delay);
    }
  }
}

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
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
      console.error(`Error updating sync status: ${error.message}`);
    }
    
    return { success: !error };
  } catch (err) {
    console.error('Unexpected error in updateSyncStatus:', err);
    return { success: false };
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

// export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
// export const dynamic = 'force-dynamic';
// export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  let requestData;
  try {
    console.log('Starting relations processing');
    
    requestData = await request.json();
    const { 
      organization_id, 
      sync_id, 
      userAppRelations, 
      appMap 
    } = requestData;

    console.log(`[Relations API ${sync_id}] Received request`);

    // Validate required fields
    if (!organization_id || !sync_id) {
      console.error(`[Relations API ${sync_id}] Missing organization_id or sync_id`);
      return NextResponse.json(
        { error: 'Missing organization_id or sync_id' },
        { status: 400 }
      );
    }

    // Check for optional fields - if missing, we'll use empty arrays
    const relations = userAppRelations || [];
    const apps = appMap || [];

    console.log(`[Relations API ${sync_id}] Processing ${relations.length} relations and ${apps.length} apps for processing`);

    // Only process if we have data
    if (relations.length > 0 && apps.length > 0) {
      await processRelations(organization_id, sync_id, relations, apps);
    } else {
      // If no data to process, just update the status
      console.log(`[Relations API ${sync_id}] No relations or apps to process for sync ${sync_id}`);
      
      await updateSyncStatus(
        sync_id, 
        89, // Consistent progress point indicating this step is done
        `Relations processing skipped - no data provided`,
        'IN_PROGRESS' // Keep IN_PROGRESS as this is not the final overall step
      );
    }
    
    console.log(`[Relations API ${sync_id}] Relations processing completed successfully`);
    return NextResponse.json({ 
      message: 'Relations processing completed successfully',
      syncId: sync_id 
    });

  } catch (error: any) {
    const sync_id_for_error = requestData?.sync_id;
    console.error(`[Relations API ${sync_id_for_error || 'unknown'}] Error:`, error);
    // processRelations is responsible for updating sync_status to FAILED.
    return NextResponse.json(
      { error: 'Failed to process relations', details: error.message },
      { status: 500 }
    );
  }
}

async function processRelations(
  organization_id: string, 
  sync_id: string, 
  userAppRelations: Array<{appName: string, userId: string, userEmail: string, token: any}>,
  appMap: Array<{appName: string, appId: string}>
) {
  try {
    console.log(`[Relations ${sync_id}] Starting relations processing for organization: ${organization_id}`);
    
    // Create a mapping of app names to IDs
    const appIdMap = new Map<string, string>();
    appMap.forEach(app => {
      appIdMap.set(app.appName, app.appId);
    });
    
    await updateSyncStatus(sync_id, 85, `Processing ${userAppRelations.length} user-application relations in batches`);
    
    // First, get all existing relationships with scopes in batches to avoid memory issues
    console.log(`[Relations ${sync_id}] Fetching existing relationships in batches`);
    
    const existingRelMap = new Map<string, {id: string, scopes: string[]}>();
    let offset = 0;
    const fetchBatchSize = 500; // Smaller fetch batch size for limited memory
    
    while (true) {
      const { data: existingRelations, error: relError } = await supabaseAdmin
        .from('user_applications')
        .select('id, user_id, application_id, scopes')
        .range(offset, offset + fetchBatchSize - 1);
      
      if (relError) {
        console.error('Error fetching existing relationships:', relError);
        throw relError;
      }
      
      if (!existingRelations || existingRelations.length === 0) {
        break; // No more data
      }
      
      // Add to our map
      existingRelations.forEach(rel => {
        const key = `${rel.user_id}-${rel.application_id}`;
        existingRelMap.set(key, {
          id: rel.id,
          scopes: rel.scopes || []
        });
      });
      
      // If we got less than the batch size, we're done
      if (existingRelations.length < fetchBatchSize) {
        break;
      }
      
      offset += fetchBatchSize;
      
      // Force memory cleanup after every few fetches
      if (offset % (fetchBatchSize * 3) === 0) {
        forceMemoryCleanup();
      }
      
      // Add small delay between fetches
      await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
    }
    
    console.log(`[Relations ${sync_id}] Found ${existingRelMap.size} existing relationships`);
    
    // Group relations by user-app pair to combine scopes more efficiently
    const relationsByUserAppPair = new Map<string, {
      userId: string,
      appId: string,
      appName: string,
      scopes: Set<string>
    }>();
    
    // Process relations in batches to prevent memory overload
    console.log(`[Relations ${sync_id}] Processing ${userAppRelations.length} relations in batches of ${PROCESSING_CONFIG.MAX_RELATIONS_PER_BATCH}`);
    
    await processInBatches(
      userAppRelations,
      async (relationBatch) => {
        for (const relation of relationBatch) {
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
      },
      PROCESSING_CONFIG.MAX_RELATIONS_PER_BATCH,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );
    
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
    
    console.log(`[Relations ${sync_id}] Processing ${relationsToUpdate.length} updates and ${relationsToInsert.length} inserts`);
    
    await updateSyncStatus(sync_id, 90, `Saving user-application relationships`);
    
    // Handle updates in batches with proper error handling
    if (relationsToUpdate.length > 0) {
      await processInBatches(
        relationsToUpdate,
        async (updateBatch) => {
          try {
            const { error: updateError } = await supabaseAdmin
              .from('user_applications')
              .upsert(updateBatch, {
                onConflict: 'user_id,application_id',
                ignoreDuplicates: true
              });
                  
            if (updateError) {
              console.error(`[Relations ${sync_id}] Error updating batch:`, updateError);
              // Continue processing other batches instead of failing completely
            }
          } catch (updateError) {
            console.error(`[Relations ${sync_id}] Error updating user-application relationships batch:`, updateError);
            // Continue processing other batches
          }
          
          // Small delay between database operations
          await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
        },
        PROCESSING_CONFIG.BATCH_SIZE,
        PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
      );
    }
    
    // Process inserts in batches with proper error handling
    let insertSuccess = true;
    if (relationsToInsert.length > 0) {
      await processInBatches(
        relationsToInsert,
        async (insertBatch) => {
          try {
            const { error: insertError } = await supabaseAdmin
              .from('user_applications')
              .upsert(insertBatch, { 
                onConflict: 'user_id,application_id',
                ignoreDuplicates: true 
              });
                  
            if (insertError) {
              console.error(`[Relations ${sync_id}] Error inserting batch:`, insertError);
              insertSuccess = false;
              // Continue processing other batches
            }
          } catch (insertError) {
            console.error(`[Relations ${sync_id}] Error inserting user-application relationships batch:`, insertError);
            insertSuccess = false;
            // Continue processing other batches
          }
          
          // Small delay between database operations
          await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
        },
        PROCESSING_CONFIG.BATCH_SIZE,
        PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
      );
    }
    
    // Clear memory by removing large objects
    relationsByUserAppPair.clear();
    existingRelMap.clear();
    
    // Finalize (89% progress to allow tokens step to complete)
    let finalMessage = `User-application relationships processed successfully.`;
    if (!insertSuccess) {
      finalMessage = `Sync completed with some issues - User and application data was saved, but some relationships may be incomplete`;
    }
    
    await updateSyncStatus(
      sync_id, 
      89, // Adjusted progress: Tokens step will take it to 90%
      finalMessage,
      'IN_PROGRESS' // Changed from COMPLETED
    );
    
    console.log(`[Relations ${sync_id}] Relations processing completed successfully (within processRelations)`);
    
  } catch (error: any) {
    console.error(`[Relations ${sync_id}] Error in relations processing:`, error);
    
    // Even if there was an error, mark as completed with partial data
    await updateSyncStatus( // Ensure await
      sync_id, 
      88, // Adjusted progress for failure at this stage
      `Relations processing failed: ${error.message}`,
      'FAILED' // Status is FAILED
    );
    
    // Don't rethrow the error - we've handled it
    throw error; // Rethrow so POST handler can return 500
  }
} 