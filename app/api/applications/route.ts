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
  created_at: string;
  // last_login: string | null; // Removed
}

type UserApplicationType = {
  user: UserType;
  scopes: string[];
  // last_login: string; // Removed
}

type ApplicationType = {
  id: string;
  name: string;
  category: string;
  risk_level: string;
  management_status: string;
  total_permissions: number;
  // last_login: string; // Removed
  user_applications: UserApplicationType[];
  all_scopes?: string[];
  created_at: string;
  microsoft_app_id?: string;
  owner_email?: string;
  notes?: string;
}

// Helper to generate app logo URL from logo.dev
function getAppLogoUrl(appName: string) {
  const domain = appNameToDomain(appName);
  
  // Try to get the app icon using Logo.dev
  const logoUrl = `https://img.logo.dev/${domain}?token=pk_ZLJInZ4_TB-ZDbNe2FnQ_Q&format=png&retina=true`;
  
  // We could also provide a fallback URL using other icon services if needed
  // This gives us multiple ways to find a logo if the primary method fails
  const fallbackUrl = `https://icon.horse/icon/${domain}`;
  
  // Return both URLs so the frontend can try multiple sources
  return {
    primary: logoUrl,
    fallback: fallbackUrl
  };
}

// Helper to convert app name to likely domain format
function appNameToDomain(appName: string): string {
  // Common apps with special domain formats
  const knownDomains: Record<string, string> = {
    'slack': 'slack.com',
    'stitchflow': 'stitchflow.io',
    'yeshid': 'yeshid.com',
    'onelogin': 'onelogin.com',
    'google drive': 'drive.google.com',
    'google chrome': 'google.com',
    'accessowl': 'accessowl.com',
    'accessowl scanner': 'accessowl.com',
    'mode analytics': 'mode.com',
    'hubspot': 'hubspot.com',
    'github': 'github.com',
    'gmail': 'gmail.com',
    'zoom': 'zoom.us',
    'notion': 'notion.so',
    'figma': 'figma.com',
    'jira': 'atlassian.com',
    'confluence': 'atlassian.com',
    'asana': 'asana.com',
    'trello': 'trello.com',
    'dropbox': 'dropbox.com',
    'box': 'box.com',
    'microsoft': 'microsoft.com',
    'office365': 'office.com'
  };
  
  // Convert app name to lowercase for case-insensitive lookup
  const lowerAppName = appName.toLowerCase();
  
  // Check for exact matches in known domains
  if (knownDomains[lowerAppName]) {
    return knownDomains[lowerAppName];
  }
  
  // Check for partial matches (e.g., if app name contains known key)
  for (const [key, domain] of Object.entries(knownDomains)) {
    if (lowerAppName.includes(key)) {
      return domain;
    }
  }
  
  // Default processing for unknown apps
  // Remove special characters, spaces, and convert to lowercase
  const sanitized = lowerAppName
    .replace(/[^\w\s-]/gi, '')  // Keep hyphens as they're common in domains
    .replace(/\s+/g, '');
  
  // Default to .com instead of .io
  return sanitized + '.com';
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
        user_applications:user_applications!inner (
          scopes,
          user:users!inner (
            id,
            name,
            email,
            role,
            department,
            created_at
          )
        )
      `)
      .eq('organization_id', orgId);

    if (error) {
      throw error;
    }

    if (!applications) {
      return NextResponse.json({ error: 'No applications found' }, { status: 404 });
    }

    // Transform the data to match the frontend structure
    const transformedApplications = (applications as ApplicationType[]).map(app => {
      // Get valid user applications (where user exists)
      console.log(app.management_status);
      const validUserApplications = (app.user_applications || [])
        .filter(ua => ua.user != null && ua.scopes != null);

      // Check if this is a Microsoft app
      const isMicrosoftApp = Boolean(app.microsoft_app_id);

      // Get all unique scopes from user_applications
      const allUserScopes = Array.from(new Set(
        validUserApplications.flatMap(ua => ua.scopes || [])
      ));
      
      // Use the all_scopes field from the application if available, otherwise fallback to user scopes
      const applicationScopes = (app.all_scopes || allUserScopes);

      // Get logo URLs
      const logoUrls = getAppLogoUrl(app.name);

      return {
        id: app.id,
        name: app.name,
        category: app.category || 'Others',
        userCount: validUserApplications.length,
        users: validUserApplications.map(ua => {
          const user = ua.user;
          const userScopes = ua.scopes || [];
          
          return {
            id: user.id,
            appId: app.id,
            name: user.name,
            email: user.email,
            scopes: userScopes,
            scopesMessage: isMicrosoftApp ? "Scope details not available for Microsoft applications" : undefined,
            created_at: user.created_at,
            riskLevel: determineRiskLevel(userScopes),
            riskReason: determineRiskReason(userScopes)
          };
        }),
        riskLevel: transformRiskLevel(app.risk_level),
        riskReason: determineAppRiskReason(app.risk_level, app.total_permissions),
        totalPermissions: app.total_permissions,
        scopeVariance: calculateScopeVariance(validUserApplications),
        logoUrl: logoUrls.primary,
        logoUrlFallback: logoUrls.fallback,
        created_at: app.created_at,
        managementStatus: transformManagementStatus(app.management_status),
        ownerEmail: app.owner_email || '',
        notes: app.notes || '',
        scopes: applicationScopes,
        scopesMessage: isMicrosoftApp ? "Scope details not available for Microsoft applications" : undefined,
        isInstalled: app.management_status === 'MANAGED',
        isAuthAnonymously: false,
        provider: isMicrosoftApp ? 'microsoft' : 'google'
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
    'Managed': 'Managed',
    'Unmanaged': 'Unmanaged',
    'Needs Review': 'Needs Review'
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
    const { id, managementStatus, ownerEmail, notes } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Application ID is required' }, { status: 400 });
    }

    // Build update object based on what was provided
    const updateData: any = {};
    
    if (managementStatus) {
      // Validate management status
      if (!['Managed', 'Unmanaged', 'Needs Review'].includes(managementStatus)) {
        return NextResponse.json({ error: 'Invalid management status' }, { status: 400 });
      }
      updateData.management_status = managementStatus;
    }
    
    // Add owner_email if provided
    if (ownerEmail !== undefined) {
      updateData.owner_email = ownerEmail;
    }
    
    // Add notes if provided
    if (notes !== undefined) {
      updateData.notes = notes;
    }
    
    // If nothing to update, return an error
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No update parameters provided' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('applications')
      .update(updateData)
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