import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel, determineRiskReason, transformRiskLevel, determineAppRiskReason } from '@/lib/risk-assessment';

// Define types for the database responses
type UserType = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  last_login: string | null;
}

type UserApplicationType = {
  user: UserType;
  scopes: string[];
  last_login: string;
}

type ApplicationType = {
  id: string;
  name: string;
  category: string;
  risk_level: string;
  management_status: string;
  total_permissions: number;
  last_login: string;
  user_applications: UserApplicationType[];
  all_scopes?: string[];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Get applications with user data in a single query
    const { data: applications, error } = await supabaseAdmin
      .from('applications')
      .select(`
        *,
        user_applications:user_applications (
          scopes,
          last_login,
          user:users!inner (
            id,
            name,
            email,
            role,
            department,
            last_login
          )
        )
      `)
      .eq('organization_id', orgId)
      .order('last_login', { ascending: false });

    if (error) {
      throw error;
    }

    if (!applications) {
      return NextResponse.json({ error: 'No applications found' }, { status: 404 });
    }

    // Transform the data to match the frontend structure
    const transformedApplications = (applications as ApplicationType[]).map(app => {
      // Get unique users from user_applications
      const uniqueUsers = Array.from(new Set(
        app.user_applications
          .map(ua => ua.user)
          .filter((user): user is UserType => Boolean(user))
      ));

      // Get the most recent login date from all user_applications
      const lastLogin = app.user_applications
        .reduce((latest, ua) => {
          const loginDate = new Date(ua.last_login);
          return latest > loginDate ? latest : loginDate;
        }, new Date(0))
        .toISOString();

      // Get all unique scopes from user_applications
      const allUserScopes = Array.from(new Set(app.user_applications?.flatMap(ua => ua.scopes || []) || []));
      
      // Use the all_scopes field from the application if available, otherwise fallback to user scopes
      const applicationScopes = app.all_scopes || allUserScopes;

      return {
        id: app.id,
        name: app.name,
        category: app.category || 'Others',
        userCount: uniqueUsers.length,
        users: uniqueUsers.map(user => {
          // Find this specific user's application
          const userApp = app.user_applications.find((ua: UserApplicationType) => 
            ua.user.id === user.id
          );
          
          // Get this user's specific scopes (not the application-wide scopes)
          const userScopes = userApp?.scopes || [];
          
          return {
            id: user.id,
            appId: app.id,
            name: user.name,
            email: user.email,
            lastActive: userApp?.last_login || user.last_login,
            scopes: userScopes,
            riskLevel: determineRiskLevel(userScopes),
            riskReason: determineRiskReason(userScopes)
          };
        }),
        riskLevel: transformRiskLevel(app.risk_level),
        riskReason: determineAppRiskReason(app.risk_level, app.total_permissions),
        totalPermissions: app.total_permissions,
        scopeVariance: calculateScopeVariance(app.user_applications),
        lastLogin: lastLogin,
        managementStatus: transformManagementStatus(app.management_status),
        ownerEmail: '',
        notes: '',
        scopes: applicationScopes,
        isInstalled: app.management_status === 'MANAGED',
        isAuthAnonymously: false
      };
    });

    return NextResponse.json(transformedApplications);
  } catch (error) {
    console.error('Error in applications API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function transformManagementStatus(status: string): 'Managed' | 'Unmanaged' | 'Needs Review' {
  const map: Record<string, 'Managed' | 'Unmanaged' | 'Needs Review'> = {
    'MANAGED': 'Managed',
    'UNMANAGED': 'Unmanaged',
    'PENDING': 'Needs Review'
  };
  return map[status] || 'Needs Review';
}

function calculateScopeVariance(userApplications: any[] | null): { userGroups: number; scopeGroups: number } {
  if (!userApplications) {
    return { userGroups: 0, scopeGroups: 0 };
  }

  const uniqueScopeSets = new Set(
    userApplications.map(ua => (ua.scopes || []).sort().join('|'))
  );

  return {
    userGroups: uniqueScopeSets.size,
    scopeGroups: Math.min(uniqueScopeSets.size, 5)  // Simplified as per original code
  };
}

export async function PATCH(request: Request) {
  try {
    const { id, managementStatus } = await request.json();

    if (!id || !managementStatus) {
      return NextResponse.json({ error: 'Application ID and management status are required' }, { status: 400 });
    }

    // Validate management status
    if (!['Managed', 'Unmanaged', 'Needs Review'].includes(managementStatus)) {
      return NextResponse.json({ error: 'Invalid management status' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('applications')
      .update({ management_status: managementStatus })
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating application:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 