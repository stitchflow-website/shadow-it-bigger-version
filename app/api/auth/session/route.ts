import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // First check for the new shadow_session_id
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
    
    // Fallback to legacy cookie
    const userInfo = request.cookies.get('user_info')?.value;
    
    if (!userInfo) {
      return NextResponse.json({
        authenticated: false,
        message: 'No session found'
      });
    }
    
    // Parse the user info
    const user = JSON.parse(userInfo);
    
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider
      }
    });
  } catch (error) {
    console.error('Error checking session:', error);
    return NextResponse.json({
      authenticated: false,
      message: 'Error checking session'
    }, { status: 500 });
  }
} 