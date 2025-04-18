import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .storage
      .from('contract-files')
      .list('', {
        limit: 1000, // Adjust this limit based on your needs
        offset: 0,
      });

    if (error) {
      console.error('Error fetching storage files:', error);
      return NextResponse.json(
        { error: 'Failed to fetch storage files', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      count: data.length,
      files: data
    });

  } catch (error: any) {
    console.error('Unexpected error in storage count API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
} 