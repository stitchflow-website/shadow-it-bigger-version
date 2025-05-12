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
 * Helper function to store or update user session
 */
async function storeUserSession(email: string, googleId: string, refreshToken: string) {
  try {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

    // Create or update session
    const { error } = await supabaseAdmin
      .from('user_sessions')
      .insert({
        id: sessionId,
        user_email: email,
        auth_provider: 'google',
        refresh_token: refreshToken,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error storing user session:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error in storeUserSession:', error);
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
    const hasGrantedConsent = searchParams.get('consent_granted') === 'true';
    const selectedEmail = searchParams.get('login_hint');
    
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

    // Check if user already exists in our system
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id, email')
      .eq('email', userInfo.email)
      .single();

    // Check if we've already processed this user in an auth flow (to prevent loops)
    const { data: flowState } = await supabaseAdmin
      .from('auth_flow_state')
      .select('completed_consent')
      .eq('email', userInfo.email)
      .single();

    const hasCompletedConsent = flowState?.completed_consent === true;
    
    console.log('Auth flow check:', { 
      email: userInfo.email, 
      hasCompletedConsent, 
      hasRefreshToken: !!oauthTokens.refresh_token 
    });

    // For first-time users or users without admin scopes, we need to check admin status
    let hasAdminAccess = false;
    try {
      hasAdminAccess = await googleService.isUserAdmin(userInfo.email);
      console.log('Admin access check:', { 
        hasAdminAccess, 
        hasCompletedConsent, 
        isNewUser: !existingUser 
      });
    } catch (err) {
      console.log('Could not verify admin status with current token');
    }

    // Request admin scopes if:
    // 1. New user (not in DB) OR no admin access AND
    // 2. Haven't completed consent flow AND
    // 3. Don't have a refresh token
    if ((!existingUser || !hasAdminAccess) && !hasCompletedConsent && !oauthTokens.refresh_token) {
      console.log('Requesting admin scopes - New user:', !existingUser, 'Has admin access:', hasAdminAccess);
      
      // First, mark that we've started the consent flow for this user
      await supabaseAdmin
        .from('auth_flow_state')
        .upsert({
          email: userInfo.email,
          started_at: new Date().toISOString(),
          completed_consent: false
        }, { 
          onConflict: 'email' 
        });

      const adminScopes = [
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.security'
      ].join(' ');

      // New approach: no redirects, direct window modification
      const redirectUri = process.env.NODE_ENV === 'production' 
        ? 'https://stitchflow.com/tools/shadow-it-scan/api/auth/google'
        : `${createRedirectUrl('/api/auth/google')}`;
        
      // Set a cookie with the email to prevent account chooser screen
      const emailCookieResponse = new NextResponse('', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        }
      });
      
      // Set a cookie to remember the email (Google uses this)
      emailCookieResponse.cookies.set('ACCOUNT_CHOOSER', userInfo.email, {
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 300 // Just need it for a short time
      });
      
      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Redirecting to consent...</title>
          <script>
            // Store the email in cookies that Google reads
            document.cookie = "g_csrf_token=${state};path=/;max-age=300;SameSite=Lax";
            document.cookie = "g_selected_account=${userInfo.email};path=/;max-age=300;SameSite=Lax";
            
            // Force a new OAuth with directly selected account and consent
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.append('client_id', '${process.env.GOOGLE_CLIENT_ID}');
            authUrl.searchParams.append('redirect_uri', '${redirectUri}');
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('scope', '${adminScopes}');
            authUrl.searchParams.append('access_type', 'offline');
            authUrl.searchParams.append('prompt', 'consent');
            authUrl.searchParams.append('login_hint', '${userInfo.email}');
            authUrl.searchParams.append('state', '${state}');
            authUrl.searchParams.append('include_granted_scopes', 'true');
            
            // Another Google-specific param to skip account chooser
            authUrl.searchParams.append('authuser', '0');
            
            // Store email in session storage to retrieve later
            sessionStorage.setItem('selected_email', '${userInfo.email}');
            localStorage.setItem('g_selected_account', '${userInfo.email}');
            
            console.log("Redirecting to Google OAuth with:", {
              redirectUri: '${redirectUri}',
              email: '${userInfo.email}',
              state: '${state}'
            });
            
            // Add a small delay to ensure cookies are set
            setTimeout(() => {
              window.location.href = authUrl.toString();
            }, 100);
          </script>
        </head>
        <body>
          <p>Please wait, redirecting to Google for required permissions...</p>
        </body>
        </html>
      `;
      
      return new NextResponse(htmlResponse, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': `g_selected_account=${userInfo.email}; path=/; max-age=300; SameSite=Lax`
        }
      });
    }

    // If we got this far with a refresh token, mark the consent as completed
    if (oauthTokens.refresh_token && !hasCompletedConsent) {
      await supabaseAdmin
        .from('auth_flow_state')
        .upsert({
          email: userInfo.email,
          completed_consent: true,
          completed_at: new Date().toISOString()
        }, { 
          onConflict: 'email' 
        });
      
      console.log('Marked consent flow as completed for:', userInfo.email);
    }

    // At this point:
    // 1. User exists and has admin access, OR
    // 2. New user who just granted admin access with refresh token
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
        first_admin: !existingUser ? userInfo.email : undefined,
      }, { onConflict: 'google_org_id' })
      .select('id')
      .single();
      
    if (orgError) {
      console.error('Organization upsert error:', orgError);
      throw orgError;
    }

    // Check if we already have data for this organization 
    const { data: existingData } = await supabaseAdmin
      .from('applications')
      .select('id')
      .eq('organization_id', org.id)
      .limit(1);
      
    const hasExistingData = existingData && existingData.length > 0;
    console.log('Existing data check:', { hasExistingData, orgId: org.id });

    // Only create a sync status for new users or users without existing data
    let syncStatus = null;
    if (!existingUser || !hasExistingData) {
      // Create a status record for tracking the sync progress
      const { data: newSyncStatus, error: syncStatusError } = await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          user_email: userInfo.email,
          status: 'IN_PROGRESS',
          progress: 0,
          message: 'Started Google Workspace data sync',
          access_token: oauthTokens.access_token,
          refresh_token: oauthTokens.refresh_token || null,
        })
        .select()
        .single();

      if (syncStatusError) {
        console.error('Error creating sync status:', syncStatusError);
        return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=sync_failed', request.url));
      }
      
      syncStatus = newSyncStatus;
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
        user_id: existingUser?.id,
        user_email: userInfo.email,
        auth_provider: 'google',
        expires_at: expiresAt.toISOString(),
        refresh_token: oauthTokens.refresh_token || null,
        access_token: oauthTokens.access_token,
        user_agent: request.headers.get('user-agent') || '',
        ip_address: request.headers.get('x-forwarded-for') || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (sessionError) {
      console.error('Error creating session:', sessionError);
    } else {
      console.log('Session created successfully:', sessionId);
    }

    // Determine where to redirect based on user status
    let redirectUrl;
    if (!existingUser || !hasExistingData) {
      // For new users or users without data, redirect to loading page with sync status
      redirectUrl = new URL('https://stitchflow.com/tools/shadow-it-scan/loading');
      if (syncStatus) {
        redirectUrl.searchParams.set('syncId', syncStatus.id);
      }
      redirectUrl.searchParams.set('orgId', org.id);
      console.log('Redirecting new user to loading page');
    } else {
      // For returning users with existing data, go straight to dashboard
      redirectUrl = new URL('https://stitchflow.com/tools/shadow-it-scan/');
      redirectUrl.searchParams.set('orgId', org.id);
      console.log('Redirecting returning user directly to dashboard');
    }
    
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
          ${syncStatus ? `localStorage.setItem('syncId', "${syncStatus.id}");` : ''}
          
          // Store user profile info
          localStorage.setItem('userName', "${userInfo.name}");
          localStorage.setItem('userAvatarUrl', "${userInfo.picture || ''}");
          
          // Redirect to the appropriate page
          window.location.href = "${redirectUrl}";
        </script>
      </head>
      <body>
        <p>Session established! Redirecting...</p>
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
    
    // Only trigger background sync for new users or users without data
    if (syncStatus) {
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
          refresh_token: oauthTokens.refresh_token || null,
          user_email: userInfo.email,
          user_hd: userInfo.hd,
          provider: 'google'
        }),
      })).catch(error => {
        console.error('Error triggering background sync:', error);
      });
    }

    // Now make sure we store the user's profile information in users_signedup table
    const { error: userError } = await supabaseAdmin
      .from('users_signedup')
      .upsert({
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture || null,
        updated_at: new Date().toISOString(),
      }, { 
        onConflict: 'email' 
      });
      
    if (userError) {
      console.error('Error upserting user profile:', userError);
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