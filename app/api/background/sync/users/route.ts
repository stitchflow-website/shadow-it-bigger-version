import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';

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

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

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
    
    await updateSyncStatus(sync_id, 20, `Processing ${users.length} users`);
    
    // Create a batch of all users to upsert
    const usersToUpsert = users.map((user: any, index: number) => {
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
          email: user.primaryEmail || `unknown-${index}@example.com`,
          name: 'Unknown User',
          role: 'User',
          department: null,
          organization_id: organization_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }
    });
    
    // Log a sample of users for debugging
    if (usersToUpsert.length > 0) {
      console.log('Sample user data:', usersToUpsert.slice(0, 2));
    }

    // Check for existing users by email and separate insert/update
    const { data: existingUsersData, error: fetchExistingError } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('organization_id', organization_id);
    if (fetchExistingError) throw fetchExistingError;
    const existingEmails = new Set(existingUsersData.map(u => u.email));

    const usersToInsert = usersToUpsert.filter(u => !existingEmails.has(u.email));
    const usersToUpdate = usersToUpsert.filter(u => existingEmails.has(u.email));

    if (usersToInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert(usersToInsert);
      if (insertError) throw insertError;
    }

    for (const user of usersToUpdate) {
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
      if (updateError) throw updateError;
    }
    
    await updateSyncStatus(sync_id, 30, 'User sync completed');
    
    console.log('User processing completed successfully');
    
  } catch (error: any) {
    console.error('Error in user processing:', error);
    throw error;
  }
} 