import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    // Get cookies from the request directly instead of using the cookies() function
    const sbAccessToken = request.cookies.get('sb-access-token')?.value;
    const sbRefreshToken = request.cookies.get('sb-refresh-token')?.value;
    const userEmail = request.cookies.get('userEmail')?.value;
    
    // If Supabase cookies exist, try to validate the session
    if (sbAccessToken && sbRefreshToken) {
      // Create Supabase client with the session cookies
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${sbAccessToken}`
            }
          }
        }
      );
      
      // Try to get the session
      const { data, error } = await supabase.auth.getSession();
      
      if (!error && data?.session) {
        // Get user info from user metadata
        const { user } = data.session;
        
        // Try to get additional user data from the database
        const { data: userData, error: userError } = await supabaseAdmin
          .from('users_signedup')
          .select('id, name, email, avatar_url')
          .eq('email', user.email)
          .single();
        
        if (!userError && userData) {
          return NextResponse.json({
            id: userData.id,
            name: userData.name || user.user_metadata?.name,
            email: userData.email,
            avatar_url: userData.avatar_url
          });
        }
        
        // If database query fails, use metadata from the session
        return NextResponse.json({
          id: user.id,
          name: user.user_metadata?.name || 'User',
          email: user.email,
          avatar_url: null
        });
      }
    }
    
    // Fall back to traditional cookie-based authentication
    if (!userEmail) {
      console.log('No user email found in cookies');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    // Fetch user data from the database
    const { data: userData, error } = await supabaseAdmin
      .from('users_signedup')
      .select('id, name, email, avatar_url')
      .eq('email', userEmail)
      .single();
    
    if (error) {
      console.error('Error fetching user data:', error);
      return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 });
    }
    
    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json({
      id: userData.id,
      name: userData.name,
      email: userData.email,
      avatar_url: userData.avatar_url
    });
  } catch (error) {
    console.error('Error in session info API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 