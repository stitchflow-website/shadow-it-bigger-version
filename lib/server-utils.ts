import { headers } from 'next/headers';
import { cookies } from 'next/headers';

export async function getOrganizationId(): Promise<string | null> {
  try {
    // Try to get from headers first (set by middleware)
    const headersList = await headers();
    const orgId = headersList.get('x-organization-id');
    if (orgId) return orgId;

    // Fallback to cookies
    const cookieStore = await cookies();
    return cookieStore.get('orgId')?.value || null;
  } catch (error) {
    console.error('Error getting organization ID:', error);
    return null;
  }
}

export async function getUserEmail(): Promise<string | null> {
  try {
    // Try to get from headers first (set by middleware)
    const headersList = await headers();
    const userEmail = headersList.get('x-user-email');
    if (userEmail) return userEmail;

    // Fallback to cookies
    const cookieStore = await cookies();
    return cookieStore.get('userEmail')?.value || null;
  } catch (error) {
    console.error('Error getting user email:', error);
    return null;
  }
} 