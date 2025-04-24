import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';

export async function POST(request: Request) {
  let syncRecord: any = null;
  
  try {
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token,
      user_email,
      user_hd 
    } = await request.json();

    if (!organization_id || !access_token || !sync_id) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    syncRecord = { id: sync_id, organization_id };

    // Initialize Google service
    console.log('Initializing Google Workspace service...');
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    // Set credentials
    await googleService.setCredentials({ 
      access_token,
      refresh_token 
    });

    // Update sync status to indicate progress
    console.log('Updating sync status to 20%...');
    await updateSyncStatus(sync_id, 20, 'Fetching users from Google Workspace');

    // Fetch users from Google Workspace
    console.log('Fetching users from Google Workspace...');
    const users = await googleService.getUsersList();
    console.log(`Fetched ${users.length} users from Google Workspace`);

    // Update users in database
    console.log('Updating users in database...');
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert(
        users.map((user: any) => ({
          organization_id,
          google_user_id: user.id,
          email: user.primaryEmail,
          name: user.name?.fullName,
          role: user.organizations?.[0]?.title,
          department: user.organizations?.[0]?.department,
          last_login: user.lastLoginTime,
          updated_at: new Date().toISOString(),
        }))
      );

    if (usersError) {
      console.error('Error upserting users:', usersError);
      throw usersError;
    }

    // Update sync status for token fetch
    console.log('Updating sync status to 60%...');
    await updateSyncStatus(sync_id, 60, 'Fetching application data');

    // Fetch OAuth tokens
    console.log('Fetching OAuth tokens...');
    const tokens = await googleService.getOAuthTokens();
    console.log(`Fetched ${tokens.length} application tokens`);

    // Process applications and tokens
    console.log('Processing applications and tokens...');
    const processedApps = new Map(); // Track processed apps to avoid duplicates
    const appUsers = new Map(); // Track users per app

    // First pass: Group tokens by app and collect all users
    for (const token of tokens) {
      const appId = token.clientId;
      if (!appUsers.has(appId)) {
        appUsers.set(appId, new Set());
      }
      appUsers.get(appId).add(token.userEmail);
    }

    // Second pass: Process apps and create relationships
    for (const token of tokens) {
      try {
        const appId = token.clientId;
        let app;

        // Create or get application
        if (!processedApps.has(appId)) {
          // Get existing app first
          const { data: existingApp } = await supabaseAdmin
            .from('applications')
            .select('id, category, risk_level, management_status')
            .eq('google_app_id', appId)
            .eq('organization_id', organization_id)
            .single();

          const { data: newApp, error: appError } = await supabaseAdmin
            .from('applications')
            .upsert({
              id: existingApp?.id, // Include if exists
              organization_id,
              name: token.displayText || 'Unknown App',
              google_app_id: appId,
              category: existingApp?.category || 'uncategorized',
              risk_level: existingApp?.risk_level || 'LOW',
              management_status: existingApp?.management_status || 'NEEDS_REVIEW',
              total_permissions: token.scopes?.length || 0,
              all_scopes: token.scopes || [],
              user_count: appUsers.get(appId).size,
              updated_at: new Date().toISOString()
            })
            .select()
            .single();

          if (appError) {
            console.error('Error upserting application:', appError);
            continue;
          }

          processedApps.set(appId, newApp);
          app = newApp;
          
          console.log(`Processed app ${token.displayText} with ${appUsers.get(appId).size} users`);
        } else {
          app = processedApps.get(appId);
        }

        // Create user-application relationship
        await createUserAppRelationship(app.id, token, organization_id);
      } catch (error) {
        console.error('Error processing token:', error);
      }
    }

    // Update sync status for categorization
    console.log('Updating sync status for categorization...');
    await updateSyncStatus(sync_id, 85, 'Categorizing applications');

    // Trigger categorization
    try {
      console.log('Triggering application categorization...');
      const categorizationResponse = await fetch(`${(request as NextRequest).nextUrl.origin}/tools/shadow-it-scan/api/background/sync/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id,
          sync_id
        }),
      });

      if (!categorizationResponse.ok) {
        console.error('Failed to trigger categorization:', await categorizationResponse.text());
      } else {
        console.log('Successfully triggered categorization');
      }
    } catch (error) {
      console.error('Error triggering categorization:', error);
    }

    // Mark sync as completed
    console.log('Marking sync as completed...');
    await updateSyncStatus(sync_id, 100, 'Google Workspace sync completed', 'COMPLETED');

    console.log('Google sync completed successfully');
    return NextResponse.json({ 
      success: true, 
      message: 'Google sync completed',
      sync_id,
      organization_id
    });
  } catch (error) {
    console.error('Google sync error:', error);
    
    // Update sync status to failed if we have a sync record
    if (syncRecord?.id) {
      await updateSyncStatus(
        syncRecord.id, 
        0, 
        'Google sync failed: ' + (error as Error).message,
        'FAILED'
      );
    }
      
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

// Helper function to update sync status
async function updateSyncStatus(
  syncId: string, 
  progress: number, 
  message: string, 
  status: string = 'IN_PROGRESS'
) {
  const { error } = await supabaseAdmin
    .from('sync_status')
    .update({
      status,
      progress,
      message,
      updated_at: new Date().toISOString()
    })
    .eq('id', syncId);

  if (error) {
    console.error('Error updating sync status:', error);
  }
}

// Helper function to create user-application relationship
async function createUserAppRelationship(appId: string, token: any, organizationId: string) {
  // Get user by email
  const { data: userData, error: userError } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', token.userEmail)
    .eq('organization_id', organizationId)
    .single();

  if (userError) {
    console.error('Error finding user:', userError);
    return;
  }

  if (!userData) {
    console.error(`No user found for email: ${token.userEmail}`);
    return;
  }

  // Create user-application relationship
  const { error: relationshipError } = await supabaseAdmin
    .from('user_applications')
    .upsert({
      user_id: userData.id,
      application_id: appId,
      scopes: token.scopes || [],
      updated_at: new Date().toISOString()
    });

  if (relationshipError) {
    console.error('Error upserting user-application relationship:', relationshipError);
  } else {
    console.log(`Successfully linked app ${token.displayText} to user ${token.userEmail}`);
  }
} 