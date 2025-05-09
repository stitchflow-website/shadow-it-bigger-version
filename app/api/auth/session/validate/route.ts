import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Helper function to check if session is valid
 * @param sessionId The session ID from cookie
 * @returns Boolean indicating if session is valid
 */
async function isValidSession(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false;
  
  try {
    // Check if session exists and is not expired
    const { data: session, error } = await supabaseAdmin
      .from('user_sessions')
      .select('*')
      .eq('id', sessionId)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    return !!session && !error;
  } catch (error) {
    console.error('Error validating session:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check for session cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;
    const userEmail = request.cookies.get('userEmail')?.value;
    const orgId = request.cookies.get('orgId')?.value;
    
    // If we don't have the cookies, not authenticated
    if (!sessionId || !userEmail || !orgId) {
      return NextResponse.json({ authenticated: false });
    }
    
    // Validate session in database
    const hasValidSession = await isValidSession(sessionId);
    
    if (!hasValidSession) {
      return NextResponse.json({ authenticated: false });
    }
    
    // If we get here, session is valid
    return NextResponse.json({ 
      authenticated: true,
      user: {
        email: userEmail
      },
      organization: {
        id: orgId
      }
    });
  } catch (error) {
    console.error('Session validation error:', error);
    return NextResponse.json({ authenticated: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
} 