import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Use await with cookies() as it returns a Promise
    const cookieStore = await cookies();
    const userEmail = cookieStore.get('userEmail')?.value;
    
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