// Risk assessment constants and utilities

export const HIGH_RISK_SCOPES = [
  // Admin access
  'https://www.googleapis.com/auth/admin',
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.user.security',
  // Sensitive data access
  'https://www.googleapis.com/auth/gmail',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/cloud-platform',
];

export const MEDIUM_RISK_SCOPES = [
  // Read-only admin access
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  // Moderate data access
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
];

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'High' | 'Medium' | 'Low';

export function determineRiskLevel(scopes: string[] | null | undefined): RiskLevel {
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'LOW';
  }

  // Check for high risk scopes first
  if (scopes.some(scope => HIGH_RISK_SCOPES.some(highRisk => scope.includes(highRisk)))) {
    return 'HIGH';
  }

  // Then check for medium risk scopes
  if (scopes.some(scope => MEDIUM_RISK_SCOPES.some(mediumRisk => scope.includes(mediumRisk)))) {
    return 'MEDIUM';
  }

  return 'LOW';
}

export function determineRiskReason(scopes: string[] | null | undefined): string {
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'Limited access to basic profile information.';
  }

  if (scopes.some(s => s.includes('admin.directory.user'))) {
    return 'Has access to user management which can modify user accounts.';
  }
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

// Helper to transform risk level case for UI consistency
export function transformRiskLevel(level: string): 'Low' | 'Medium' | 'High' {
  const map: Record<string, 'Low' | 'Medium' | 'High'> = {
    'LOW': 'Low',
    'MEDIUM': 'Medium',
    'HIGH': 'High',
    'Low': 'Low',
    'Medium': 'Medium',
    'High': 'High'
  };
  return map[level] || 'Low';
}

// Helper to determine application risk reason
export function determineAppRiskReason(riskLevel: string, totalPermissions: number): string {
  switch (riskLevel.toUpperCase()) {
    case 'HIGH':
      return `High-risk application with ${totalPermissions} permissions that can access sensitive data or perform administrative actions.`;
    case 'MEDIUM':
      return `Medium-risk application with ${totalPermissions} permissions that has access to organizational data.`;
    default:
      return `Low-risk application with ${totalPermissions} basic permissions.`;
  }
} 