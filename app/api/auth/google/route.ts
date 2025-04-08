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
    console.log('Domain:', domain);

    // Get the authenticated user's info
    console.log('Getting authenticated user info...');
    const userInfo = await googleService.getAuthenticatedUserInfo();
    console.log('Authenticated user:', userInfo);

    // Check if user already exists
    const { data: existingUser, error: fetchUserError } = await supabaseAdmin
      .from('users_signedup')
      .select()
      .eq('email', userInfo.email)
      .single();

    if (fetchUserError && fetchUserError.code !== 'PGRST116') {
      console.error('Error fetching user:', fetchUserError);
      throw fetchUserError;
    }

    if (existingUser) {
      // Update existing user
      console.log('User already exists, updating last login time');
      const { error: updateError } = await supabaseAdmin
        .from('users_signedup')
        .update({
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          name: userInfo.name, // Update name in case it changed
          avatar_url: userInfo.picture || null, // Update avatar in case it changed
        })
        .eq('email', userInfo.email);

      if (updateError) {
        console.error('Error updating existing user:', updateError);
        throw updateError;
      }
    } else {
      // Create new user
      const { error: createError } = await supabaseAdmin
        .from('users_signedup')
        .insert({
          email: userInfo.email,
          name: userInfo.name,
          avatar_url: userInfo.picture || null,
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (createError) {
        console.error('Error creating new user:', createError);
        throw createError;
      }
    }

    console.log('5. Upserting organization in Supabase...');
    // Create or update organization in Supabase
    // Check if organization already exists
    const { data: existingOrg, error: fetchOrgError } = await supabaseAdmin
      .from('organizations')
      .select()
      .eq('google_org_id', domain.customerId)
      .single();
    
    if (fetchOrgError && fetchOrgError.code !== 'PGRST116') {
      console.error('Error fetching organization:', fetchOrgError);
      throw fetchOrgError;
    }
    
    let org;
    
    if (existingOrg) {
      console.log('Organization already exists, skipping upsert');
      org = existingOrg;
    } else {
      // Create new organization if it doesn't exist
      const { data: newOrg, error: orgError } = await supabaseAdmin
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
      
      org = newOrg;
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
      
      // Check if user already exists for this organization
      const { data: existingUser, error: fetchUserError } = await supabaseAdmin
        .from('users')
        .select()
        .eq('google_user_id', user.id)
        .eq('organization_id', org.id)
        .single();
      
      if (fetchUserError && fetchUserError.code !== 'PGRST116') {
        console.error('Error fetching user:', { error: fetchUserError, user: user.primaryEmail });
        throw fetchUserError;
      }
      
      // If user already exists for this organization, skip creating a new one
      if (existingUser) {
        console.log('User already exists for this organization, using existing user:', { id: existingUser.id });
        userMap.set(user.id, existingUser.id);
        continue;
      }
      
      // Determine department from orgUnitPath if available
      const department = user.orgUnitPath ? 
        user.orgUnitPath.split('/').filter(Boolean).pop() || null : 
        null;
        
      // Determine role based on isAdmin flag
      const role = user.isAdmin ? 'Admin' : 'User';
      
      // Format the last login time if available
      const lastLogin = user.lastLoginTime ? formatDate(user.lastLoginTime) : null;
      
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .upsert({
          google_user_id: user.id,
          email: user.primaryEmail,
          name: user.name.fullName,
          role: role,
          department: department,
          organization_id: org.id,
          last_login: lastLogin,
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

      // First check if the application already exists
      const { data: existingApp, error: fetchAppError } = await supabaseAdmin
        .from('applications')
        .select('id, total_permissions')
        .eq('google_app_id', token.clientId)
        .eq('organization_id', org.id)
        .single();
        
      if (fetchAppError && fetchAppError.code !== 'PGRST116') {
        console.error('Error fetching application:', { 
          error: fetchAppError, 
          clientId: token.clientId 
        });
        throw fetchAppError;
      }
      
      let appData;
      
      if (existingApp) {
        console.log('Application already exists, using existing application:', { id: existingApp.id });
        appData = existingApp;
        
        // Update only last_login and total_permissions if needed
        const { error: updateAppError } = await supabaseAdmin
          .from('applications')
          .update({
            last_login: formatDate(token.lastTimeUsed),
            total_permissions: Math.max(token.scopes?.length || 0, existingApp.total_permissions || 0)
          })
          .eq('id', existingApp.id);
          
        if (updateAppError) {
          console.error('Application update error:', { error: updateAppError, id: existingApp.id });
          throw updateAppError;
        }
      } else {
        // Create new application if it doesn't exist
        const { data: newApp, error: appError } = await supabaseAdmin
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
        
        appData = newApp;
      }

      // Get the Supabase User ID from our mapping
      const userId = userMap.get(token.userKey);
      if (!userId) {
        console.warn('No matching user found for token:', token.userKey);
        continue;
      }

      console.log('Creating or updating user-application relationship...', {
        userId,
        appId: appData.id,
        googleUserId: token.userKey,
        googleAppId: token.clientId
      });

      // Check if relation already exists to prevent duplication
      const { data: existingRelation, error: fetchRelationError } = await supabaseAdmin
        .from('user_applications')
        .select('id, scopes, last_login')
        .eq('user_id', userId)
        .eq('application_id', appData.id)
        .single();
      
      if (fetchRelationError && fetchRelationError.code !== 'PGRST116') {
        console.error('Error fetching user-application relation:', { 
          error: fetchRelationError, 
          userId, 
          appId: appData.id 
        });
      }
      
      // If relation already exists, only update if needed
      if (existingRelation) {
        console.log('User-application relationship already exists:', {
          id: existingRelation.id
        });
        
        // Only update if new data is different
        const shouldUpdate = (
          formatDate(token.lastTimeUsed) !== existingRelation.last_login ||
          JSON.stringify(token.scopes || []) !== JSON.stringify(existingRelation.scopes || [])
        );
        
        if (shouldUpdate) {
          console.log('Updating existing user-application relationship with new data');
          const { error: updateRelationError } = await supabaseAdmin
            .from('user_applications')
            .update({
              scopes: token.scopes || [],
              last_login: formatDate(token.lastTimeUsed),
            })
            .eq('id', existingRelation.id);
            
          if (updateRelationError) {
            console.error('Error updating user-application relation:', {
              error: updateRelationError,
              id: existingRelation.id
            });
            throw updateRelationError;
          }
        }
      } else {
        // Create new relation if it doesn't exist
        const { error: userAppError } = await supabaseAdmin
          .from('user_applications')
          .insert({
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
    }

    console.log('10. Authentication flow completed successfully');
    
    // Create the response with redirect
    const response = NextResponse.redirect(new URL('/', request.url));
    
    // Set secure cookies for session management
    // Set cookies with appropriate security options
    response.cookies.set('orgId', org.id, {
      httpOnly: true, // Makes the cookie inaccessible to JavaScript
      secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in production
      sameSite: 'lax', // Protects against CSRF
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: '/', // Cookie is available for all paths
    });
    
    response.cookies.set('userEmail', userInfo.email, {
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