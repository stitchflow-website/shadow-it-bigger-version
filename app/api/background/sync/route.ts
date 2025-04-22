import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: NextRequest) {
  try {
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token,
      provider 
    } = await request.json();

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
          '/api/background/sync/users',
          '/api/background/sync/tokens',
          '/api/background/sync/relations',
          '/api/background/sync/categorize'
        ]
      : [
          '/api/background/sync/microsoft'
        ];

    // Call each endpoint in sequence
    for (const endpoint of endpoints) {
      try {
        console.log(`Calling ${endpoint}...`);
        const response = await fetch(`${request.nextUrl.origin}${endpoint}`, {
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

        if (!response.ok) {
          const error = await response.text();
          console.error(`Error from ${endpoint}:`, error);
          throw new Error(`${endpoint} failed: ${error}`);
        }

        console.log(`Successfully completed ${endpoint}`);
      } catch (error) {
        console.error(`Error processing ${endpoint}:`, error);
        throw error;
      }
    }

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
    const { sync_id } = await request.json();
    if (sync_id) {
      await supabaseAdmin
        .from('sync_status')
        .update({
          status: 'FAILED',
          message: `Sync failed: ${(error as Error).message}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', sync_id);
    }
    
    return NextResponse.json(
      { error: 'Failed to sync data' },
      { status: 500 }
    );
  }
} 