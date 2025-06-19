import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';

// Configuration optimized for 1 CPU + 2GB RAM - Balanced for speed vs stability
const PROCESSING_CONFIG = {
  BATCH_SIZE: 40, // Increased from 25 for better throughput
  DELAY_BETWEEN_BATCHES: 100, // Reduced from 150ms for faster processing
  DB_OPERATION_DELAY: 50, // Reduced from 75ms for faster DB operations
  MEMORY_CLEANUP_INTERVAL: 75, // Increased from 50 for better speed
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
  const requestData = await request.json(); // Moved up for error handling access
  const { organization_id, sync_id, access_token, refresh_token } = requestData;

  try {
    console.log('Starting user fetch processing');
    
    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Await the processing
    await processUsers(organization_id, sync_id, access_token, refresh_token, request);
    
    // Return success response after processing is done
    return NextResponse.json({ 
      message: 'User fetch completed successfully',
      syncId: sync_id,
      organizationId: organization_id
    });

  } catch (error: any) {
    console.error('Error in user fetch API:', error);
    // Ensure sync status is updated on failure if processUsers throws
    if (sync_id) { // Check if sync_id is available
        await updateSyncStatus(
          sync_id,
          -1,
          `User fetch failed: ${error.message}`,
          'FAILED'
        );
    }
    return NextResponse.json(
      { error: 'Failed to process users', details: error.message },
      { status: 500 }
    );
  }
}

async function processUsers(
  organization_id: string, 
  sync_id: string, 
  access_token: string, 
  refresh_token: string,
  originalRequest: Request
) {
  try {
    console.log(`[Users ${sync_id}] Starting user fetch for organization: ${organization_id}`);
    
    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ 
      access_token,
      refresh_token,
      expiry_date: Date.now() + 3600 * 1000 // Add expiry_date to help with token refresh
    });
    
    await updateSyncStatus(sync_id, 15, 'Fetching users from Google Workspace');
    
    // Fetch users
    let users = [];
    try {
      users = await googleService.getUsersListPaginated();
      console.log(`[Users ${sync_id}] Successfully fetched ${users.length} users`);
    } catch (userFetchError: any) {
      console.error(`[Users ${sync_id}] Error fetching users:`, {
        name: userFetchError?.name,
        message: userFetchError?.message,
        code: userFetchError?.code,
        status: userFetchError?.status,
        response: userFetchError?.response?.data,
      });

      let errorMessage = 'Failed to fetch users from Google Workspace';
      if (userFetchError?.response?.data?.error?.message) {
        errorMessage += `: ${userFetchError.response.data.error.message}`;
      } else if (userFetchError?.message) {
        errorMessage += `: ${userFetchError.message}`;
      }

      // Check if this is an auth error
      const isAuthError = 
        userFetchError?.response?.status === 401 || 
        (userFetchError?.message && userFetchError.message.toLowerCase().includes('auth'));
      
      if (isAuthError) {
        errorMessage = 'Authentication error: Unable to access Google Workspace. Please re-authenticate.';
      }

      await updateSyncStatus(sync_id, -1, errorMessage, 'FAILED');
      throw userFetchError;
    }
    
    await updateSyncStatus(sync_id, 20, `Processing ${users.length} users in batches`);
    
    // Process users in batches to prevent memory issues and database overload
    console.log(`[Users ${sync_id}] Processing ${users.length} users in batches of ${PROCESSING_CONFIG.BATCH_SIZE}`);
    
    let processedCount = 0;
    
    await processInBatches(
      users,
      async (userBatch) => {
        // Create a batch of users to upsert
        const usersToUpsert = userBatch.map((user: any, index: number) => {
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
            
            // Make sure we have a valid Google user ID
            if (!user.id) {
              console.warn(`Missing Google ID for user ${user.primaryEmail} - using email as key`);
            }
            
            return {
              google_user_id: user.id || user.primaryEmail,
              email: user.primaryEmail,
              name: fullName,
              role: role,
              department: department,
              organization_id: organization_id,
              // Additional identifier fields to help with matching
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
          } catch (userError) {
            console.error(`Error processing user ${user.primaryEmail || 'unknown'}:`, userError);
            // Return a minimal valid record
            return {
              google_user_id: user.id || user.primaryEmail || `unknown-${Date.now()}-${Math.random()}`,
              email: user.primaryEmail || `unknown-${processedCount + index}@acme.com`,
              name: 'Unknown User',
              role: 'User',
              department: null,
              organization_id: organization_id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
          }
        });
        
        // Log progress for large batches
        processedCount += userBatch.length;
        if (processedCount % 100 === 0 || processedCount === users.length) {
          const progress = 20 + Math.floor((processedCount / users.length) * 10);
          await updateSyncStatus(sync_id, progress, `Processed ${processedCount}/${users.length} users`);
        }

        // Force memory cleanup periodically
        if (processedCount % PROCESSING_CONFIG.MEMORY_CLEANUP_INTERVAL === 0) {
          forceMemoryCleanup();
        }

        // Process this batch with optimized upsert strategy
        try {
          // Check for existing users by email for this batch
          const batchEmails = usersToUpsert.map(u => u.email);
          const { data: existingUsersData, error: fetchExistingError } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('organization_id', organization_id)
            .in('email', batchEmails);
            
          if (fetchExistingError) throw fetchExistingError;
          
          const existingEmails = new Set(existingUsersData?.map(u => u.email) || []);
          
          const usersToInsert = usersToUpsert.filter(u => !existingEmails.has(u.email));
          const usersToUpdate = usersToUpsert.filter(u => existingEmails.has(u.email));

          // Insert new users in bulk
          if (usersToInsert.length > 0) {
            const { error: insertError } = await supabaseAdmin
              .from('users')
              .insert(usersToInsert);
            if (insertError) {
              console.error(`Error inserting users batch:`, insertError);
              // Continue processing other batches instead of failing completely
            }
          }

          // Update existing users in smaller sub-batches to avoid database timeouts
          if (usersToUpdate.length > 0) {
            const updateBatchSize = 5; // Even smaller batch size for updates on limited resources
            for (let i = 0; i < usersToUpdate.length; i += updateBatchSize) {
              const updateBatch = usersToUpdate.slice(i, i + updateBatchSize);
              
              // Process updates individually to avoid conflicts
              for (const user of updateBatch) {
                try {
                  const { error: updateError } = await supabaseAdmin
                    .from('users')
                    .update({
                      name: user.name,
                      role: user.role,
                      department: user.department,
                      google_user_id: user.google_user_id,
                      updated_at: user.updated_at
                    })
                    .eq('email', user.email)
                    .eq('organization_id', organization_id);
                    
                  if (updateError) {
                    console.error(`Error updating user ${user.email}:`, updateError);
                    // Continue with next user instead of failing
                  }
                } catch (userUpdateError) {
                  console.error(`Error updating individual user ${user.email}:`, userUpdateError);
                  // Continue with next user
                }
              }
              
              // Small delay between update sub-batches
              if (i + updateBatchSize < usersToUpdate.length) {
                await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
              }
            }
          }
          
        } catch (batchError) {
          console.error(`Error processing user batch:`, batchError);
          // Continue with next batch instead of failing completely
        }
        
        // Clear processed data from memory
        usersToUpsert.length = 0;
        userBatch.length = 0;
        
        // Add delay between database operations
        await sleep(PROCESSING_CONFIG.DB_OPERATION_DELAY);
      },
      PROCESSING_CONFIG.BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );
    
    await updateSyncStatus(sync_id, 30, `User sync completed - processed ${users.length} users`);
    
    console.log(`[Users ${sync_id}] User processing completed successfully`);
    
  } catch (error: any) {
    console.error(`[Users ${sync_id}] Error in user processing:`, error);
    throw error;
  }
} 