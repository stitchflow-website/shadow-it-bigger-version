import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';

// Helper function to safely format date
function formatDate(dateValue: any): string {
  if (!dateValue) return new Date().toISOString();
  
  try {
    // If it's a timestamp in milliseconds
    if (typeof dateValue === 'number') {
      return new Date(dateValue).toISOString();
    }
    
    // If it's a string, try parsing it
    if (typeof dateValue === 'string') {
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
      expiry_date: oauthTokens.expiry_date
    });
    
    await googleService.setCredentials(oauthTokens);

    console.log('4. Fetching organization details...');
    // Get organization details
    const orgDetails = await googleService.getOrganizationDetails();
    console.log('Organization details:', {
      domains: orgDetails.domains?.length,
      firstDomain: orgDetails.domains?.[0]
    });
    
    const domain = orgDetails.domains[0];

    console.log('5. Upserting organization in Supabase...');
    // Create or update organization in Supabase
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .upsert({
        google_org_id: domain.customerId,
        name: domain.domainName,
        domain: domain.domainName,
      })
      .select()
      .single();

    if (orgError) {
      console.error('Organization upsert error:', orgError);
      throw orgError;
    }
    console.log('Organization upserted:', { org_id: org.id });

    console.log('6. Fetching users list...');
    // Get users list
    const users = await googleService.getUsersList();
    console.log('Users:', users);
    console.log('Users fetched:', { count: users?.length });

    console.log('7. Upserting users in Supabase...');
    // Create or update users in Supabase
    const userMap = new Map();
    for (const user of users) {
      console.log('Processing user:', { email: user.primaryEmail });
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .upsert({
          google_user_id: user.id,
          email: user.primaryEmail,
          name: user.name.fullName,
          organization_id: org.id,
        })
        .select()
        .single();

      if (userError) {
        console.error('User upsert error:', { error: userError, user: user.primaryEmail });
        throw userError;
      }

      // Store the mapping between Google User ID and Supabase User ID
      userMap.set(user.id, userData.id);
    }

    console.log('8. Fetching OAuth tokens for applications...');
    // Get OAuth tokens for all users
    const applicationTokens = await googleService.getOAuthTokens();
    console.log('Application tokens:', applicationTokens);
    console.log('Application tokens fetched:', { count: applicationTokens?.length });

    console.log('9. Processing applications and user-application relationships...');
    // Process applications and user-application relationships
    for (const token of applicationTokens) {
      console.log('Processing application:', { 
        clientId: token.clientId,
        displayText: token.displayText,
        userKey: token.userKey,
        lastTimeUsed: token.lastTimeUsed
      });

      // Create or update application
      const { data: appData, error: appError } = await supabaseAdmin
        .from('applications')
        .upsert({
          google_app_id: token.clientId,
          name: token.displayText || token.clientId,
          category: 'Unknown',
          risk_level: determineRiskLevel(token.scopes),
          management_status: 'PENDING',
          total_permissions: token.scopes?.length || 0,
          last_login: formatDate(token.lastTimeUsed),
          organization_id: org.id,
        })
        .select()
        .single();

      if (appError) {
        console.error('Application upsert error:', { error: appError, clientId: token.clientId });
        throw appError;
      }

      // Get the Supabase User ID from our mapping
      const userId = userMap.get(token.userKey);
      if (!userId) {
        console.warn('No matching user found for token:', token.userKey);
        continue;
      }

      console.log('Creating user-application relationship...', {
        userId,
        appId: appData.id,
        googleUserId: token.userKey,
        googleAppId: token.clientId
      });

      // Create user-application relationship using the correct UUIDs
      const { error: userAppError } = await supabaseAdmin
        .from('user_applications')
        .upsert({
          user_id: userId,
          application_id: appData.id,
          scopes: token.scopes || [],
          last_login: formatDate(token.lastTimeUsed),
        });

      if (userAppError) {
        console.error('User-application relationship error:', {
          error: userAppError,
          userId,
          appId: appData.id
        });
        throw userAppError;
      }
    }

    console.log('10. Authentication flow completed successfully');
    // Redirect to dashboard on success with organization ID
    return NextResponse.redirect(new URL(`/?orgId=${org.id}`, request.url));
  } catch (error: any) {
    console.error('Auth callback error:', {
      name: error.name,
      message: error.message,
      details: error.details || 'No additional details',
      stack: error.stack
    });
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}

function determineRiskLevel(scopes: string[]): 'HIGH' | 'MEDIUM' | 'LOW' {
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