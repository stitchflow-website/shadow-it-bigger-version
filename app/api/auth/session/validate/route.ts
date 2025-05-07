import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Check for the primary session cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;
    
    if (sessionId) {
      // Check if session exists and is not expired
      const { data: session, error } = await supabaseAdmin
        .from('user_sessions')
        .select('*')
        .eq('id', sessionId)
        .gte('expires_at', new Date().toISOString())
        .single();
      
      if (session && !error) {
        // Update the last active time
        await supabaseAdmin
          .from('user_sessions')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', sessionId);
        
        // Return user information from the session
        return NextResponse.json({
          authenticated: true,
          user: {
            id: session.user_id,
            email: session.user_email,
            provider: session.auth_provider
          }
        });
      }
    }
    
    // If primary session not found, check for old session format or partial sessions
    // This helps in cases where shadow_session_id cookie might not be accessible
    // but other cookies are present
    
    // Check for orgId and userEmail cookies as a fallback
    const orgId = request.cookies.get('orgId')?.value;
    const userEmail = request.cookies.get('userEmail')?.value;
    
    if (orgId && userEmail) {
      // Check if there are any valid sessions for this user email
      const { data: sessions, error } = await supabaseAdmin
        .from('user_sessions')
        .select('*')
        .eq('user_email', userEmail)
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (sessions && sessions.length > 0 && !error) {
        const session = sessions[0];
        
        // Update the last active time
        await supabaseAdmin
          .from('user_sessions')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', session.id);
        
        // Set a new session cookie to try to fix the missing cookie
        const response = NextResponse.json({
          authenticated: true,
          user: {
            id: session.user_id,
            email: session.user_email,
            provider: session.auth_provider
          }
        });
        
        // Set the session cookie again to try to recover it
        const expiresAt = new Date(session.expires_at);
        response.cookies.set('shadow_session_id', session.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          path: '/',
          expires: expiresAt
        });
        
        return response;
      }
    }
    
    // If no valid session found, check for legacy user_info cookie
    const userInfo = request.cookies.get('user_info')?.value;
    if (userInfo) {
      try {
        const user = JSON.parse(userInfo);
        return NextResponse.json({
          authenticated: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            provider: user.provider
          },
          legacy: true
        });
      } catch (e) {
        console.error('Error parsing user_info cookie:', e);
      }
    }
    
    return NextResponse.json({ 
      authenticated: false,
      message: 'No valid session found' 
    });
  } catch (error) {
    console.error('Error validating session:', error);
    return NextResponse.json({ 
      authenticated: false,
      message: 'Error validating session' 
    }, { status: 500 });
  }
} 