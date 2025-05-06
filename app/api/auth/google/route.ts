import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { sendSuccessSignupWebhook, sendFailedSignupWebhook } from '@/lib/webhook';

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

export async function GET(request: Request) {
  try {
    console.log('1. Starting Google OAuth callback...');
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const referer = request.headers.get('referer') || '';
    
    // Determine if the request is coming from the main website
    const isFromMainSite = referer.includes('localhost') || referer.includes('127.0.0.1');
    
    // Helper function to create redirect URL
    const createRedirectUrl = (path: string) => {
      const baseUrl = request.headers.get('host') || 'localhost:3000';
      const protocol = baseUrl.includes('localhost') ? 'http://' : 'https://';
      return `${protocol}${baseUrl}${path}`;
    };

    if (error) {
      console.error('OAuth error received:', error);
      return NextResponse.redirect(new URL(`/tools/shadow-it-scan/?error=${error}`, request.url));
    }

    if (!code) {
      console.error('No authorization code received');
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=no_code', request.url));
    }

    console.log('2. Initializing Google Workspace service...');
    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });

    console.log('3. Getting tokens from Google...');
    // Get tokens from Google
    const oauthTokens = await googleService.getToken(code);
    console.log('OAuth tokens received:', {
      access_token: oauthTokens.access_token ? 'present' : 'missing',
      refresh_token: oauthTokens.refresh_token ? 'present' : 'missing',
      expiry_date: oauthTokens.expiry_date,
      scope: oauthTokens.scope,
    });
    
    // Set credentials for subsequent API calls
    await googleService.setCredentials(oauthTokens);

    // Get the authenticated user's info
    console.log('Getting authenticated user info...');
    const userInfo = await googleService.getAuthenticatedUserInfo();
    console.log('Authenticated user:', userInfo);

    if (!userInfo.hd) {
      console.error('Not a Google Workspace account - missing domain (hd field)');
      
      // Record failed signup
      try {
        await supabaseAdmin
          .from('users_failed_signups')
          .insert({
            email: userInfo.email,
            name: userInfo.name,
            reason: 'not_workspace_account',
            provider: 'google',
            metadata: JSON.stringify(userInfo),
            created_at: new Date().toISOString(),
          });
        console.log('Recorded failed signup: not_workspace_account');
        
        // Send webhook notification for failed signup
        await sendFailedSignupWebhook(userInfo.email, userInfo.name, 'not_workspace_account');
      } catch (err: unknown) {
        console.error('Error recording failed signup:', err);
      }
        
      return NextResponse.redirect(new URL('https://www.stitchflow.com/tools/shadow-it-scan/?error=not_workspace_account', request.url));
    }
    
    // Check if user is an admin
    let isAdmin = false;
    try {
      isAdmin = await googleService.isUserAdmin(userInfo.email);
    } catch (err: unknown) {
      console.error('Error checking admin status:', err);
    }
    
    if (!isAdmin) {
      console.error('User is not an admin');
      
      // Record failed signup
      try {
        await supabaseAdmin
          .from('users_failed_signups')
          .insert({
            email: userInfo.email,
            name: userInfo.name,
            reason: 'not_admin',
            provider: 'google',
            domain: userInfo.hd,
            metadata: JSON.stringify(userInfo),
            created_at: new Date().toISOString(),
          });
        console.log('Recorded failed signup: not_admin');
        
        // Send webhook notification for failed signup
        await sendFailedSignupWebhook(userInfo.email, userInfo.name, 'not_admin');
      } catch (err: unknown) {
        console.error('Error recording failed signup:', err);
      }
        
      return NextResponse.redirect(new URL('https://www.stitchflow.com/tools/shadow-it-scan/?error=admin_required', request.url));
    }

    // Create organization ID from domain
    const orgId = userInfo.hd.replace(/\./g, '-');

    // Do minimal database operations in the auth callback
    // Just create a new sync status and trigger the background job
    
    // First get or create the organization with minimal fields
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .upsert({
        google_org_id: orgId,
        name: userInfo.hd,
        domain: userInfo.hd,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'google_org_id' })
      .select('id')
      .single();
      
    if (orgError) {
      console.error('Organization upsert error:', orgError);
      throw orgError;
    }

    console.log('Organization upserted:', { org_id: org.id });

    // Create a status record for tracking the sync progress
    const { data: syncStatus, error: syncStatusError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: org.id,
        user_email: userInfo.email,
        status: 'IN_PROGRESS',
        progress: 0,
        message: 'Started Google Workspace data sync',
        access_token: oauthTokens.access_token,
        refresh_token: oauthTokens.refresh_token,
      })
      .select()
      .single();

    if (syncStatusError) {
      console.error('Error creating sync status:', syncStatusError);
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=sync_failed', request.url));
    }

    
    // Check if user already exists before storing info and sending webhook
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id')
      .eq('email', userInfo.email)
      .single();
    
    const isNewUser = !existingUser;

    // Check if this organization already has completed a successful sync
    const { data: existingCompletedSync } = await supabaseAdmin
      .from('sync_status')
      .select('id, created_at')
      .eq('organization_id', org.id)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Check if there's a recent failed sync that might indicate missing data
    const { data: recentFailedSync } = await supabaseAdmin
      .from('sync_status')
      .select('id, message')
      .eq('organization_id', org.id)
      .eq('status', 'FAILED')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Check if there are apps for this organization
    const { count: appCount, error: appCountError } = await supabaseAdmin
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id);

    // Determine if we need a fresh sync even for returning users
    // We need a fresh sync if:
    // 1. There are no apps in the database but the user is returning
    // 2. There was a recent failed sync with a critical error
    const needsFreshSync = !isNewUser && (
      appCount === 0 || 
      (recentFailedSync && recentFailedSync.message && 
       (recentFailedSync.message.includes('Missing required fields') || 
        recentFailedSync.message.includes('failed')))
    );

    // If the user needs a fresh sync, we'll create a new sync status
    if (needsFreshSync) {
      console.log('Returning user with missing or corrupt data detected, starting fresh sync');
      
      // Create a new sync status record
      const { data: newSyncStatus, error: newSyncStatusError } = await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          user_email: userInfo.email,
          status: 'IN_PROGRESS',
          progress: 0,
          message: 'Started fresh Google Workspace data sync after detecting missing data',
          access_token: oauthTokens.access_token,
          refresh_token: oauthTokens.refresh_token,
        })
        .select()
        .single();

      if (newSyncStatusError) {
        console.error('Error creating new sync status:', newSyncStatusError);
        return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=sync_failed', request.url));
      }

      // Create URL for loading page with the new syncId parameter
      const loadingUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/loading');
      
      if (newSyncStatus?.id) {
        loadingUrl.searchParams.set('syncId', newSyncStatus.id);
        loadingUrl.searchParams.set('refresh', 'true'); // Add a flag to indicate this is a refresh sync
      }

      // Create the response with redirect to the loading page
      const response = NextResponse.redirect(loadingUrl);

      // Set necessary cookies with environment-aware settings
      const cookieOptions = {
        secure: process.env.NODE_ENV === 'production',
        sameSite: (process.env.NODE_ENV === 'production' ? 'strict' : 'lax') as 'strict' | 'lax',
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined
      };

      response.cookies.set('orgId', org.id, cookieOptions);
      response.cookies.set('userEmail', userInfo.email, cookieOptions);

      // Trigger the background sync immediately for the fresh sync
      const apiUrl = createRedirectUrl('/api/background/sync');
      Promise.resolve(fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id: org.id,
          sync_id: newSyncStatus.id,
          access_token: oauthTokens.access_token,
          refresh_token: oauthTokens.refresh_token,
          user_email: userInfo.email,
          user_hd: userInfo.hd,
          provider: 'google',
          force_refresh: true
        }),
      })).catch(error => {
        console.error('Error triggering background sync:', error);
      });
      
      return response;
    }

    // If the user and organization already exist with completed sync and no data issues, 
    // redirect directly to the dashboard instead of the loading page
    if (!isNewUser && existingCompletedSync && !needsFreshSync) {
      console.log('Returning user with healthy completed sync detected, skipping loading page');
      const dashboardUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/');
      
      // Create response with redirect directly to dashboard
      const response = NextResponse.redirect(dashboardUrl);

      // Set necessary cookies with environment-aware settings
      const cookieOptions = {
        secure: process.env.NODE_ENV === 'production',
        sameSite: (process.env.NODE_ENV === 'production' ? 'strict' : 'lax') as 'strict' | 'lax',
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined
      };

      response.cookies.set('orgId', org.id, cookieOptions);
      response.cookies.set('userEmail', userInfo.email, cookieOptions);
      
      return response;
    }

    // Default case: new user or no completed sync yet - create URL for loading page with syncId parameter
    const redirectUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/loading');
    if (syncStatus?.id) {
      redirectUrl.searchParams.set('syncId', syncStatus.id);
    }

    console.log('Setting cookies and redirecting to:', redirectUrl.toString());
    
    // Create the response with redirect
    const response = NextResponse.redirect(redirectUrl);

    // Set necessary cookies with environment-aware settings
    const cookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.NODE_ENV === 'production' ? 'strict' : 'lax') as 'strict' | 'lax',
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined
    };

    response.cookies.set('orgId', org.id, cookieOptions);
    response.cookies.set('userEmail', userInfo.email, cookieOptions);

    // Store basic user info in the background
    try {
      await supabaseAdmin
        .from('users_signedup')
        .upsert({
          email: userInfo.email,
          name: userInfo.name,
          avatar_url: userInfo.picture || null,
          updated_at: new Date().toISOString(),
        });
      
      console.log('Basic user info stored');
      
      // Send webhook notification for successful signup (only for new users)
      if (isNewUser) {
        console.log('Sending webhook notification for successful signup');
        try {
          const webhookSuccess = await sendSuccessSignupWebhook(userInfo.email, userInfo.name);
          console.log(`Webhook call result: ${webhookSuccess ? 'Success' : 'Failed'}`);
        } catch (webhookError) {
          console.error('Error in webhook call:', webhookError);
        }
      }
    } catch (error: unknown) {
      console.error('Error storing basic user info:', error);
    }
    
    // Trigger the background sync in a non-blocking way
    const apiUrl = createRedirectUrl('/api/background/sync');
    Promise.resolve(fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: org.id,
        sync_id: syncStatus.id,
        access_token: oauthTokens.access_token,
        refresh_token: oauthTokens.refresh_token,
        user_email: userInfo.email,
        user_hd: userInfo.hd,
        provider: 'google'
      }),
    })).catch(error => {
      console.error('Error triggering background sync:', error);
    });

    // Create default notification preferences for the user
    try {
      await fetch(`https://www.stitchflow.com/tools/shadow-it-scan/api/auth/create-default-preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orgId: org.id,
          userEmail: userInfo.email
        })
      });
      console.log('Created default notification preferences for user');
    } catch (prefsError) {
      console.error('Error creating default notification preferences:', prefsError);
      // Continue despite error - not critical
    }

    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=unknown', request.url));
  }
}

function determineRiskLevel(scopes: string[] | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' {
  // If no scopes provided, default to LOW
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'LOW';
  }

  const highRiskScopes = [
    'https://www.googleapis.com/auth/admin.directory.user',
    'https://www.googleapis.com/auth/admin.directory.group',
    'https://www.googleapis.com/auth/admin.directory.user.security',
  ];

  const mediumRiskScopes = [
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
  ];

  if (scopes.some(scope => highRiskScopes.includes(scope))) {
    return 'HIGH';
  }

  if (scopes.some(scope => mediumRiskScopes.includes(scope))) {
    return 'MEDIUM';
  }

  return 'LOW';
} 