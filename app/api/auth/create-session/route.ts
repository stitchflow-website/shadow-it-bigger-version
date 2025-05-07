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
    const { email, name, provider, accessToken, refreshToken, forceRefresh, existingUser } = await request.json();

    if (!email || !name || !provider) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`Creating/refreshing session for user: ${email}, existing user: ${!!existingUser}`);

    // Create user metadata
    const metadata = {
      name,
      provider,
      oauth_access_token: accessToken,
      oauth_refresh_token: refreshToken,
      updated_at: new Date().toISOString()
    };

    // Check if the user already exists in Supabase
    const { data: existingUserData, error: userLookupError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    // Filter for the matching email since we can't directly query by email
    const userExists = existingUserData?.users && 
      existingUserData.users.some(user => user.email === email);
    console.log(`User lookup result: exists=${userExists}, error=${!!userLookupError}`);

    if (userLookupError) {
      console.error('Error looking up user:', userLookupError);
    }

    let session;

    if (userExists) {
      // User exists in Supabase
      console.log('User exists in Supabase, updating metadata and signing in');
      // Find the user with matching email
      const userId = existingUserData.users.find(user => user.email === email)!.id;

      try {
        // Update user metadata first
        await supabaseAdmin.auth.admin.updateUserById(userId, { 
          user_metadata: metadata 
        });
        
        // Then try to sign in the user with the ID token
        const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
          provider,
          token: accessToken,
        });

        if (signInError) {
          console.error('Error signing in with ID token:', signInError);
          return NextResponse.json({ 
            error: 'Failed to authenticate user, please try again',
            needsRetry: true
          }, { status: 401 });
        } else {
          session = signInData.session;
        }
      } catch (updateError) {
        console.error('Error updating existing user:', updateError);
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
      }
    } else {
      // User doesn't exist in Supabase, create them
      console.log('User does not exist in Supabase, creating new user');
      try {
        // Create the user with admin API
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: metadata,
          password: `${email}-${provider}-${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 8) || 'fallback'}`
        });
        
        if (createError) {
          console.error('Error creating user:', createError);
          
          // If the error is that the user already exists, try to sign in with ID token
          if (createError.message === 'A user with this email address has already been registered') {
            console.log('User already exists despite lookup failure, trying to sign in with ID token');
            const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
              provider,
              token: accessToken,
            });
            
            if (signInError) {
              console.error('Error signing in with ID token after creation failure:', signInError);
              return NextResponse.json({ 
                error: 'Failed to authenticate existing user',
                needsRetry: true
              }, { status: 401 });
            }
            
            session = signInData.session;
          } else {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
          }
        } else {
          // Sign in with the newly created user using ID token
          const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
            provider,
            token: accessToken,
          });
          
          if (signInError) {
            console.error('Error signing in with ID token after user creation:', signInError);
            return NextResponse.json({ 
              error: 'Failed to sign in new user',
              needsRetry: true
            }, { status: 401 });
          }
          
          session = signInData.session;
        }
      } catch (createError) {
        console.error('Unexpected error creating user:', createError);
        return NextResponse.json({ error: 'Internal error creating user' }, { status: 500 });
      }
    }

    if (!session) {
      console.error('Failed to obtain a valid session after multiple attempts');
      return NextResponse.json({ 
        error: 'Could not establish session',
        needsRetry: true 
      }, { status: 401 });
    }
    
    // Create response with session data
    const response = NextResponse.json({
      success: true,
      session,
      user: {
        id: session.user.id,
        email,
        name,
        provider
      }
    });

    // Set cookies in the response headers with long expiry and proper domains
    const isProduction = process.env.NODE_ENV === 'production';
    const domain = isProduction ? '.stitchflow.com' : undefined;

    response.cookies.set('sb-access-token', session.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      domain,
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    response.cookies.set('sb-refresh-token', session.refresh_token, {
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