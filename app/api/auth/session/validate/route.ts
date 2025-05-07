import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Get the session ID from the cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;
    
    if (!sessionId) {
      return NextResponse.json({ 
        authenticated: false,
        message: 'No session cookie found' 
      });
    }
    
    // Check if session exists and is not expired
    const { data: session, error } = await supabaseAdmin
      .from('user_sessions')
      .select('*')
      .eq('id', sessionId)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    if (error || !session) {
      return NextResponse.json({ 
        authenticated: false,
        message: 'Invalid or expired session' 
      });
    }
    
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
  } catch (error) {
    console.error('Error validating session:', error);
    return NextResponse.json({ 
      authenticated: false,
      message: 'Error validating session' 
    }, { status: 500 });
  }
} 