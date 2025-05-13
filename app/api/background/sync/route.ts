import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: NextRequest) {
  let requestData;
  try {
    // Parse the request data once and store it for reuse
    requestData = await request.json();
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token,
      provider 
    } = requestData;

    if (!organization_id || !sync_id || !access_token || !provider) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Update sync status to indicate progress
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 10,
        message: `Starting ${provider} data sync...`,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);

    // Determine which sync endpoints to call based on provider
    const endpoints = provider === 'google' 
      ? [
          'api/background/sync/users',
          'api/background/sync/tokens',
          // 'api/background/sync/relations',
          // 'api/background/sync/categorize'
        ]
      : [
          'api/background/sync/microsoft'
        ];

    // Extract the host from the URL
    const urlObj = new URL(request.url);
    const host = urlObj.hostname === 'localhost' ? urlObj.host : urlObj.hostname;
    
    // Force HTTP for localhost development, otherwise use HTTPS
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const baseUrl = `${protocol}${host}`;
    
    console.log(`Using base URL: ${baseUrl}`);

    // Call each endpoint in sequence
    for (const endpoint of endpoints) {
      try {
        // Try first with the /tools/shadow-it-scan prefix as per next.config.js assetPrefix
        const prefixedUrl = `${baseUrl}/${endpoint}`;
        console.log(`Calling ${prefixedUrl}...`);
        let response;
        
        try {
          response = await fetch(prefixedUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              organization_id,
              sync_id,
              access_token,
              refresh_token,
              provider
            }),
          });
        } catch (fetchError) {
          console.log(`Error with ${prefixedUrl}, trying without /tools/shadow-it-scan/ prefix...`);
          // If the first attempt fails, try without the prefix
          const directUrl = `${baseUrl}/${endpoint}`;
          console.log(`Calling ${directUrl}...`);
          response = await fetch(directUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              organization_id,
              sync_id,
              access_token,
              refresh_token,
              provider
            }),
          });
        }

        if (!response.ok) {
          const error = await response.text();
          console.error(`Error from ${endpoint}:`, error);
          throw new Error(`${endpoint} failed: ${error}`);
        }

        console.log(`Successfully completed ${endpoint}`);
        
        // Add a small delay between endpoints to ensure database operations complete
        if (endpoint.includes('users')) {
          console.log('Waiting for database to process user data...');
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }
      } catch (error) {
        console.error(`Error processing ${endpoint}:`, error);
        throw error;
      }
    }

    // Wait additional time for any background processes to complete
    console.log('Main sync completed, waiting for background processes...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
    
    // Update sync status to 95% while we wait for final background tasks
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 95,
        message: 'Finalizing data synchronization...',
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);
      
    // Wait a bit longer to ensure all background processes finish
    await new Promise(resolve => setTimeout(resolve, 5000)); // Another 5 second delay

    // Mark sync as completed
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 100,
        status: 'COMPLETED',
        message: `${provider} data sync completed`,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Background sync error:', error);
    
    // Update sync status to failed
    if (requestData && requestData.sync_id) {
      await supabaseAdmin
        .from('sync_status')
        .update({
          status: 'FAILED',
          message: `Sync failed: ${(error as Error).message}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestData.sync_id);
    }
    
    return NextResponse.json(
      { error: 'Failed to sync data' },
      { status: 500 }
    );
  }
} 