import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ids = searchParams.get('ids')?.split(',') || [];
    const orgId = searchParams.get('orgId');

    if (!ids.length || !orgId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Fetch only the categories for the specified app IDs
    const { data, error } = await supabaseAdmin
      .from('applications')
      .select('id, category')
      .in('id', ids)
      .eq('organization_id', orgId);

    if (error) {
      console.error('Error fetching categories:', error);
      return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
    }

    // Transform the data into a map of id -> category
    const categoryMap = data.reduce((acc: Record<string, string>, app) => {
      acc[app.id] = app.category;
      return acc;
    }, {});

    return NextResponse.json(categoryMap);
  } catch (error) {
    console.error('Error in categories endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 