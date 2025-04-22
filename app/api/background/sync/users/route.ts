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
  try {
    console.log('Starting user fetch processing');
    
    const requestData = await request.json();
    const { organization_id, sync_id, access_token, refresh_token } = requestData;

    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Send immediate response
    const response = NextResponse.json({ 
      message: 'User fetch started',
      syncId: sync_id,
      organizationId: organization_id
    });
    
    // Process in the background
    processUsers(organization_id, sync_id, access_token, refresh_token, request)
      .catch(async (error) => {
        console.error('User processing failed:', error);
        await updateSyncStatus(
          sync_id,
          -1,
          `User fetch failed: ${error.message}`,
          'FAILED'
        );
      });
    
    return response;
  } catch (error: any) {
    console.error('Error in user fetch API:', error);
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
    
    await updateSyncStatus(sync_id, 30, 'User sync completed');
    
    console.log('User processing completed successfully');
    
  } catch (error: any) {
    console.error('Error in user processing:', error);
    throw error;
  }
} 