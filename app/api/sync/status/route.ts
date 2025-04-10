import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Cache for sync status results to reduce database queries
const syncStatusCache = new Map<string, {
  data: any;
  timestamp: number;
}>();

// Cache TTL in milliseconds (500ms)
const CACHE_TTL = 500;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const syncId = searchParams.get('syncId');

    if (!orgId && !syncId) {
      console.warn('Missing required parameters:', { orgId, syncId });
      return NextResponse.json(
        { error: 'Either orgId or syncId is required' },
        { status: 400 }
      );
    }

    // Generate cache key
    const cacheKey = syncId || `org_${orgId}`;
    
    // Check cache first to reduce database load
    const now = Date.now();
    const cachedResult = syncStatusCache.get(cacheKey);
    
    if (cachedResult && (now - cachedResult.timestamp) < CACHE_TTL) {
      return NextResponse.json(cachedResult.data);
    }
    
    // If no cache or expired, query the database
    let query = supabaseAdmin
      .from('sync_status')
      .select('id, organization_id, user_email, status, progress, message, created_at, updated_at');
    
    if (syncId) {
      // If syncId is provided, get that specific sync
      query = query.eq('id', syncId);
    } else {
      // Otherwise get the most recent sync for the organization
      query = query
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1);
    }

    try {
      const { data, error } = await query;
      
      if (error) {
        // If no record found, don't treat it as an error
        if (error.code === 'PGRST116') {
          console.log('No sync status found for:', { orgId, syncId });
          return NextResponse.json(null);
        }
        console.error('Database error:', error);
        throw error;
      }

      const syncData = data && data.length > 0 ? data[0] : null;
      
      // Only check for stale sync if we have data and sync is in progress
      if (syncData && syncData.status === 'IN_PROGRESS') {
        const lastUpdateTime = new Date(syncData.updated_at).getTime();
        const currentTime = new Date().getTime();
        const timeDiffMinutes = (currentTime - lastUpdateTime) / (1000 * 60);

        // If sync is in progress but hasn't updated in 5 minutes, mark as failed
        if (timeDiffMinutes > 5) {
          console.warn('Detected stale sync:', { syncId: syncData.id, timeDiffMinutes });
          
          const { error: updateError } = await supabaseAdmin
            .from('sync_status')
            .update({
              status: 'FAILED',
              message: 'Sync timed out after 5 minutes of inactivity',
              updated_at: new Date().toISOString()
            })
            .eq('id', syncData.id);

          if (updateError) {
            console.error('Error updating stale sync:', updateError);
          } else {
            syncData.status = 'FAILED';
            syncData.message = 'Sync timed out after 5 minutes of inactivity';
          }
        }
      }
      
      // Store result in cache
      syncStatusCache.set(cacheKey, {
        data: syncData,
        timestamp: now
      });
      
      return NextResponse.json(syncData);
    } catch (dbError: any) {
      console.error('Database error in sync status API:', dbError);
      
      // If it's a conflict error, return a failed status object
      if (dbError.message && dbError.message.includes('CONFLICT')) {
        return NextResponse.json({
          id: syncId,
          status: 'FAILED',
          progress: -1,
          message: 'Sync failed: Database conflict error. Please try again.'
        });
      }
      
      // For other errors, return a generic error
      return NextResponse.json(
        { error: 'Failed to fetch sync status', details: dbError.message },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error in sync status API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
} 