/**
 * Microsoft Auth Configuration
 * 
 * IMPORTANT: In Azure portal, ensure ALL your redirect URIs use your production domain:
 * - https://stitchflow.com/tools/shadow-it-scan/api/auth/microsoft (CORRECT)
 * - https://www.stitchflow.com/tools/shadow-it-scan/api/auth/microsoft (CORRECT)
 * 
 * Remove any localhost redirect URIs from production:
 * - http://localhost:3000/api/auth/microsoft (REMOVE FROM PRODUCTION APP)
 * 
 * For local development, create a separate app registration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendSuccessSignupWebhook, sendFailedSignupWebhook } from '@/lib/webhook';

export async function GET(request: NextRequest) {
  try {
    // Get authorization code from query params
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    
    if (!code) {
      console.error('No authorization code received from Microsoft');
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=no_code', request.url));
    }

    // Exchange code for tokens
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    let redirectUri = process.env.MICROSOFT_REDIRECT_URI;
    
    if (!clientId || !clientSecret || !redirectUri) {
      console.error('Missing Microsoft OAuth configuration');
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=config_missing', request.url));
    }

    // Ensure redirect URI matches what was used in the authorization request
    if (process.env.NODE_ENV === 'development') {
      // For development, use the same format as in login page
      redirectUri = `${request.nextUrl.origin}/api/auth/microsoft`;
    } else {
      // For production, use the full production URL
      redirectUri = 'https://www.stitchflow.com/tools/shadow-it-scan/api/auth/microsoft';
    }
    
    console.log('Using redirect URI for token exchange:', redirectUri);

    console.log('Exchanging code for tokens...');
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=auth_failed', request.url));
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, id_token } = tokenData;
    console.log('Tokens received successfully');
    
    // Get user info using the access token
    console.log('Fetching user data...');
    const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    });

    if (!userResponse.ok) {
      console.error('Failed to fetch user data');
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=user_data_failed', request.url));
    }

    const userData = await userResponse.json();
    console.log('Microsoft user data:', userData);
    
    // If we don't have a refresh token, the user probably used prompt=none
    // We need a refresh token for background syncs to work, so redirect to auth with prompt=consent
    if (!refresh_token) {
      console.error('No refresh token received - likely due to prompt=none. Forcing consent flow.');
      
      // Check if the user already exists in our database
      const { data: existingUser } = await supabaseAdmin
        .from('users_signedup')
        .select('id, email')
        .eq('email', userData.userPrincipalName)
        .single();
      
      console.log('Checking if user exists:', existingUser ? 'Yes' : 'No');
      
      if (existingUser) {
        // First try to find organization by domain
        const emailDomain = userData.userPrincipalName.split('@')[1];
        let { data: userOrg } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .eq('domain', emailDomain)
          .single();
          
        // If not found by domain, try finding by first_admin
        if (!userOrg) {
          const { data: orgByAdmin } = await supabaseAdmin
            .from('organizations')
            .select('id')
            .eq('first_admin', userData.userPrincipalName)
            .single();
            
          userOrg = orgByAdmin;
        }
        
        if (userOrg) {
          console.log('User already exists and has organization, redirecting to dashboard');
          
          // Create response with redirect directly to dashboard
          const response = NextResponse.redirect('https://www.stitchflow.com/tools/shadow-it-scan/');
          
          // We'll set session cookies through the session/create API instead
          return response;
        }
      }
      
      // If user doesn't exist or we couldn't find their organization, force consent flow
      return NextResponse.redirect('https://www.stitchflow.com/tools/shadow-it-scan/?error=data_refresh_required');
    }

    // Check if it's a work/school account by looking for onPremisesSamAccountName
    const isWorkAccount = userData.userPrincipalName?.includes('#EXT#') === false && 
                          userData.userPrincipalName?.toLowerCase().endsWith('@outlook.com') === false &&
                          userData.userPrincipalName?.toLowerCase().endsWith('@hotmail.com') === false;
    
    if (!isWorkAccount) {
      console.error('Not a work account');
      
      // Record failed signup
      try {
        await supabaseAdmin
          .from('users_failed_signups')
          .insert({
            email: userData.userPrincipalName,
            name: userData.displayName,
            reason: 'not_work_account',
            provider: 'microsoft',
            metadata: JSON.stringify(userData),
            created_at: new Date().toISOString(),
          });
        console.log('Recorded failed signup: not_work_account');
        
        // Send webhook notification for failed signup
        try {
          const webhookResult = await sendFailedSignupWebhook(userData.userPrincipalName, userData.displayName, 'not_work_account');
          console.log(`Failed signup webhook result: ${webhookResult ? 'Success' : 'Failed'}`);
        } catch (webhookError) {
          console.error('Error sending failed signup webhook:', webhookError);
        }
      } catch (err: unknown) {
        console.error('Error recording failed signup:', err);
      }
      
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=not_work_account', request.url));
    }
    
    // Check if user is an admin by checking directory roles
    let isAdmin = false;
    
    try {
      // Check for admin roles
      const rolesResponse = await fetch('https://graph.microsoft.com/v1.0/me/memberOf', {
        headers: {
          'Authorization': `Bearer ${access_token}`,
        },
      });
      
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json();
        
        // Check if user is in any admin roles (Global Admin, Directory Admin, etc.)
        isAdmin = rolesData.value.some((role: any) => 
          (role.displayName && role.displayName.toLowerCase().includes('admin')) ||
          (role.roleTemplateId && 
            ['62e90394-69f5-4237-9190-012177145e10', // Global Administrator
             'f28a1f50-f6e7-4571-818b-6a12f2af6b6c', // Company Administrator
             '9f06204d-73c1-4d4c-880a-6edb90606fd8', // Azure AD Admin
             '29232cdf-9323-42fd-ade2-1d097af3e4de'  // Directory Reader
            ].includes(role.roleTemplateId)
          )
        );
      }
      
      // If no admin roles found, try a secondary check - attempt to list users
      // Only admins can list other users
      if (!isAdmin) {
        const listUsersResponse = await fetch('https://graph.microsoft.com/v1.0/users?$top=1', {
          headers: {
            'Authorization': `Bearer ${access_token}`,
          },
        });
        
        // If we can successfully list users, the user is an admin
        isAdmin = listUsersResponse.ok;
      }
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
            email: userData.userPrincipalName,
            name: userData.displayName,
            reason: 'not_admin',
            provider: 'microsoft',
            domain: userData.userPrincipalName.split('@')[1],
            metadata: JSON.stringify(userData),
            created_at: new Date().toISOString(),
          });
        console.log('Recorded failed signup: not_admin');
        
        // Send webhook notification for failed signup
        try {
          const webhookResult = await sendFailedSignupWebhook(userData.userPrincipalName, userData.displayName, 'not_admin');
          console.log(`Failed signup webhook result (not_admin): ${webhookResult ? 'Success' : 'Failed'}`);
        } catch (webhookError) {
          console.error('Error sending failed signup webhook (not_admin):', webhookError);
        }
      } catch (err: unknown) {
        console.error('Error recording failed signup:', err);
      }
      
      return NextResponse.redirect(new URL('https://www.stitchflow.com/tools/shadow-it-scan/?error=admin_required', request.url));
    }

    // First check if user exists
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id')
      .eq('email', userData.userPrincipalName)
      .single();
      
    // Flag to track if this is a new user
    const isNewUser = !existingUser;

    // Create or update user in users_signedup
    const userToUpsert = {
      id: existingUser?.id, // Include ID if user exists
      email: userData.userPrincipalName,
      name: userData.displayName,
      avatar_url: userData.photo || null,
      updated_at: new Date().toISOString()
    };

    const { data: user, error: userError } = await supabaseAdmin
      .from('users_signedup')
      .upsert(userToUpsert)
      .select()
      .single();

    if (userError) {
      console.error('Error creating user record:', userError);
      throw userError;
    }

    // If this is a new user, send webhook notification
    if (isNewUser) {
      try {
        const webhookResult = await sendSuccessSignupWebhook(userData.userPrincipalName, userData.displayName, 'microsoft');
        console.log(`Success signup webhook result: ${webhookResult ? 'Success' : 'Failed'}`);
      } catch (webhookError) {
        console.error('Error sending success signup webhook:', webhookError);
      }
    }

    // Create organization based on email domain
    const emailDomain = userData.userPrincipalName.split('@')[1];
    
    // First check if organization exists
    const { data: existingOrg } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('domain', emailDomain)
      .single();

    let org;
    if (existingOrg) {
      // Update existing organization
      const { data: updatedOrg, error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('id', existingOrg.id)
        .select('id')
        .single();
      
      if (updateError) {
        console.error('Error updating organization:', updateError);
        throw updateError;
      }
      org = updatedOrg;
    } else {
      // Create new organization
      const { data: newOrg, error: createError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: emailDomain,
          domain: emailDomain,
          updated_at: new Date().toISOString(),
          first_admin: userData.userPrincipalName // Set first admin for new organizations
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error('Error creating organization:', createError);
        throw createError;
      }
      org = newOrg;
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

    // Create a sync status record
    const { data: syncStatus, error: syncStatusError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: org.id,
        user_email: userData.userPrincipalName,
        status: 'IN_PROGRESS',
        progress: 0,
        message: 'Started Microsoft Entra ID data sync',
        access_token: access_token,
        refresh_token: refresh_token,
      })
      .select()
      .single();

    if (syncStatusError) {
      console.error('Error creating sync status:', syncStatusError);
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=sync_failed', request.url));
    }

    // Calculate token expiry time (typically 1 hour for Microsoft tokens)
    const expiresAt = new Date();
    if (tokenData.expires_in) {
      // expires_in is usually in seconds
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);
    } else {
      // Default expiry is 1 hour from now
      expiresAt.setHours(expiresAt.getHours() + 1);
    }

    // Create a session in the user_sessions table
    try {
      const sessionResponse = await fetch(`${request.nextUrl.origin}/api/auth/session/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          userEmail: userData.userPrincipalName,
          authProvider: 'microsoft',
          accessToken: access_token,
          refreshToken: refresh_token,
          idToken: id_token,
          expiresAt: expiresAt.toISOString(),
          userAgent: request.headers.get('user-agent'),
          ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] || 
                   request.headers.get('x-real-ip')
        }),
      });

      if (!sessionResponse.ok) {
        console.error('Failed to create session:', await sessionResponse.text());
        throw new Error('Session creation failed');
      }

      console.log('Session created successfully');
    } catch (sessionError) {
      console.error('Error creating session:', sessionError);
      // Continue despite session error - we'll try to continue without it
    }

    // If the user and organization already exist with completed sync and no data issues, 
    // redirect directly to the dashboard instead of the loading page
    if (!isNewUser && existingCompletedSync && !needsFreshSync) {
      console.log('Returning user with healthy completed sync detected, skipping loading page');
      const dashboardUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/');
      
      // Create response with redirect directly to dashboard
      return NextResponse.redirect(dashboardUrl);
    }

    // Create URL for loading page with syncId parameter
    const redirectUrl = new URL('https://www.stitchflow.com/tools/shadow-it-scan/loading');
    if (syncStatus?.id) {
      redirectUrl.searchParams.set('syncId', syncStatus.id);
    }

    console.log('Redirecting to:', redirectUrl.toString());
    
    // Create the response with redirect
    const response = NextResponse.redirect(redirectUrl);

    // We no longer need to set cookies here as they're set by the session/create endpoint

    // Create default notification preferences for the user
    try {
      await fetch(`https://www.stitchflow.com/tools/shadow-it-scan/api/auth/create-default-preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orgId: org.id,
          userEmail: userData.userPrincipalName
        })
      });
      console.log('Created default notification preferences for user');
    } catch (prefsError) {
      console.error('Error creating default notification preferences:', prefsError);
      // Continue despite error - not critical
    }
    
    // Trigger the Microsoft sync process in the background
    fetch(`https://www.stitchflow.com/tools/shadow-it-scan/api/background/sync/microsoft`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch(error => {
      console.error('Error triggering Microsoft sync:', error);
    });
    
    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.redirect(new URL('/tools/shadow-it-scan/?error=unknown', request.url));
  }
}