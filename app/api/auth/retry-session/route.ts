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
    console.log('Starting session retry attempt');
    
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
    console.log('Attempting to refresh Supabase session');
    const { data, error } = await supabase.auth.refreshSession();
    
    if (error || !data.session) {
      console.error('Error refreshing session:', error?.message || 'No session data returned');
      
      // Get the current user email from cookies if available
      const cookieHeader = request.headers.get('cookie');
      console.log('Cookie header present:', !!cookieHeader);
      
      const userEmail = cookieHeader?.split(';')
        .find(c => c.trim().startsWith('userEmail='))
        ?.split('=')[1];
      
      console.log('User email from cookie:', userEmail || 'Not found');
      
      // If we have an email, we can try to create a new session
      if (userEmail) {
        // Try to get user info from the database
        console.log('Looking up user in database:', userEmail);
        const { data: userData, error: userError } = await supabaseAdmin
          .from('users_signedup')
          .select('email, name')
          .eq('email', userEmail)
          .single();
          
        if (userError) {
          console.error('Error fetching user data:', userError);
        }
          
        if (userData) {
          console.log('User found in database:', userData.email);
          
          // Try to create a new session for the user if we don't already have one
          try {
            console.log('Attempting to create a new session for:', userData.email);
            
            // Return a standardized response for client-side handling
            return NextResponse.json({ 
              error: 'Session expired', 
              action: 'login_required',
              email: userData.email,
              message: 'Your session has expired. Please sign in again.'
            }, { status: 401 });
          } catch (createError) {
            console.error('Error creating new session:', createError);
          }
        } else {
          console.log('User not found in database');
        }
      }
      
      return NextResponse.json({ 
        error: 'Authentication failed', 
        action: 'login_required',
        message: 'Authentication failed. Please sign in again.'
      }, { status: 401 });
    }
    
    // Session was successfully refreshed
    const session = data.session;
    const user = session.user;
    console.log('Session successfully refreshed for:', user.email);
    
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
    console.log('Setting refreshed session cookies');
    
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
      
      // Also set orgId if available
      const orgIdCookie = request.headers.get('cookie')?.split(';')
        .find(c => c.trim().startsWith('orgId='));
      
      if (orgIdCookie) {
        const orgId = orgIdCookie.split('=')[1].trim();
        if (orgId) {
          response.cookies.set('orgId', orgId, {
            ...cookieSettings,
            maxAge: 60 * 60 * 24 * 30 // 30 days
          });
        }
      }
    }

    return response;
  } catch (error) {
    console.error('Unexpected error in retry-session:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      action: 'try_again',
      message: 'An unexpected error occurred. Please try again or sign in again.'
    }, { status: 500 });
  }
} 