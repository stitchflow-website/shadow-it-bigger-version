import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // Get the session ID from the cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;
    
    if (sessionId) {
      // Delete the session from the database
      await supabaseAdmin
        .from('user_sessions')
        .delete()
        .eq('id', sessionId);
    }
    
    // Create response that clears all cookies
    const response = NextResponse.json({ 
      success: true,
      message: 'Logged out successfully' 
    });
    
    // Clear the session cookie and any other authentication cookies
    response.cookies.delete('shadow_session_id');
    response.cookies.delete('orgId');
    response.cookies.delete('userEmail');
    response.cookies.delete('user_info');
    
    return response;
  } catch (error) {
    console.error('Error during logout:', error);
    return NextResponse.json({ 
      success: false,
      message: 'Error occurred during logout' 
    }, { status: 500 });
  }
}