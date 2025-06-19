import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// For client components to get session info
export async function getSessionInfo() {
  try {
    const response = await fetch('/tools/shadow-it-scan/api/auth/session');
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error('Error getting session info:', error);
    return null;
  }
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Generates a cryptographically secure random string
 * @param length Length of the string to generate (default: 32)
 * @returns A random string of the specified length
 */
export function generateRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues)
    .map(v => chars[v % chars.length])
    .join('');
}

/**
 * Maps domain names for display purposes only (UI display layer)
 * This doesn't affect backend logic or data processing
 */
export function mapDomainForDisplay(email: string): string {
  if (!email || typeof email !== 'string') return email;
  
  // Replace hewison.com.au and example.com with acme.com for display
  return email
    .replace(/hewison\.com\.au/g, 'acme.com')
    .replace(/example\.com/g, 'acme.com');
}

/**
 * Maps organization/domain names for display
 */
export function mapOrgNameForDisplay(orgName: string): string {
  if (!orgName || typeof orgName !== 'string') return orgName;
  
  return orgName
    .replace(/hewison\.com\.au/g, 'acme.com')
    .replace(/example\.com/g, 'acme.com');
}
