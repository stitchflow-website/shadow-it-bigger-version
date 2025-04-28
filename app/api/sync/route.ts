import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { organization_id, access_token } = await request.json();

    if (!organization_id || !access_token) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ access_token });

    // Get user info to obtain domain information
    const userInfo = await googleService.getAuthenticatedUserInfo();
    
    // Update organization in Supabase
    const { error: orgError } = await supabase
      .from('organizations')
      .update({
        name: userInfo.hd || 'Unknown Organization',
        domain: userInfo.hd || 'unknown.com',
        updated_at: new Date().toISOString(),
      })
      .eq('id', organization_id);

    if (orgError) throw orgError;

    // Get updated users list
    const users = await googleService.getUsersList();
    
    // Update users in Supabase
    const { error: usersError } = await supabase
      .from('users')
      .upsert(
        users.map((user: any) => ({
          organization_id,
          google_user_id: user.id,
          email: user.primaryEmail,
          name: user.name.fullName,
          role: user.organizations?.[0]?.title,
          department: user.organizations?.[0]?.department,
          last_login: user.lastLoginTime,
          updated_at: new Date().toISOString(),
        }))
      );

    if (usersError) throw usersError;

    // Get updated OAuth tokens
    const tokens = await googleService.getOAuthTokens();
    
    console.log('Retrieved OAuth tokens:', JSON.stringify(tokens.map((token: any) => ({
      displayText: token.displayText,
      userKey: token.userKey,
      scopesCount: token.scopes?.length || 0,
      scopes: token.scopes
    })), null, 2));
    
    // Process and update application data
    await processApplications(tokens, organization_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: 'Failed to sync data' },
      { status: 500 }
    );
  }
}

async function processApplications(tokens: any[], orgId: string) {
  // Group applications by display name
  const appNameMap = new Map<string, any[]>();
  
  // First pass: Group tokens by application name
  for (const token of tokens) {
    const appName = token.displayText || 'Unknown App';
    
    if (!appNameMap.has(appName)) {
      appNameMap.set(appName, []);
    }
    
    appNameMap.get(appName)!.push(token);
  }
  
  console.log('Applications after grouping:', Array.from(appNameMap.keys()));
  
  // Process each application group
  for (const [appName, appTokens] of appNameMap.entries()) {
    console.log(`Processing application: ${appName} with ${appTokens.length} tokens`);

    // Find existing app by name
    const { data: existingApp } = await supabase
      .from('applications')
      .select('id, total_permissions, risk_level, management_status')
      .eq('name', appName)
      .eq('organization_id', orgId)
      .single();
    
    // Calculate total unique permissions across all instances
    const allScopes = new Set<string>();
    appTokens.forEach((token: any) => {
      if (token.scopes && Array.isArray(token.scopes)) {
        console.log(`Token for ${appName}, user ${token.userKey} has ${token.scopes.length} scopes`);
        token.scopes.forEach((scope: string) => allScopes.add(scope));
      } else {
        console.log(`Token for ${appName}, user ${token.userKey} has NO scopes or invalid format`);
      }
    });
    
    console.log(`Total unique scopes for ${appName}: ${allScopes.size}`);
    console.log(`Scopes: ${Array.from(allScopes).join(', ')}`);
    
    // Find the most recent last used time
    const lastUsedTime = appTokens.reduce((latest: Date, token: any) => {
      const tokenTime = token.lastTimeUsed ? new Date(token.lastTimeUsed) : new Date(0);
      return tokenTime > latest ? tokenTime : latest;
    }, new Date(0));
    
    // Determine risk level
    const riskLevel = determineRiskLevel(Array.from(allScopes));
    
    // Create or update the application record
    const { data: appData, error: appError } = await supabase
      .from('applications')
      .upsert({
        id: existingApp?.id, // Only included if we found an existing app
        organization_id: orgId,
        google_app_id: appTokens[0].clientId, // Use the first token's client ID as reference
        name: appName,
        category: 'Unknown', // Implement category detection if desired
        risk_level: riskLevel,
        management_status: existingApp?.management_status || 'Needs Review',
        total_permissions: allScopes.size,
        last_login: lastUsedTime.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (appError) throw appError;
    
    // Update user-application relationships
    for (const token of appTokens) {
      // Get user by Google user ID
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('google_user_id', token.userKey)
        .eq('organization_id', orgId)
        .single();
      
      if (!userData) {
        console.warn(`No user found for Google user ID: ${token.userKey}`);
        continue;
      }
      
      // Update user-application relationship
      const upsertResult = await supabase.from('user_applications').upsert({
        user_id: userData.id,
        application_id: appData.id,
        scopes: token.scopes || [],
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,application_id',
        ignoreDuplicates: true
      });
      
      if (upsertResult.error) {
        console.error(`Error upserting user-application relationship for ${token.userKey}:`, upsertResult.error);
      } else {
        console.log(`Successfully updated user-application for ${token.userKey} with ${token.scopes?.length || 0} scopes`);
      }
    }
  }
}

// Helper function to determine risk level based on scopes
function determineRiskLevel(scopes: string[]): string {
  if (!scopes || scopes.length === 0) return 'Low';
  
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
    return 'High';
  }

  if (scopes.some(scope => mediumRiskScopes.includes(scope))) {
    return 'Medium';
  }

  return 'Low';
} 