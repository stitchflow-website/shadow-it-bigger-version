import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Create a new Supabase client for auth operations
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

export async function POST(request: Request) {
  try {
    const { email, name, provider, accessToken, refreshToken } = await request.json();

    if (!email || !name || !provider) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Create user metadata
    const metadata = {
      name,
      provider,
      oauth_access_token: accessToken,
      oauth_refresh_token: refreshToken
    };

    // First try to sign in the user with the custom OAuth tokens
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      // Use a deterministic password based on email+provider to ensure consistency across browsers
      password: `${email}-${provider}-${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 8) || 'fallback'}`
    });

    // If sign-in fails (likely because user doesn't exist), create the user
    if (signInError) {
      console.log('Sign in failed, creating user:', signInError.message);
      
      // Create the user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: metadata,
        password: `${email}-${provider}-${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 8) || 'fallback'}`
      });
      
      if (createError) {
        console.error('Error creating user:', createError);
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
      }
      
      // Sign in with the newly created user
      const { data: newSignInData, error: newSignInError } = await supabase.auth.signInWithPassword({
        email,
        password: `${email}-${provider}-${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 8) || 'fallback'}`
      });
      
      if (newSignInError) {
        console.error('Error signing in after user creation:', newSignInError);
        return NextResponse.json({ error: 'Failed to sign in new user' }, { status: 500 });
      }
      
      // Use the new sign-in data
      const session = newSignInData.session;
      
      // Create response with session data
      const response = NextResponse.json({
        success: true,
        user: {
          id: newUser.user.id,
          email,
          name,
          provider
        }
      });

      // Set cookies in the response headers with long expiry and proper domains
      const isProduction = process.env.NODE_ENV === 'production';
      const domain = isProduction ? '.stitchflow.com' : undefined;

      response.cookies.set('sb-access-token', session?.access_token || '', {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        domain,
        maxAge: 60 * 60 * 24 * 7 // 1 week
      });

      response.cookies.set('sb-refresh-token', session?.refresh_token || '', {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        domain,
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });

      return response;
    }
    
    // User exists and sign in succeeded
    const session = signInData.session;
    
    // Update user metadata
    await supabaseAdmin.auth.admin.updateUserById(
      session!.user.id,
      { user_metadata: metadata }
    );
    
    // Create response with session data
    const response = NextResponse.json({
      success: true,
      user: {
        id: session!.user.id,
        email,
        name,
        provider
      }
    });

    // Set cookies in the response headers with long expiry and proper domains
    const isProduction = process.env.NODE_ENV === 'production';
    const domain = isProduction ? '.stitchflow.com' : undefined;

    response.cookies.set('sb-access-token', session!.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      domain,
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    response.cookies.set('sb-refresh-token', session!.refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      domain,
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    return response;

  } catch (error) {
    console.error('Error in create-session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 