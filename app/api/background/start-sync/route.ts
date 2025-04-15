import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';
import { backgroundProcess } from '../sync/route';

export const maxDuration = 300; // Maximum duration for Vercel function in seconds (5 minutes)

// Route to start the background sync process
export async function POST(request: Request) {
  try {
    const { organization_id, sync_id, access_token, refresh_token } = await request.json();
    
    console.log(`Starting background sync process for org ${organization_id} and sync ${sync_id}`);
    
    // Start the background process
    backgroundProcess(organization_id, sync_id, access_token, refresh_token);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Background sync process started'
    });
  } catch (error: any) {
    console.error('Error starting background sync process:', error);
    return NextResponse.json(
      { 
        error: 'Failed to start background sync process',
        details: error.message
      },
      { status: 500 }
    );
  }
} 