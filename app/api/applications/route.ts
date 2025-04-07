import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

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

      return {
        id: app.id,
        name: app.name,
        category: app.category || 'Others',
        userCount: uniqueUsers.length,
        users: uniqueUsers.map(user => ({
          id: user.id,
          appId: app.id,
          name: user.name,
          email: user.email,
          lastActive: app.user_applications.find((ua: UserApplicationType) => 
            ua.user.id === user.id
          )?.last_login || user.last_login,
          scopes: app.user_applications.find((ua: UserApplicationType) => 
            ua.user.id === user.id
          )?.scopes || [],
          riskLevel: determineUserRiskLevel(app.user_applications.find((ua: UserApplicationType) => 
            ua.user.id === user.id
          )?.scopes || []),
          riskReason: determineUserRiskReason(app.user_applications.find((ua: UserApplicationType) => 
            ua.user.id === user.id
          )?.scopes || [])
        })),
        riskLevel: transformRiskLevel(app.risk_level),
        riskReason: determineAppRiskReason(app.risk_level, app.total_permissions),
        totalPermissions: app.total_permissions,
        scopeVariance: calculateScopeVariance(app.user_applications),
        lastLogin: lastLogin,
        managementStatus: transformManagementStatus(app.management_status),
        ownerEmail: '',
        notes: '',
        scopes: Array.from(new Set(app.user_applications?.flatMap(ua => ua.scopes || []) || [])),
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

function transformRiskLevel(level: string): 'Low' | 'Medium' | 'High' {
  const map: Record<string, 'Low' | 'Medium' | 'High'> = {
    'LOW': 'Low',
    'MEDIUM': 'Medium',
    'HIGH': 'High'
  };
  return map[level] || 'Low';
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

function determineUserRiskLevel(scopes: string[] | null): 'Low' | 'Medium' | 'High' {
  if (!scopes || scopes.length === 0) return 'Low';

  const highRiskScopes = [
    'https://www.googleapis.com/auth/gmail',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/admin'
  ];

  const mediumRiskScopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/contacts'
  ];

  if (scopes.some(scope => highRiskScopes.some(s => scope.includes(s)))) {
    return 'High';
  }

  if (scopes.some(scope => mediumRiskScopes.some(s => scope.includes(s)))) {
    return 'Medium';
  }

  return 'Low';
}

function determineUserRiskReason(scopes: string[] | null): string {
  if (!scopes || scopes.length === 0) return 'Limited access to basic profile information.';

  if (scopes.some(s => s.includes('gmail'))) {
    return 'Has access to email data which may contain sensitive information.';
  }
  if (scopes.some(s => s.includes('drive'))) {
    return 'Has access to files and documents which may contain confidential data.';
  }
  if (scopes.some(s => s.includes('admin'))) {
    return 'Has administrative access which grants extensive control.';
  }
  if (scopes.some(s => s.includes('calendar'))) {
    return 'Has access to calendar data which may reveal organizational activities.';
  }
  if (scopes.some(s => s.includes('contacts'))) {
    return 'Has access to contact information.';
  }

  return 'Limited access to basic profile information.';
}

function determineAppRiskReason(riskLevel: string, totalPermissions: number): string {
  switch (riskLevel) {
    case 'HIGH':
      return `High-risk application with ${totalPermissions} permissions that can access sensitive data.`;
    case 'MEDIUM':
      return `Medium-risk application with ${totalPermissions} permissions that has access to organizational data.`;
    default:
      return `Low-risk application with ${totalPermissions} basic permissions.`;
  }
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