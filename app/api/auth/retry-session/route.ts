import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Helper function to get cookie settings based on environment
function getCookieSettings() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as 'lax',
    path: '/',
    domain: isProduction ? '.stitchflow.com' : undefined,
  };
}

export async function POST(request: Request) {
  try {
    // Create a Supabase client for this request
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true
        }
      }
    );
    
    // Try to refresh the session
    const { data, error } = await supabase.auth.refreshSession();
    
    if (error || !data.session) {
      console.error('Error refreshing session:', error);
      
      // Get the current user email from cookies if available
      const userEmail = request.headers.get('cookie')?.split(';')
        .find(c => c.trim().startsWith('userEmail='))
        ?.split('=')[1];
      
      // If we have an email, we can try to create a new session
      if (userEmail) {
        // Try to get user info from the database
        const { data: userData } = await supabaseAdmin
          .from('users_signedup')
          .select('email, name')
          .eq('email', userEmail)
          .single();
          
        if (userData) {
          return NextResponse.json({ 
            error: 'Session expired', 
            action: 'login_required',
            email: userData.email
          }, { status: 401 });
        }
      }
      
      return NextResponse.json({ 
        error: 'Authentication failed', 
        action: 'login_required' 
      }, { status: 401 });
    }
    
    // Session was successfully refreshed
    const session = data.session;
    const user = session.user;
    
    // Create response
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name || 'User',
      }
    });

    // Set cookies with the new session tokens
    const cookieSettings = getCookieSettings();
    
    response.cookies.set('sb-access-token', session.access_token, {
      ...cookieSettings,
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    response.cookies.set('sb-refresh-token', session.refresh_token, {
      ...cookieSettings,
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // Also update the userEmail cookie if it exists
    if (user.email) {
      response.cookies.set('userEmail', user.email, {
        ...cookieSettings,
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });
    }

    return response;
  } catch (error) {
    console.error('Error in retry-session:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      action: 'try_again' 
    }, { status: 500 });
  }
} 