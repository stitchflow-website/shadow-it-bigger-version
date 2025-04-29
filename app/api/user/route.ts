import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');
    
    if (!email) {
      return NextResponse.json({ error: 'Email parameter is required' }, { status: 400 });
    }
    
    // Fetch user from users_signedup table
    const { data: userData, error } = await supabaseAdmin
      .from('users_signedup')
      .select('id, name, email, avatar_url')
      .eq('email', email)
      .single();
    
    if (error) {
      console.error('Error fetching user data:', error);
      return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 });
    }
    
    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json(userData);
  } catch (error) {
    console.error('Error in user API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 