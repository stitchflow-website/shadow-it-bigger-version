import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';

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
    const response = NextResponse.json({ message: 'User fetch started' });
    
    // Process in the background
    processUsers(organization_id, sync_id, access_token, refresh_token)
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
      { error: 'Failed to process users' },
      { status: 500 }
    );
  }
}

async function processUsers(organization_id: string, sync_id: string, access_token: string, refresh_token: string) {
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
      refresh_token
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
    
    // Update status and trigger token fetch process
    await updateSyncStatus(sync_id, 30, 'Fetching application data from Google Workspace');
    
    // Trigger the next phase of the process - token fetch
    const host = process.env.VERCEL_URL || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const nextUrl = `${protocol}${host}/api/background/sync/tokens`;
    
    console.log(`Triggering token fetch at: ${nextUrl}`);

    const nextResponse = await fetch(nextUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id,
        sync_id,
        access_token,
        refresh_token,
        users: Array.from(userMap.entries()).map(([googleId, userId]) => ({ googleId, userId }))
      }),
    });
    
    if (!nextResponse.ok) {
      const errorText = await nextResponse.text();
      console.error(`Failed to trigger token fetch: ${errorText}`);
      throw new Error(`Failed to trigger token fetch: ${errorText}`);
    }
    
    console.log('User processing completed successfully, tokens processing triggered');
    
  } catch (error: any) {
    console.error('Error in user processing:', error);
    throw error;
  }
} 