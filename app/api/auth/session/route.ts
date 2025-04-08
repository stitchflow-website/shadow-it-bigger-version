import { NextResponse } from 'next/server';
import { getOrganizationId, getUserEmail } from '@/lib/server-utils';

export async function GET() {
  try {
    const [orgId, userEmail] = await Promise.all([
      getOrganizationId(),
      getUserEmail()
    ]);

    if (!orgId || !userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      orgId,
      userEmail,
      isAuthenticated: true
    });
  } catch (error) {
    console.error('Session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 