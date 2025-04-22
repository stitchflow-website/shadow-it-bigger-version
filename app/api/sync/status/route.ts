import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const syncId = searchParams.get('syncId');

    if (!syncId) {
      return NextResponse.json({ error: 'Missing syncId parameter' }, { status: 400 });
    }

    // Get sync status
    const { data: syncStatus, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('id', syncId)
      .single();

    if (syncError) {
      console.error('Error fetching sync status:', syncError);
      return NextResponse.json({ error: 'Failed to fetch sync status' }, { status: 500 });
    }

    if (!syncStatus) {
      return NextResponse.json({ error: 'Sync record not found' }, { status: 404 });
    }

    return NextResponse.json(syncStatus);
  } catch (error) {
    console.error('Error in sync status check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 