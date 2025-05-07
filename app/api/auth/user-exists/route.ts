import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Get the email parameter
    const email = request.nextUrl.searchParams.get('email');
    
    if (!email) {
      return NextResponse.json({ 
        exists: false,
        message: 'Email parameter is required' 
      }, { status: 400 });
    }
    
    // Check if user exists in the database
    const { data, error, count } = await supabaseAdmin
      .from('users_signedup')
      .select('id', { count: 'exact', head: true })
      .eq('email', email);
    
    if (error) {
      console.error('Error checking if user exists:', error);
      return NextResponse.json({ 
        exists: false,
        message: 'Error checking user existence' 
      }, { status: 500 });
    }
    
    // Set the email in localStorage if requested
    // This helps with cross-browser login scenarios
    const response = NextResponse.json({
      exists: count !== null && count > 0
    });
    
    return response;
    
  } catch (error) {
    console.error('Error in user-exists endpoint:', error);
    return NextResponse.json({ 
      exists: false,
      message: 'Internal server error'
    }, { status: 500 });
  }
} 