import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { sendSuccessSignupWebhook, sendFailedSignupWebhook } from '@/lib/webhook';
import { determineRiskLevel } from '@/lib/risk-assessment';
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

async function sendFailedSignupEmail(userEmail: string, reason: string, name?: string) {
  const transactionalId = process.env.LOOPS_TRANSACTIONAL_ID_FAILED_SIGNUP;
  const loopsApiKey = process.env.LOOPS_API_KEY;

  if (!transactionalId) {
    console.error(`[Google Auth] LOOPS_TRANSACTIONAL_ID_FAILED_SIGNUP is not set. Cannot send failed signup email.`);
    return;
  }
  if (!loopsApiKey) {
    console.warn(`[Google Auth] LOOPS_API_KEY is not set. Failed signup email might not send if API key is required.`);
  }
  if (!userEmail) {
    console.error(`[Google Auth] User email is not available. Cannot send failed signup email.`);
    return;
  }

  const dataVariables: { reason: string; name?: string } = { reason };
  if (name) {
    dataVariables.name = name;
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
        dataVariables: dataVariables
      }),
    });

    if (response.ok) {
      const responseData = await response.json();
      console.log(`[Google Auth] Failed signup email sent successfully to ${userEmail} for reason: ${reason}:`, responseData);
    } else {
      const errorData = await response.text();
      console.error(`[Google Auth] Failed to send failed signup email to ${userEmail}. Status: ${response.status}, Response: ${errorData}`);
    }
  } catch (error) {
    console.error(`[Google Auth] Error sending failed signup email to ${userEmail}:`, error);
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

    // Check if current scopes include admin scopes
    const requiredAdminScopes = [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly', 
      'https://www.googleapis.com/auth/admin.directory.user.security'
    ];
    
    const currentScopes = oauthTokens.scope ? oauthTokens.scope.split(' ') : [];
    const hasRequiredAdminScopes = requiredAdminScopes.every(scope => 
      currentScopes.includes(scope)
    );
    
    console.log('Scope check:', { 
      currentScopes, 
      hasRequiredAdminScopes,
      hasRefreshToken: !!oauthTokens.refresh_token 
    });

    // Request admin scopes if:
    // 1. New user (not in DB) OR no admin access AND
    // 2. Don't have required admin scopes OR haven't completed consent flow AND  
    // 3. Don't have a refresh token OR don't have admin scopes
    if ((!existingUser || !hasAdminAccess) && (!hasRequiredAdminScopes || !hasCompletedConsent) && (!oauthTokens.refresh_token || !hasRequiredAdminScopes)) {
      console.log('Requesting admin scopes - New user:', !existingUser, 'Has admin access:', hasAdminAccess, 'Has required scopes:', hasRequiredAdminScopes);
      
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

      // Create a direct URL to Google's auth/consent endpoint, bypassing the account chooser
      // This is the key change - use the specific endpoint for direct consent
      const redirectUri = process.env.NODE_ENV === 'production' 
        ? 'https://stitchflow.com/tools/shadow-it-scan/api/auth/google'
        : `${createRedirectUrl('/api/auth/google')}`;

      // Use the v2/auth endpoint that better respects login_hint instead of oauthchooseaccount
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', process.env.GOOGLE_CLIENT_ID || '');
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', adminScopes);
      authUrl.searchParams.append('access_type', 'offline');
      // Only request consent when we need it for admin scopes
      authUrl.searchParams.append('prompt', 'consent');
      // Pre-select the account with the login_hint
      authUrl.searchParams.append('login_hint', userInfo.email);
      authUrl.searchParams.append('state', state);
      authUrl.searchParams.append('include_granted_scopes', 'true');
      
      // Remove legacy/internal parameters that conflict with the login flow:
      // - authuser
      // - skipAccountSelect
      // - service
      // - o2v
      // - flowName
      
      // Add state to track that we've requested consent
      authUrl.searchParams.append('consent_requested', 'true');

      console.log('Redirecting for admin scopes with URL:', authUrl.toString());

      return NextResponse.redirect(authUrl);
    }

    // Only mark consent as completed if we have both refresh token AND admin scopes
    if (oauthTokens.refresh_token && hasRequiredAdminScopes && !hasCompletedConsent) {
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
        await sendFailedSignupEmail(userInfo.email, 'Google Workspace Admin account required', userInfo.name);
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
        await sendFailedSignupEmail(userInfo.email, 'Google Workspace account required (personal Gmail not supported)', userInfo.name);
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
          scope: oauthTokens.scope,
          token_expiry: oauthTokens.expiry_date ? new Date(oauthTokens.expiry_date).toISOString() : null
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
    
    // First, make sure we store/update the user's profile information to get the user ID
    const { data: userRecord, error: userError } = await supabaseAdmin
      .from('users_signedup')
      .upsert({
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture || null,
        updated_at: new Date().toISOString(),
      }, { 
        onConflict: 'email' 
      })
      .select('id')
      .single();
      
    if (userError) {
      console.error('Error upserting user profile:', userError);
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=user_creation_failed', request.url));
    }
    
    // Create the session record in database with the proper user_id
    const { error: sessionError } = await supabaseAdmin
      .from('user_sessions')
      .insert({
        id: sessionId,
        user_id: userRecord.id,
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
      // For new users, redirect to signed-up page first, then to loading page
      if (!existingUser) {
        // This is a truly new user - redirect to signed-up page
        redirectUrl = new URL('https://stitchflow.com/tools/shadow-it-scan/signed-up');
        if (syncStatus) {
          redirectUrl.searchParams.set('syncId', syncStatus.id);
        }
        redirectUrl.searchParams.set('orgId', org.id);
        redirectUrl.searchParams.set('provider', 'google');
        console.log('Redirecting new user to signed-up page first');
      } else {
        // Existing user but no data, go directly to loading page
        redirectUrl = new URL('https://stitchflow.com/tools/shadow-it-scan/loading');
        if (syncStatus) {
          redirectUrl.searchParams.set('syncId', syncStatus.id);
        }
        redirectUrl.searchParams.set('orgId', org.id);
        console.log('Redirecting existing user without data to loading page');
      }
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

    // Create default notification preferences for the user
    try {
      const prefsUrl = createRedirectUrl('/api/auth/create-default-preferences');
      await fetch(prefsUrl, {
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

    // If this is a new user, send webhook notification
    if (!existingUser) {
      try {
        const webhookResult = await sendSuccessSignupWebhook(userInfo.email, userInfo.name, 'google');
        console.log(`[Google Auth] Success signup webhook result: ${webhookResult ? 'Success' : 'Failed'}`);
      } catch (webhookError) {
        console.error('[Google Auth] Error sending success signup webhook:', webhookError);
      }
    }

    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=unknown', request.url));
  }
} 