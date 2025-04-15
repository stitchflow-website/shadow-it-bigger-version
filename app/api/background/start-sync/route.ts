import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';
import { backgroundProcess } from '../sync/route';

export const runtime = 'edge';

export const config = { 
  maxDuration: 300 // 5 minutes max duration
};

// Route to start the background sync process
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organization_id, sync_id, access_token, refresh_token } = body;
    
    console.log(`Starting background sync process for org ${organization_id} and sync ${sync_id}`);
    
    // Log what we're about to do
    console.log(`Background sync payload: orgID length: ${organization_id?.length}, syncID length: ${sync_id?.length}, access token present: ${!!access_token}, refresh token present: ${!!refresh_token}`);
    
    // Check if we have required parameters
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      console.error('Missing required parameters for background sync');
      return NextResponse.json({ 
        error: 'Missing required parameters',
        missing: {
          organization_id: !organization_id,
          sync_id: !sync_id,
          access_token: !access_token,
          refresh_token: !refresh_token
        }
      }, { status: 400 });
    }
    
    console.log('Starting background process with valid parameters...');
    
    // Directly call the background process (this shouldn't return until complete)
    try {
      // Run the background process
      await backgroundProcess(organization_id, sync_id, access_token, refresh_token);
      console.log(`Background process completed successfully for sync ${sync_id}`);
    } catch (syncError) {
      console.error(`Error in background process: ${syncError}`);
      throw syncError;
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Background sync process completed'
    });
  } catch (error: any) {
    console.error('Error starting background sync process:', error);
    return NextResponse.json(
      { 
        error: 'Failed to start background sync process',
        details: error.message,
        stack: error.stack
      },
      { status: 500 }
    );
  }
} 