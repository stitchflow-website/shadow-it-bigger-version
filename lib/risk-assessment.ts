// Risk assessment constants and utilities

export const HIGH_RISK_SCOPES = [
  // Admin access
  'https://www.googleapis.com/auth/admin',
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/admin.directory.user.security',
  // Sensitive data access
  'https://www.googleapis.com/auth/gmail',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://mail.google.com/',
];

export const MEDIUM_RISK_SCOPES = [
  // Read-only admin access
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.member.readonly',
  // Moderate data access
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/spreadsheets',
];

// Add Microsoft risk scopes
export const MICROSOFT_HIGH_RISK_SCOPES = [
  'Application.ReadWrite.All',
  'User.ReadWrite.All',
  'Group.ReadWrite.All',
  'Directory.ReadWrite.All',
  'Mail.ReadWrite',
  'Mail.ReadWrite.All',
  'Mail.Send',
  'Files.ReadWrite.All',
  'Sites.ReadWrite.All',
  'MailboxSettings.ReadWrite'
];

export const MICROSOFT_MEDIUM_RISK_SCOPES = [
  'Application.Read.All',
  'Directory.Read.All',
  'Group.Read.All',
  'User.Read.All',
  'Files.Read.All',
  'Mail.Read',
  'Mail.Read.All',
  'Sites.Read.All',
  'AuditLog.Read.All',
  'Reports.Read.All'
];

// High risk scope patterns
export const HIGH_RISK_PATTERNS = [
  '.ReadWrite.All',
  '.ReadWrite',
  'FullControl',
  'Write.All'
];

// Medium risk scope patterns
export const MEDIUM_RISK_PATTERNS = [
  '.Read.All',
  'Reports.Read',
  'AuditLog.Read'
];

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'High' | 'Medium' | 'Low';

/**
 * Determines the risk level for a set of scopes by checking both Google and Microsoft patterns
 * @param scopes - Array of permission scopes to evaluate
 * @returns Standardized risk level (High, Medium, or Low)
 */
export function determineRiskLevel(scopes: string[] | null | undefined): RiskLevel {
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'Low';
  }

  // Split scopes by platform
  const googleScopes = scopes.filter(s => s.startsWith('https://www.googleapis.com/auth/') || s.startsWith('https://mail.google.com/'));
  const microsoftScopes = scopes.filter(s => !s.startsWith('https://www.googleapis.com/auth/') && !s.startsWith('https://mail.google.com/'));

  // Check for high risk in either platform
  if (hasHighRiskScopes(googleScopes, microsoftScopes)) {
    return 'High';
  }

  // Check for medium risk in either platform
  if (hasMediumRiskScopes(googleScopes, microsoftScopes)) {
    return 'Medium';
  }

  // Default to low risk
  return 'Low';
}

/**
 * Determines if any scopes are high risk
 */
function hasHighRiskScopes(googleScopes: string[], microsoftScopes: string[]): boolean {
  // Check Google high risk
  if (googleScopes.some(scope => HIGH_RISK_SCOPES.some(highRisk => scope.includes(highRisk)))) {
    return true;
  }

  // Check Microsoft high risk - exact matches
  if (microsoftScopes.some(scope => MICROSOFT_HIGH_RISK_SCOPES.includes(scope))) {
    return true;
  }

  // Check Microsoft high risk - pattern matches
  if (microsoftScopes.some(scope => HIGH_RISK_PATTERNS.some(pattern => scope.includes(pattern)))) {
    return true;
  }

  return false;
}

/**
 * Determines if any scopes are medium risk (but not high risk)
 */
function hasMediumRiskScopes(googleScopes: string[], microsoftScopes: string[]): boolean {
  // Check Google medium risk
  if (googleScopes.some(scope => MEDIUM_RISK_SCOPES.some(mediumRisk => scope.includes(mediumRisk)))) {
    return true;
  }

  // Check Microsoft medium risk - exact matches
  if (microsoftScopes.some(scope => MICROSOFT_MEDIUM_RISK_SCOPES.includes(scope))) {
    return true;
  }

  // Check Microsoft medium risk - pattern matches
  if (microsoftScopes.some(scope => MEDIUM_RISK_PATTERNS.some(pattern => scope.includes(pattern)))) {
    return true;
  }

  return false;
}

/**
 * Evaluates a single scope for its risk level
 * @param scope - Individual permission scope to evaluate
 * @returns Risk level for this individual scope
 */
export function evaluateSingleScopeRisk(scope: string): RiskLevel {
  return determineRiskLevel([scope]);
}

export function determineRiskReason(scopes: string[] | null | undefined): string {
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'Limited access to basic profile information.';
  }

  if (scopes.some(s => s.includes('admin.directory.user'))) {
    return 'Has access to user management which can modify user accounts.';
  }
  if (scopes.some(s => s.includes('admin.directory.group'))) {
    return 'Has access to group management which can modify access controls.';
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

/**
 * Gets the appropriate color for a risk level
 * @param level - Risk level to get color for
 * @returns Hex color code
 */
export function getRiskLevelColor(level: string): string {
  const normalizedLevel = transformRiskLevel(level);
  
  const colorMap: Record<string, string> = {
    'Low': '#81C784',    // Green
    'Medium': '#FFD54F', // Yellow/Amber
    'High': '#EF5350'    // Red
  };
  
  return colorMap[normalizedLevel] || colorMap.Low;
} 