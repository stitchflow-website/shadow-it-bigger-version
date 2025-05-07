import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateRandomString } from '@/lib/utils';

interface CreateSessionRequest {
  userId: string;
  userEmail: string;
  authProvider: 'google' | 'microsoft';
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: string;
  userAgent?: string;
  ipAddress?: string;
}

// Returns true if the token is a valid JWT
function isValidJWT(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3;
}

export async function POST(request: NextRequest) {
  try {
    // Extract the request body
    const body: CreateSessionRequest = await request.json();
    
    // Validate required fields
    if (!body.userId || !body.userEmail || !body.authProvider || !body.accessToken || !body.refreshToken || !body.expiresAt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Basic validation checks
    if (!isValidJWT(body.accessToken) || !isValidJWT(body.refreshToken)) {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 400 });
    }
    
    // Get user agent and IP if not provided
    const userAgent = body.userAgent || request.headers.get('user-agent') || null;
    const ipAddress = body.ipAddress || request.headers.get('x-forwarded-for')?.split(',')[0] || 
                      request.headers.get('x-real-ip') || null;
    
    // Insert the session into the database
    const { data: session, error } = await supabaseAdmin
      .from('user_sessions')
      .insert({
        user_id: body.userId,
        user_email: body.userEmail,
        auth_provider: body.authProvider,
        access_token: body.accessToken,
        refresh_token: body.refreshToken,
        id_token: body.idToken || null,
        expires_at: body.expiresAt,
        last_active_at: new Date().toISOString(),
        user_agent: userAgent,
        ip_address: ipAddress,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating session:', error);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
    
    // Generate a secure session ID for the cookie
    const sessionId = session.id;
    
    // Create response with session cookie
    const response = NextResponse.json({ 
      success: true, 
      sessionId,
      message: 'Session created successfully'
    });
    
    // Set a session cookie that will be used for authentication
    // Use HttpOnly to prevent JavaScript access and Secure for HTTPS only
    const isProduction = process.env.NODE_ENV === 'production';
    
    response.cookies.set('shadow_session_id', sessionId, {
      httpOnly: true, // Cannot be accessed via JavaScript
      secure: isProduction, // Only sent over HTTPS in production
      sameSite: 'lax', // Helps with CSRF protection
      path: '/', // Available across the whole site
      maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
      domain: isProduction ? '.stitchflow.com' : undefined // Domain for production
    });
    
    return response;
  } catch (error) {
    console.error('Error in session creation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 