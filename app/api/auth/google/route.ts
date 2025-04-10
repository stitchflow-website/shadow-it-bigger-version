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
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      console.error('OAuth error received:', error);
      return NextResponse.redirect(new URL('/login?error=' + error, request.url));
    }

    if (!code) {
      console.error('No authorization code received');
      return NextResponse.redirect(new URL('/login?error=no_code', request.url));
    }

    console.log('2. Initializing Google Workspace service...');
    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
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

    console.log('4. Getting authenticated user info...');
    // Get the authenticated user's info
    const userInfo = await googleService.getAuthenticatedUserInfo();
    console.log('Authenticated user:', userInfo);

    // Create or update the authenticated user
    const { data: authUser, error: authUserError } = await supabaseAdmin
      .from('users_signedup')
      .upsert({
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture || null,
        last_login: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (authUserError) {
      console.error('Error upserting authenticated user:', authUserError);
      throw authUserError;
    }

    // Extract organization domain from user's email
    const userDomain = userInfo.email!.split('@')[1];

    // Create or get organization based on user's email domain
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .upsert({
        google_org_id: userDomain, // Use domain as org ID since we don't have customerId
        name: userDomain,
        domain: userDomain,
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
    
    // Create the response with redirect
    const response = NextResponse.redirect(new URL('/loading?syncId=' + syncStatus.id, request.url));
    
    // Set secure cookies for session management
    response.cookies.set('orgId', org.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });
    
    response.cookies.set('userEmail', userInfo.email!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error: any) {
    console.error('Auth callback error:', {
      name: error.name,
      message: error.message,
      details: error.details || 'No additional details',
      stack: error.stack
    });
    
    // Clear cookies on error
    const response = NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
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