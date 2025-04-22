import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

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

    // First check if user exists
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id')
      .eq('email', userData.userPrincipalName)
      .single();

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
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error('Error creating organization:', createError);
        throw createError;
      }
      org = newOrg;
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
      return NextResponse.redirect(new URL('/login?error=sync_failed', request.url));
    }

    // Create URL for loading page with syncId parameter
    const redirectUrl = new URL('/loading', request.url);
    if (syncStatus?.id) {
      redirectUrl.searchParams.set('syncId', syncStatus.id);
    }

    console.log('Setting cookies and redirecting to:', redirectUrl.toString());
    
    // Create the response with redirect
    const response = NextResponse.redirect(redirectUrl);

    // Set necessary cookies - using consistent naming convention
    response.cookies.set('orgId', org.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
    
    response.cookies.set('userEmail', userData.userPrincipalName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    
    // Trigger the Microsoft sync process in the background
    // This will run after we've already redirected the user
    fetch(`${request.nextUrl.origin}/api/background/sync/microsoft`, {
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
    return NextResponse.redirect(new URL('/login?error=unknown', request.url));
  }
} 