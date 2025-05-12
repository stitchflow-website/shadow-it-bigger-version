import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { sendSuccessSignupWebhook, sendFailedSignupWebhook } from '@/lib/webhook';
import crypto from 'crypto';

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

/**
 * Helper function to check if session is valid
 * @param sessionId The session ID from cookie
 * @returns Boolean indicating if session is valid
 */
async function isValidSession(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false;
  
  try {
    // Check if session exists and is not expired
    const { data: session, error } = await supabaseAdmin
      .from('user_sessions')
      .select('*')
      .eq('id', sessionId)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    return !!session && !error;
  } catch (error) {
    console.error('Error validating session:', error);
    return false;
  }
}

/**
 * Helper function to check if user already has stored credentials
 * @param email User's email address
 * @returns Object containing the refresh token if found
 */
async function getUserCredentials(email: string): Promise<{ refresh_token?: string } | null> {
  if (!email) return null;
  
  try {
    const { data, error } = await supabaseAdmin
      .from('user_credentials')
      .select('refresh_token')
      .eq('email', email)
      .single();
    
    if (error || !data) return null;
    return data;
  } catch (error) {
    console.error('Error fetching user credentials:', error);
    return null;
  }
}

/**
 * Helper function to store or update user credentials
 */
async function storeUserCredentials(email: string, googleId: string, refreshToken: string) {
  try {
    // Using upsert to create or update credentials
    const { error } = await supabaseAdmin
      .from('user_credentials')
      .upsert({
        email,
        google_id: googleId,
        refresh_token: refreshToken,
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'email' 
      });
    
    if (error) {
      console.error('Error storing user credentials:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error in storeUserCredentials:', error);
    return false;
  }
}

export async function GET(request: Request) {
  try {
    console.log('1. Starting Google OAuth callback...');
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state') || crypto.randomUUID();
    const isPromptNone = searchParams.get('prompt') === 'none';
    const hasRequestedScopes = searchParams.get('requested_scopes') === 'true';
    
    // Helper function to create redirect URL
    const createRedirectUrl = (path: string) => {
      const baseUrl = request.headers.get('host') || 'localhost:3000';
      const protocol = baseUrl.includes('localhost') ? 'http://' : 'https://';
      return `${protocol}${baseUrl}${path}`;
    };

    if (error) {
      // If error is login_required or interaction_required with prompt=none,
      // redirect to the auth URL with a full consent flow
      if (isPromptNone && (error === 'login_required' || error === 'interaction_required')) {
        console.log('Silent auth failed, redirecting to full auth flow');
        return NextResponse.redirect(new URL('/tools/shadow-it-scan/?trigger_consent=true', request.url));
      }
      
      console.error('OAuth error received:', error);
      return NextResponse.redirect(`https://stitchflow.com/tools/shadow-it-scan/?error=${error}`);
    }

    if (!code) {
      console.error('No authorization code received');
      return NextResponse.redirect(`https://stitchflow.com/tools/shadow-it-scan/?error=no_code`);
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

    // Check if user already exists in our system and get their credentials
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id, email')
      .eq('email', userInfo.email)
      .single();

    const existingCreds = existingUser ? await getUserCredentials(userInfo.email) : null;

    // For first-time users or users without admin scopes, we need to check admin status
    let hasAdminAccess = false;
    try {
      hasAdminAccess = await googleService.isUserAdmin(userInfo.email);
    } catch (err) {
      console.log('Could not verify admin status with current token');
    }

    // If user doesn't have admin access and hasn't been asked for scopes yet
    if (!hasAdminAccess && !hasRequestedScopes) {
      console.log('Need admin scopes - User exists:', !!existingUser, 'Has admin access:', hasAdminAccess);
      const adminScopes = [
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.security'
      ].join(' ');

      const authUrl = googleService.generateAuthUrl({
        access_type: 'offline',
        scope: adminScopes,
        prompt: 'select_account', // Force account selection
        login_hint: userInfo.email,
        state,
        include_granted_scopes: true
      }) + '&requested_scopes=true&prompt=consent'; // Force consent

      return NextResponse.redirect(authUrl);
    }

    // At this point user either:
    // 1. Exists and has admin access already
    // 2. Just got admin access through the redirect above
    let isAdmin = false;
    try {
      isAdmin = await googleService.isUserAdmin(userInfo.email);
    } catch (err) {
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
      } catch (err) {
        console.error('Error recording failed signup:', err);
      }
        
      return NextResponse.redirect(new URL('https://www.stitchflow.com/tools/shadow-it-scan/?error=admin_required', request.url));
    }

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
    
    // Check if user already exists before storing info and sending webhook
    const { data: storedUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id')
      .eq('email', userInfo.email)
      .single();
    
    const isNewUser = !storedUser;
    
    // Store basic user info
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users_signedup')
      .upsert({
        id: storedUser?.id, // Include ID if exists
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture || null,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
        
    if (userError) {
      console.error('Error upserting user:', userError);
    }
    
    // Get the user ID from the query or existing user
    const userId = userData?.id || storedUser?.id;

    // Store the refresh token in user_credentials table if we received one
    if (oauthTokens.refresh_token) {
      await storeUserCredentials(userInfo.email, userInfo.id, oauthTokens.refresh_token);
      console.log('Stored refresh token for future cross-browser sessions');
    } else {
      console.warn('No refresh token received from Google OAuth. User may need to revoke access and try again.');
      // If this is a first-time user and we didn't get a refresh token, we should redirect them to revoke and try again
      if (!existingUser) {
        console.log('First-time user without refresh token - redirecting to revoke access');
        return NextResponse.redirect('https://myaccount.google.com/permissions');
      }
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
        auth_provider: 'google',
        updated_at: new Date().toISOString(),
        first_admin: isNewUser ? userInfo.email : undefined,
      }, { onConflict: 'google_org_id' })
      .select('id')
      .single();
      
    if (orgError) {
      console.error('Organization upsert error:', orgError);
      throw orgError;
    }

    console.log('Organization upserted:', { org_id: org.id });

    // Create a status record for tracking the sync progress
    // Use refresh token from db if we don't have a new one
    let syncRefreshToken = oauthTokens.refresh_token;
    if (!syncRefreshToken) {
      const storedCreds = await getUserCredentials(userInfo.email);
      syncRefreshToken = storedCreds?.refresh_token;
    }

    const { data: syncStatus, error: syncStatusError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: org.id,
        user_email: userInfo.email,
        status: 'IN_PROGRESS',
        progress: 0,
        message: 'Started Google Workspace data sync',
        access_token: oauthTokens.access_token,
        refresh_token: syncRefreshToken,
      })
      .select()
      .single();

    if (syncStatusError) {
      console.error('Error creating sync status:', syncStatusError);
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=sync_failed', request.url));
    }

    // Generate a unique session ID for the user
    const sessionId = crypto.randomUUID();
    
    // Set session expiry (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Create the session record in database
    const { error: sessionError } = await supabaseAdmin
      .from('user_sessions')
      .insert({
        id: sessionId,
        user_id: userId,
        user_email: userInfo.email,
        auth_provider: 'google',
        expires_at: expiresAt.toISOString(),
        refresh_token: syncRefreshToken || null, // Make refresh_token optional
        access_token: oauthTokens.access_token,
        user_agent: request.headers.get('user-agent') || '',
        ip_address: request.headers.get('x-forwarded-for') || '',
        created_at: new Date().toISOString()
      });
    
    if (sessionError) {
      console.error('Error creating session:', sessionError);
    } else {
      console.log('Session created successfully:', sessionId);
    }
    
    // Default case: redirect to dashboard with cross-browser data
    const dashboardUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/');
    
    // Create HTML response with localStorage setting and redirect
    const htmlResponse = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Redirecting...</title>
        <script>
          // Store critical session data in localStorage for cross-browser awareness
          localStorage.setItem('userEmail', "${userInfo.email}");
          localStorage.setItem('lastLogin', "${new Date().getTime()}");
          localStorage.setItem('userOrgId', "${org.id}");
          localStorage.setItem('userHd', "${userInfo.hd}");
          localStorage.setItem('sessionId', "${sessionId}");
          localStorage.setItem('authProvider', "google");
          localStorage.setItem('sessionCreatedAt', "${new Date().toISOString()}");
          localStorage.setItem('googleId', "${userInfo.id}");
          
          // Check if this is the same browser that initiated auth
          const stateFromStorage = localStorage.getItem('oauthState');
          const stateFromUrl = "${state || ''}";
          const loginTime = localStorage.getItem('login_attempt_time');
          const isSameBrowser = !!(stateFromStorage && stateFromUrl && stateFromStorage === stateFromUrl);
          
          localStorage.setItem('isSameBrowser', isSameBrowser ? 'true' : 'false');
          
          // Redirect to the dashboard
          window.location.href = "${dashboardUrl}";
        </script>
      </head>
      <body>
        <p>Session established! Redirecting you to dashboard...</p>
      </body>
      </html>
    `;
    
    // Build the response with cookies
    const response = new NextResponse(htmlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    });
    
    // Set necessary cookies with production-appropriate settings
    const cookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined,
      expires: expiresAt
    };
    
    response.cookies.set('orgId', org.id, cookieOptions);
    response.cookies.set('userEmail', userInfo.email, cookieOptions);
    response.cookies.set('shadow_session_id', sessionId, {
      ...cookieOptions,
      httpOnly: true
    });
    
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
        refresh_token: syncRefreshToken,
        user_email: userInfo.email,
        user_hd: userInfo.hd,
        provider: 'google'
      }),
    })).catch(error => {
      console.error('Error triggering background sync:', error);
    });

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