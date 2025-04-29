import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const orgId = request.nextUrl.searchParams.get('orgId');
    
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }
    
    // Fetch all in-progress and recently completed categorization statuses for this organization
    const { data: statuses, error } = await supabaseAdmin
      .from('categorization_status')
      .select('*')
      .eq('organization_id', orgId)
      .or('status.eq.IN_PROGRESS,status.eq.PENDING,status.eq.COMPLETED')
      .order('updated_at', { ascending: false })
      .limit(100);
    
    if (error) {
      console.error('Error fetching categorization statuses:', error);
      return NextResponse.json(
        { error: 'Failed to fetch categorization statuses' }, 
        { status: 500 }
      );
    }
    
    // Return the list of categorization statuses
    return NextResponse.json(statuses || []);
  } catch (error) {
    console.error('Error in categorization status API:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
} 