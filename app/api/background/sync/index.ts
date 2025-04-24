import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token, 
      user_email, 
      user_hd,
      provider = 'google' // Default to Google but allow Microsoft
    } = body;

    console.log(`Starting background sync for ${provider} user:`, {
      email: user_email,
      sync_id,
      organization_id: organization_id || 'not_provided'
    });
    
    if (!sync_id) {
      console.error('Missing sync_id in request');
      return NextResponse.json({ error: 'Missing sync_id in request' }, { status: 400 });
    }

    // Update sync status to indicate progress
    await supabase
      .from('sync_status')
      .update({
        progress: 10,
        message: `Processing ${provider} data...`,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);
      
    // Determine which sync handler to call based on provider
    let syncHandler;
    
    // Call the appropriate provider-specific sync endpoint
    if (provider === 'microsoft') {
      syncHandler = fetch(`${request.nextUrl.origin}/tools/shadow-it-scan/api/background/sync/microsoft`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
    } else {
      // Default to Google sync
      syncHandler = fetch(`${request.nextUrl.origin}/tools/shadow-it-scan/api/background/sync/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id,
          sync_id,
          access_token,
          refresh_token,
          user_email,
          user_hd
        }),
      });
    }
    
    // Don't await this call - let it run in the background
    syncHandler.then(async (response) => {
      if (!response.ok) {
        const errorData = await response.text();
        console.error(`${provider} sync failed:`, errorData);
        
        await supabase
          .from('sync_status')
          .update({
            status: 'FAILED',
            message: `${provider} sync failed: ${errorData.substring(0, 100)}...`,
            updated_at: new Date().toISOString()
          })
          .eq('id', sync_id);
      } else {
        console.log(`${provider} sync successfully triggered`);
      }
    }).catch(error => {
      console.error(`Error in ${provider} sync:`, error);
    });

    return NextResponse.json({ 
      success: true, 
      message: `${provider} sync initiated in the background` 
    });
  } catch (error) {
    console.error('Error in background sync:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 