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

// Endpoint to create default notification preferences when a user signs up
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { orgId, userEmail } = body;
    
    // Validate required parameters
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }
    
    if (!userEmail) {
      return NextResponse.json({ error: 'User email is required' }, { status: 400 });
    }
    
    // Check if preferences already exist for this user and organization
    const { data: existingPrefs, error: checkError } = await supabaseAdmin
      .from('notification_preferences')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_email', userEmail)
      .single();
    
    // If preferences already exist, no need to create them again
    if (existingPrefs) {
      return NextResponse.json({ 
        success: true, 
        message: 'Notification preferences already exist', 
        id: existingPrefs.id 
      });
    }
    
    // Only create preferences if they don't exist yet
    const defaultPreferences = {
      new_app_detected: true,
      new_user_in_app: true,
      new_user_in_review_app: true
    };
    
    // Create default notification preferences
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .insert({
        organization_id: orgId,
        user_email: userEmail,
        new_app_detected: defaultPreferences.new_app_detected,
        new_user_in_app: defaultPreferences.new_user_in_app,
        new_user_in_review_app: defaultPreferences.new_user_in_review_app,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating default notification preferences:', error);
      return NextResponse.json({ error: 'Failed to create default notification preferences' }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Default notification preferences created successfully', 
      preferences: data 
    });
  } catch (error) {
    console.error('Error in create-default-preferences:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 