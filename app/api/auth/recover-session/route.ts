import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

/**
 * API route to help recover sessions across browsers
 * Used when a user has localStorage data from a previous login
 * but doesn't have cookies in the current browser
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json();
    const { email, orgId } = body;
    
    if (!email || !orgId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Validate that the user exists
    const { data: user, error: userError } = await supabaseAdmin
      .from('users_signedup')
      .select('id, email')
      .eq('email', email)
      .single();
    
    if (userError || !user) {
      console.error('User not found:', email);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Validate that the organization exists
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, domain')
      .eq('id', orgId)
      .single();
    
    if (orgError || !org) {
      console.error('Organization not found:', orgId);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    
    // Find most recent session for this user
    const { data: recentSession, error: sessionError } = await supabaseAdmin
      .from('user_sessions')
      .select('*')
      .eq('user_email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Create a new session
    // Generate a unique session ID
    const sessionId = crypto.randomUUID();
    
    // Set session expiry (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Create the session record
    const { data: sessionData, error: createSessionError } = await supabaseAdmin
      .from('user_sessions')
      .insert({
        id: sessionId,
        user_id: user.id,
        user_email: email,
        auth_provider: recentSession?.auth_provider || 'cross_browser', // Use the same auth provider or mark as cross_browser
        expires_at: expiresAt.toISOString(),
        refresh_token: recentSession?.refresh_token || null, // Use existing refresh token if available
        access_token: recentSession?.access_token || null, // Use existing access token if available
        user_agent: request.headers.get('user-agent') || '',
        ip_address: request.headers.get('x-forwarded-for') || '',
        cross_browser_recovery: true, // Flag this as a cross-browser recovery
      })
      .select()
      .single();
    
    if (createSessionError) {
      console.error('Error creating session:', createSessionError);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
    
    // Create response
    const response = NextResponse.json({ success: true });
    
    // Set necessary cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined,
      expires: expiresAt
    };
    
    response.cookies.set('shadow_session_id', sessionId, cookieOptions);
    response.cookies.set('orgId', org.id, cookieOptions);
    response.cookies.set('userEmail', email, cookieOptions);
    
    return response;
  } catch (error) {
    console.error('Session recovery error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
} 