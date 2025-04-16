import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const syncId = searchParams.get('syncId');

    // If neither is provided, try to get orgId from cookies
    if (!orgId && !syncId) {
      const cookieStore = await cookies();
      const cookieOrgId = cookieStore.get('orgId')?.value;
      
      if (cookieOrgId) {
        // Return the most recent sync for this org from cookies
        const { data, error } = await supabaseAdmin
          .from('sync_status')
          .select('id, organization_id, user_email, status, progress, message, created_at, updated_at')
          .eq('organization_id', cookieOrgId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
          
        if (error) {
          if (error.code === 'PGRST116') {
            // No records found, not an error
            return NextResponse.json(null);
          }
          throw error;
        }
        
        return NextResponse.json(data);
      } else {
        return NextResponse.json(
          { error: 'Either orgId or syncId is required' },
          { status: 400 }
        );
      }
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
        
        // If status is "IN_PROGRESS" but hasn't been updated in 5 minutes, mark as failed
        if (data && data.status === 'IN_PROGRESS') {
          const lastUpdated = new Date(data.updated_at).getTime();
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          
          if (lastUpdated < fiveMinutesAgo) {
            // Update the record to mark it as failed
            await supabaseAdmin
              .from('sync_status')
              .update({
                status: 'FAILED',
                progress: -1,
                message: 'Sync timed out - please try again',
                updated_at: new Date().toISOString(),
              })
              .eq('id', data.id);
              
            // Return the updated status
            return NextResponse.json({
              ...data,
              status: 'FAILED',
              progress: -1,
              message: 'Sync timed out - please try again'
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