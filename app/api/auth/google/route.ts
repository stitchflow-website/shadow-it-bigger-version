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

export async function GET(request: Request) {
  try {
    console.log('1. Starting Google OAuth callback...');
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');
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
    
    // If we don't have a refresh token, the user probably used prompt=none
    if (!oauthTokens.refresh_token) {
      console.error('No refresh token received - likely due to prompt=none.');
      
      // Check for an existing valid session
      // For a Request object, we need to extract cookies manually
      const cookies = request.headers.get('cookie') || '';
      const sessionIdMatch = cookies.match(/shadow_session_id=([^;]+)/);
      const sessionId = sessionIdMatch ? sessionIdMatch[1] : undefined;
      
      // Check if we have a valid session
      const hasValidSession = await isValidSession(sessionId);
      
      if (hasValidSession) {
        console.log('Found valid session, proceeding without refresh token');
        // Continue with the flow using existing session
      } else {
        console.log('No valid session found, checking for existing user');
        
        // Check if the user already exists in our database
        const { data: existingUser } = await supabaseAdmin
          .from('users_signedup')
          .select('id, email')
          .eq('email', userInfo.email)
          .single();
        
        console.log('Checking if user exists:', existingUser ? 'Yes' : 'No');
        
        if (existingUser) {
          // First try to find organization by domain
          let { data: userOrg } = await supabaseAdmin
            .from('organizations')
            .select('id')
            .eq('domain', userInfo.hd)
            .single();
            
          // If not found by domain, try finding by first_admin
          if (!userOrg) {
            const { data: orgByAdmin } = await supabaseAdmin
              .from('organizations')
              .select('id')
              .eq('first_admin', userInfo.email)
              .single();
              
            userOrg = orgByAdmin;
          }
          
          if (userOrg) {
            console.log('User already exists and has organization, redirecting to dashboard');
            
            // Create HTML response with localStorage setting and redirect
            const htmlResponse = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Redirecting...</title>
                <script>
                  // Store email in localStorage for cross-browser session awareness
                  localStorage.setItem('userEmail', "${userInfo.email}");
                  localStorage.setItem('lastLogin', "${new Date().getTime()}");
                  
                  // Store additional session data in localStorage for cross-browser compatibility
                  localStorage.setItem('userOrgId', "${userOrg.id}");
                  localStorage.setItem('userHd', "${userInfo.hd || ''}");
                  
                  // Check if this is a different browser than the one that initiated auth
                  const stateFromStorage = localStorage.getItem('oauthState');
                  const stateFromUrl = "${state || ''}";
                  if (stateFromStorage && stateFromUrl && stateFromStorage === stateFromUrl) {
                    localStorage.setItem('sameDeviceAuth', 'true');
                  }
                  
                  window.location.href = "https://www.stitchflow.com/tools/shadow-it-scan/";
                </script>
              </head>
              <body>
                <p>Redirecting to dashboard...</p>
              </body>
              </html>
            `;
            
            const dashboardResponse = new NextResponse(htmlResponse, {
              status: 200,
              headers: {
                'Content-Type': 'text/html',
              },
            });
            
            // Set necessary cookies with environment-aware settings
            const cookieOptions = {
              secure: process.env.NODE_ENV === 'production',
              sameSite: process.env.NODE_ENV === 'production' ? ('strict' as const) : ('lax' as const),
              path: '/',
              domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined
            };
            
            dashboardResponse.cookies.set('orgId', userOrg.id, cookieOptions);
            dashboardResponse.cookies.set('userEmail', userInfo.email, cookieOptions);
            
            return dashboardResponse;
          }
        }
        
        // If user doesn't exist or we couldn't find their organization, force consent flow
        return NextResponse.redirect('https://www.stitchflow.com/tools/shadow-it-scan/?error=data_refresh_required');
      }
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
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id')
      .eq('email', userInfo.email)
      .single();
    
    const isNewUser = !existingUser;
    
    // Store basic user info
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users_signedup')
      .upsert({
        id: existingUser?.id, // Include ID if exists
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
    const userId = userData?.id || existingUser?.id;

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

    // If the user needs a fresh sync, we now need to force fresh consent to ensure
    // we have all the required permissions, especially if data was deleted
    if (needsFreshSync) {
      console.log('Returning user with missing or corrupt data detected, forcing fresh consent');
      
      // Return a special error code that will be handled in the frontend
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=data_refresh_required', request.url));
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
        sameSite: process.env.NODE_ENV === 'production' ? ('strict' as const) : ('lax' as const),
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined
      };

      response.cookies.set('orgId', org.id, cookieOptions);
      response.cookies.set('userEmail', userInfo.email, cookieOptions);
      
      // Create a session in user_sessions table
      try {
        // Generate a unique session ID
        const sessionId = crypto.randomUUID();
        
        // Set session expiry (30 days from now)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        
        // Create the session record
        const { data: sessionData, error: sessionError } = await supabaseAdmin
          .from('user_sessions')
          .insert({
            id: sessionId,
            user_id: userId,
            user_email: userInfo.email,
            auth_provider: 'google',
            expires_at: expiresAt.toISOString(),
            refresh_token: oauthTokens.refresh_token,
            access_token: oauthTokens.access_token,
            user_agent: request.headers.get('user-agent') || '',
            ip_address: request.headers.get('x-forwarded-for') || ''
          })
          .select()
          .single();
        
        if (sessionError) {
          console.error('Error creating session:', sessionError);
        } else {
          console.log('Session created successfully:', sessionId);
          
          // Set the session ID cookie
          response.cookies.set('shadow_session_id', sessionId, {
            ...cookieOptions,
            httpOnly: true, // Make sure it's not accessible via JavaScript
            expires: expiresAt // Set the expiry date
          });
        }
      } catch (error) {
        console.error('Error creating session:', error);
      }
      
      return response;
    }

    // Default case: new user or no completed sync yet - create URL for loading page with syncId parameter
    const redirectUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/loading');
    if (syncStatus?.id) {
      redirectUrl.searchParams.set('syncId', syncStatus.id);
    }

    console.log('Setting cookies and redirecting to:', redirectUrl.toString());
    
    // Create the response with redirect
    // Use HTML response to set localStorage before redirecting
    const htmlResponse = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Redirecting...</title>
        <script>
          // Store email in localStorage for cross-browser session awareness
          localStorage.setItem('userEmail', "${userInfo.email}");
          localStorage.setItem('lastLogin', "${new Date().getTime()}");
          
          // Enhanced storage for better cross-browser experience
          localStorage.setItem('userOrgId', "${org.id}");
          localStorage.setItem('userHd', "${userInfo.hd || ''}");
          localStorage.setItem('authProvider', "google");
          
          // Check if this is a different browser than the one that initiated auth
          const stateFromStorage = localStorage.getItem('oauthState');
          const stateFromUrl = "${state || ''}";
          if (stateFromStorage && stateFromUrl && stateFromStorage === stateFromUrl) {
            localStorage.setItem('sameDeviceAuth', 'true');
          }
          
          window.location.href = "${redirectUrl.toString()}";
        </script>
      </head>
      <body>
        <p>Redirecting to dashboard...</p>
      </body>
      </html>
    `;
    
    const response = new NextResponse(htmlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    });

    // Set necessary cookies with environment-aware settings
    const cookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? ('strict' as const) : ('lax' as const),
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined
    };

    response.cookies.set('orgId', org.id, cookieOptions);
    response.cookies.set('userEmail', userInfo.email, cookieOptions);
    
    // Create a session in user_sessions table
    try {
      // Generate a unique session ID
      const sessionId = crypto.randomUUID();
      
      // Set session expiry (30 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      // Create the session record
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from('user_sessions')
        .insert({
          id: sessionId,
          user_id: userId,
          user_email: userInfo.email,
          auth_provider: 'google',
          expires_at: expiresAt.toISOString(),
          refresh_token: oauthTokens.refresh_token,
          access_token: oauthTokens.access_token,
          user_agent: request.headers.get('user-agent') || '',
          ip_address: request.headers.get('x-forwarded-for') || ''
        })
        .select()
        .single();
      
      if (sessionError) {
        console.error('Error creating session:', sessionError);
      } else {
        console.log('Session created successfully:', sessionId);
        
        // Set the session ID cookie
        response.cookies.set('shadow_session_id', sessionId, {
          ...cookieOptions,
          httpOnly: true, // Make sure it's not accessible via JavaScript
          expires: expiresAt // Set the expiry date
        });
      }
    } catch (error) {
      console.error('Error creating session:', error);
    }

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