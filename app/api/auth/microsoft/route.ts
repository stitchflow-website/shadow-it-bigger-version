import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    // Get authorization code from query params
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    
    if (!code) {
      console.error('No authorization code received from Microsoft');
      return NextResponse.redirect(new URL('/login?error=no_code', request.url));
    }

    // Exchange code for tokens
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
    
    if (!clientId || !clientSecret || !redirectUri) {
      console.error('Missing Microsoft OAuth configuration');
      return NextResponse.redirect(new URL('/login?error=config_missing', request.url));
    }

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
      return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
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
      return NextResponse.redirect(new URL('/login?error=user_data_failed', request.url));
    }

    const userData = await userResponse.json();
    console.log('Microsoft user data:', userData);
    
    // Check if it's a work/school account by looking for onPremisesSamAccountName
    const isWorkAccount = userData.userPrincipalName?.includes('#EXT#') === false && 
                          userData.userPrincipalName?.toLowerCase().endsWith('@outlook.com') === false &&
                          userData.userPrincipalName?.toLowerCase().endsWith('@hotmail.com') === false;
    
    if (!isWorkAccount) {
      console.error('Not a work account');
      return NextResponse.redirect(new URL('/login?error=not_work_account', request.url));
    }

    // Store user in DB
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', userData.userPrincipalName)
      .single();

    let userId;

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching user:', fetchError);
    }

    // Create or update user
    const userToUpsert = {
      email: userData.userPrincipalName,
      name: userData.displayName,
      google_user_id: null, // This is Microsoft auth
      microsoft_user_id: userData.id,
      avatar_url: null, // Microsoft Graph API doesn't directly return avatar URL
      organization_id: null, // Will be updated later
      microsoft_access_token: access_token,
      microsoft_refresh_token: refresh_token,
      microsoft_id_token: id_token,
    };

    console.log('Upserting user in database...');
    if (existingUser) {
      userId = existingUser.id;
      const { error: updateError } = await supabase
        .from('users')
        .update(userToUpsert)
        .eq('id', existingUser.id);

      if (updateError) {
        console.error('Error updating user:', updateError);
      }
    } else {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([userToUpsert])
        .select();

      if (insertError) {
        console.error('Error inserting user:', insertError);
      } else if (newUser && newUser.length > 0) {
        userId = newUser[0].id;
      }
    }

    if (!userId) {
      console.error('Failed to get user ID');
      return NextResponse.redirect(new URL('/login?error=user_creation_failed', request.url));
    }

    // Create a sync status record like Google flow does
    const { data: syncStatus, error: syncStatusError } = await supabase
      .from('sync_status')
      .insert({
        organization_id: null, // Will be updated by background sync
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
      // Continue anyway, this is not critical
    }

    // Create URL for loading page with syncId parameter
    const baseUrl = new URL(request.url).origin;
    let redirectUrl = `${baseUrl}/loading`;
    if (syncStatus?.id) {
      redirectUrl += `?syncId=${syncStatus.id}`;
    }

    // Trigger the background sync job
    try {
      const syncUrl = `${baseUrl}/api/background/sync`;
      console.log('Triggering background Microsoft sync with URL:', syncUrl);
      
      const syncPayload = {
        organization_id: null, // Will be determined in the sync process
        sync_id: syncStatus?.id,
        access_token: access_token,
        refresh_token: refresh_token,
        user_email: userData.userPrincipalName,
        provider: 'microsoft'
      };
      
      console.log('Background sync payload:', {
        ...syncPayload,
        access_token: syncPayload.access_token ? 'present' : 'missing',
        refresh_token: syncPayload.refresh_token ? 'present' : 'missing'
      });
      
      const syncResponse = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(syncPayload),
      });
      
      if (!syncResponse.ok) {
        const errorData = await syncResponse.json();
        console.error('Background sync request failed:', {
          status: syncResponse.status,
          statusText: syncResponse.statusText,
          error: errorData
        });
      } else {
        console.log('Background Microsoft sync triggered successfully');
      }
    } catch (error) {
      console.error('Error triggering background sync:', error);
      // Continue anyway - we'll still redirect the user
    }

    console.log('Setting cookies and redirecting to:', redirectUrl);
    // Set cookies and redirect to loading page instead of dashboard
    const response = NextResponse.redirect(redirectUrl);
    
    // Set user info cookie - this will be used for session management
    response.cookies.set('user_info', JSON.stringify({
      id: userId,
      email: userData.userPrincipalName,
      name: userData.displayName,
      provider: 'microsoft'
    }), {
      httpOnly: false, // Allow JavaScript access
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    });
    
    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.redirect(new URL('/login?error=unknown', request.url));
  }
} 