import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';

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
      if (isFromMainSite) {
        // Extract the port from referer if it exists
        const refererUrl = new URL(referer);
        return `${refererUrl.protocol}//${refererUrl.host}/tools/shadow-it-scan${path}`;
      }
      return new URL(path, origin).toString();
    };

    if (error) {
      console.error('OAuth error received:', error);
      return NextResponse.redirect(createRedirectUrl('/login?error=' + error));
    }

    if (!code) {
      console.error('No authorization code received');
      return NextResponse.redirect(createRedirectUrl('/login?error=no_code'));
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
    
    console.log('OAuth scopes granted:', oauthTokens.scope);
    
    await googleService.setCredentials(oauthTokens);

    // Get the authenticated user's info
    console.log('Getting authenticated user info...');
    const userInfo = await googleService.getAuthenticatedUserInfo();
    console.log('Authenticated user:', userInfo);

    if (!userInfo.hd) {
      console.error('Not a Google Workspace account - missing domain (hd field)');
      return NextResponse.redirect(new URL('/login?error=not_workspace_account', request.url));
    }

    // Create or update the authenticated user
    const { data: authUser, error: authUserError } = await supabaseAdmin
      .from('users_signedup')
      .upsert({
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (authUserError) {
      console.error('Error upserting authenticated user:', authUserError);
      throw authUserError;
    }

    // Create organization ID from domain
    const orgId = userInfo.hd.replace(/\./g, '-');

    // Create or get organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .upsert({
        google_org_id: orgId,
        name: userInfo.hd,
        domain: userInfo.hd,
        updated_at: new Date().toISOString(),
      })
      .select()
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
      throw syncStatusError;
    }

    // Trigger the background data processing job
    const apiUrl = new URL('/api/background/sync', request.url).toString();
    fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: org.id,
        sync_id: syncStatus.id,
        access_token: oauthTokens.access_token,
        refresh_token: oauthTokens.refresh_token,
      }),
    }).catch(error => {
      console.error('Error triggering background sync:', error);
    });

    console.log('Background sync job triggered');
    
    // Modify the final redirect to use the helper function
    const response = NextResponse.redirect(createRedirectUrl('/loading?syncId=' + syncStatus.id));
    
    // Set secure cookies for session management
    const cookieDomain = isFromMainSite ? new URL(referer).hostname : undefined;
    
    response.cookies.set('orgId', org.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
      domain: cookieDomain
    });
    
    response.cookies.set('userEmail', userInfo.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
      domain: cookieDomain
    });

    return response;
  } catch (error: any) {
    console.error('Auth callback error:', {
      name: error.name,
      message: error.message,
      details: error.details || 'No additional details',
      stack: error.stack
    });
    
    const referer = request.headers.get('referer') || '';
    const isFromMainSite = referer.includes('localhost') || referer.includes('127.0.0.1');
    
    // Create redirect URL based on the source
    const redirectUrl = isFromMainSite
      ? new URL(referer).origin + '/tools/shadow-it-scan/login?error=auth_failed'
      : new URL('/login?error=auth_failed', request.url);
    
    // Clear cookies on error
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete('orgId');
    response.cookies.delete('userEmail');
    return response;
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