import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'shadow_it'
    }
  }
);

// GET endpoint to retrieve user notification preferences
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    
    // Verify we have a valid organization ID
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Get the user's email from cookies
    const cookieHeader = request.headers.get('cookie') || '';
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    const userEmail = cookies.userEmail;
    
    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found in cookies' }, { status: 401 });
    }

    // Query the notification preferences for this user and organization
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_email', userEmail)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned" error
      console.error('Error fetching notification preferences:', error);
      return NextResponse.json({ error: 'Failed to fetch notification preferences' }, { status: 500 });
    }

    // If no preferences are found, return default preferences
    if (!data) {
      // Create default preferences
      const defaultPreferences = {
        new_app_detected: true,
        new_user_in_app: true,
        new_user_in_review_app: true
      };
      
      // Create an entry with default preferences
      const { data: newPrefs, error: insertError } = await supabaseAdmin
        .from('notification_preferences')
        .insert({
          organization_id: orgId,
          user_email: userEmail,
          new_app_detected: defaultPreferences.new_app_detected,
          new_user_in_app: defaultPreferences.new_user_in_app,
          new_user_in_review_app: defaultPreferences.new_user_in_review_app
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('Error creating default notification preferences:', insertError);
        return NextResponse.json({ error: 'Failed to create default notification preferences' }, { status: 500 });
      }
      
      return NextResponse.json({ preferences: newPrefs });
    }

    return NextResponse.json({ preferences: data });
  } catch (error) {
    console.error('Error in notification preferences GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST endpoint to update user notification preferences
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { orgId, preferences } = body;
    
    // Validate input
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }
    
    if (!preferences) {
      return NextResponse.json({ error: 'Preferences object is required' }, { status: 400 });
    }

    // Get the user's email from cookies
    const cookieHeader = request.headers.get('cookie') || '';
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    const userEmail = cookies.userEmail;
    
    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found in cookies' }, { status: 401 });
    }

    // Update the notification preferences for this user and organization
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .upsert({
        organization_id: orgId,
        user_email: userEmail,
        new_app_detected: preferences.new_app_detected,
        new_user_in_app: preferences.new_user_in_app,
        new_user_in_review_app: preferences.new_user_in_review_app,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating notification preferences:', error);
      return NextResponse.json({ error: 'Failed to update notification preferences' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Notification preferences updated successfully', 
      preferences: data 
    });
  } catch (error) {
    console.error('Error in notification preferences POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 