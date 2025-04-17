import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    console.log('Starting Microsoft sync process...');

    // Get all sync status records with status IN_PROGRESS
    const { data: syncRecords, error: syncError } = await supabase
      .from('sync_status')
      .select('*')
      .eq('status', 'IN_PROGRESS')
      .is('organization_id', null) // Microsoft syncs typically start with null org ID
      .order('created_at', { ascending: false })
      .limit(1);

    if (syncError) {
      console.error('Error fetching sync records:', syncError);
      return NextResponse.json({ error: 'Failed to fetch sync records' }, { status: 500 });
    }

    if (!syncRecords || syncRecords.length === 0) {
      console.log('No pending Microsoft sync records found');
      return NextResponse.json({ message: 'No pending sync records' });
    }

    const syncRecord = syncRecords[0];
    console.log('Processing sync record:', {
      id: syncRecord.id,
      user_email: syncRecord.user_email,
    });

    // Update sync status to indicate progress
    await supabase
      .from('sync_status')
      .update({
        progress: 50,
        message: 'Processing Microsoft data...',
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    // For now, we'll just mark the sync as completed
    // In a real implementation, you would make Graph API calls to fetch application data
    
    // Create or get organization based on user email domain
    const emailDomain = syncRecord.user_email.split('@')[1];
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .upsert({
        name: emailDomain,
        domain: emailDomain,
        updated_at: new Date().toISOString()
      }, { onConflict: 'domain' })
      .select('id')
      .single();

    if (orgError) {
      console.error('Error upserting organization:', orgError);
      return NextResponse.json({ error: 'Failed to upsert organization' }, { status: 500 });
    }

    // Update sync record with organization ID
    await supabase
      .from('sync_status')
      .update({
        organization_id: org.id,
        progress: 100,
        status: 'COMPLETED',
        message: 'Microsoft Entra ID sync completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    console.log('Microsoft sync completed successfully');
    return NextResponse.json({ 
      success: true, 
      message: 'Microsoft sync completed',
      sync_id: syncRecord.id,
      organization_id: org.id
    });
  } catch (error) {
    console.error('Microsoft sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
} 