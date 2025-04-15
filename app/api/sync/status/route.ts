import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Use Edge runtime for better performance
export const runtime = 'experimental-edge';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const syncId = searchParams.get('syncId');

    if (!orgId && !syncId) {
      return NextResponse.json(
        { error: 'Either orgId or syncId is required' },
        { status: 400 }
      );
    }

    let query = supabaseAdmin
      .from('sync_status')
      .select('id, organization_id, user_email, status, progress, message, created_at, updated_at');
    
    let singleResult = false;
    
    if (syncId) {
      // If syncId is provided, get that specific sync
      query = query.eq('id', syncId);
      singleResult = true;
    } else {
      // Otherwise get the most recent sync for the organization
      query = query
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1);
      singleResult = true;
    }

    try {
      if (singleResult) {
        const { data, error } = await query.single();
        
        if (error) {
          // If no record found, don't treat it as an error
          if (error.code === 'PGRST116') {
            return NextResponse.json(null);
          }
          throw error;
        }
        
        // Special handling for sync that's been stuck at 30% for more than 2 minutes
        if (data.status === 'IN_PROGRESS' && data.progress === 30) {
          const updatedAt = new Date(data.updated_at);
          const now = new Date();
          const diffMinutes = (now.getTime() - updatedAt.getTime()) / (1000 * 60);
          
          // If it's been more than 2 minutes at 30%, consider it partial
          if (diffMinutes > 2) {
            return NextResponse.json({
              ...data,
              status: 'PARTIAL',
              message: 'Partial data loaded due to timeout. You can still view basic organization information.'
            });
          }
        }
        
        return NextResponse.json(data);
      } else {
        const { data, error } = await query;
        
        if (error) throw error;
        
        return NextResponse.json(data && data.length > 0 ? data[0] : null);
      }
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