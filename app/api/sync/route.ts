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

    // Get updated organization details
    const orgDetails = await googleService.getOrganizationDetails();
    
    // Update organization in Supabase
    const { error: orgError } = await supabase
      .from('organizations')
      .update({
        name: orgDetails.name,
        domain: orgDetails.domain,
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
  const applications = new Map();

  for (const token of tokens) {
    const appId = token.clientId;
    if (!applications.has(appId)) {
      applications.set(appId, {
        organization_id: orgId,
        google_app_id: appId,
        name: token.displayText || 'Unknown App',
        category: 'Unknown', // You'll need to implement category detection
        risk_level: 'Low', // You'll need to implement risk assessment
        management_status: 'Needs Review',
        total_permissions: token.scopes?.length || 0,
        last_login: token.lastTimeUsed,
        updated_at: new Date().toISOString(),
      });
    }

    // Update user-application relationship
    await supabase.from('user_applications').upsert({
      user_id: token.userKey,
      application_id: appId,
      scopes: token.scopes || [],
      last_login: token.lastTimeUsed,
      updated_at: new Date().toISOString(),
    });
  }

  // Update applications
  const { error: appsError } = await supabase
    .from('applications')
    .upsert(Array.from(applications.values()));

  if (appsError) throw appsError;
} 