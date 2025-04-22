import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { updateCategorizationStatus } from '@/app/api/background/sync/categorize/route';

interface Application {
  id: string;
  category?: string;
  organization_id: string;
  name: string;
  microsoft_app_id: string;
  risk_level?: string;
  management_status?: string;
  total_permissions: number;
  all_scopes: string[];
  user_count: number;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  let syncRecord: any = null;
  
  try {
    console.log('Starting Microsoft sync process...');

    // Get all sync status records with status IN_PROGRESS
    const { data: syncRecords, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('status', 'IN_PROGRESS')
      .order('created_at', { ascending: false })
      .limit(1);

    console.log('Sync records query result:', { data: syncRecords, error: syncError });

    if (syncError) {
      console.error('Error fetching sync records:', syncError);
      return NextResponse.json({ error: 'Failed to fetch sync records' }, { status: 500 });
    }

    if (!syncRecords || syncRecords.length === 0) {
      console.log('No pending Microsoft sync records found');
      return NextResponse.json({ message: 'No pending sync records' });
    }

    syncRecord = syncRecords[0];
    console.log('Found sync record to process:', {
      id: syncRecord.id,
      user_email: syncRecord.user_email,
      organization_id: syncRecord.organization_id,
      status: syncRecord.status,
      progress: syncRecord.progress
    });

    // Initialize Microsoft service
    console.log('Initializing Microsoft service...');
    const microsoftService = new MicrosoftWorkspaceService({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenant_id: process.env.MICROSOFT_TENANT_ID!
    });

    // Set credentials from sync record
    console.log('Setting Microsoft service credentials...');
    await microsoftService.setCredentials({
      access_token: syncRecord.access_token,
      refresh_token: syncRecord.refresh_token
    });

    // Update sync status to indicate progress
    console.log('Updating sync status to 10%...');
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 10,
        message: 'Connected to Microsoft Entra ID...',
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    // Fetch users from Microsoft
    console.log('Fetching users from Microsoft...');
    const users = await microsoftService.getUsersList();
    console.log(`Fetched ${users.length} users from Microsoft`);

    // Update sync status to indicate user fetch complete
    console.log('Updating sync status to 30%...');
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 30,
        message: `Found ${users.length} users in your organization...`,
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    // Update users in database
    console.log('Updating users in database...');
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert(
        users.map((user: any) => ({
          organization_id: syncRecord.organization_id,
          microsoft_user_id: user.id,
          email: user.mail || user.userPrincipalName,
          name: user.displayName,
          role: user.jobTitle || 'User',
          department: user.department,
          updated_at: new Date().toISOString()
        }))
      );

    if (usersError) {
      console.error('Error upserting users:', usersError);
      throw usersError;
    }

    // Update sync status for token fetch
    console.log('Updating sync status to 50%...');
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 50,
        message: 'Discovering connected applications...',
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    // Fetch OAuth tokens
    console.log('Fetching OAuth tokens...');
    const tokens = await microsoftService.getOAuthTokens();
    console.log(`Fetched ${tokens.length} application tokens`);

    // Update sync status for processing
    console.log('Updating sync status to 70%...');
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 70,
        message: `Processing ${tokens.length} connected applications...`,
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    // Process applications and tokens
    console.log('Processing applications and tokens...');
    const processedApps = new Map(); // Track processed apps to avoid duplicates
    const appUsers = new Map();

    // First pass: Group tokens by app and collect all users
    for (const token of tokens) {
      if (!token.clientId || !token.userEmail) {
        console.log('Skipping invalid token:', token);
        continue;
      }
      const appId = token.clientId;
      if (!appUsers.has(appId)) {
        appUsers.set(appId, new Set());
      }
      appUsers.get(appId).add(token.userEmail);
    }

    // Second pass: Process apps and create relationships
    for (const token of tokens) {
      try {
        if (!token.clientId || !token.userEmail) {
          console.log('Skipping invalid token:', token);
          continue;
        }
        
        const appId = token.clientId;
        let app;

        // Create or get application
        if (!processedApps.has(appId)) {
          // Get existing app first
          const { data: existingApp } = await supabaseAdmin
            .from('applications')
            .select('*')
            .eq('microsoft_app_id', appId)
            .eq('organization_id', syncRecord.organization_id)
            .single() as { data: Application | null };

          // Get all unique scopes for this app across all users
          const allAppScopes = tokens
            .filter(t => t.clientId === appId)
            .flatMap(t => t.scopes || [])
            .filter((scope, index, self) => self.indexOf(scope) === index);

          const { data: newApp, error: appError } = await supabaseAdmin
            .from('applications')
            .upsert({
              id: existingApp?.id, // Include if exists
              organization_id: syncRecord.organization_id,
              name: token.displayText || 'Unknown App',
              microsoft_app_id: appId,
              category: existingApp ? undefined : 'uncategorized', // Don't override category if app exists
              risk_level: existingApp ? undefined : 'LOW', // Don't override risk level if app exists
              management_status: existingApp ? undefined : 'NEEDS_REVIEW',
              total_permissions: allAppScopes.length,
              all_scopes: allAppScopes,
              user_count: appUsers.get(appId).size,
              updated_at: new Date().toISOString()
            } as Application)
            .select()
            .single();

          if (appError) {
            console.error(`Error upserting application ${appId}:`, appError);
            continue;
          }

          // If this is a new app or has no category, trigger categorization
          if (!existingApp?.category || existingApp.category === 'uncategorized' || existingApp.category === 'Unknown' || existingApp.category === 'Others') {
            try {
              // Create a categorization status record
              const { data: statusRecord, error: statusError } = await supabaseAdmin
                .from('categorization_status')
                .insert({
                  organization_id: syncRecord.organization_id,
                  status: 'PENDING',
                  progress: 0,
                  message: 'Initializing categorization process',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .select()
                .single();

              if (!statusError && statusRecord) {
                // Start categorization in the background
                const categorizeModule = await import('../categorize/route');
                (categorizeModule as any).categorizeApplications(syncRecord.organization_id, statusRecord.id).catch((error: Error) => {
                  console.error('Background categorization failed:', error);
                  updateCategorizationStatus(
                    statusRecord.id,
                    0,
                    `Categorization failed: ${error.message}`,
                    'FAILED'
                  ).catch(err => {
                    console.error('Error updating categorization status:', err);
                  });
                });
              }
            } catch (categorizationError) {
              console.error('Error initiating categorization:', categorizationError);
            }
          }

          app = newApp;
          processedApps.set(appId, app);
          console.log(`Processed app ${token.displayText} with ${appUsers.get(appId).size} users and ${allAppScopes.length} scopes`);
        } else {
          app = processedApps.get(appId);
        }

        // Create user-application relationship
        await createUserAppRelationship(app.id, token, syncRecord.organization_id);
      } catch (error) {
        console.error(`Error processing token:`, error);
        continue;
      }
    }

    // Update sync status for categorization
    console.log('Updating sync status for categorization...');
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 85,
        message: 'Categorizing applications...',
        updated_at: new Date().toISOString()
      })
      .eq('id', syncRecord.id);

    // Trigger categorization
    console.log('Triggering application categorization...');
    try {
      const categorizationResponse = await fetch(`${request.nextUrl.origin}/api/background/sync/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id: syncRecord.organization_id,
          sync_id: syncRecord.id
        }),
      });

      if (!categorizationResponse.ok) {
        console.error('Failed to trigger categorization:', await categorizationResponse.text());
      } else {
        console.log('Successfully triggered categorization');
      }
    } catch (error) {
      console.error('Error triggering categorization:', error);
    }

    // Mark sync as completed
    console.log('Marking sync as completed...');
    await supabaseAdmin
      .from('sync_status')
      .update({
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
      organization_id: syncRecord.organization_id
    });
  } catch (error) {
    console.error('Microsoft sync error:', error);
    
    // Update sync status to failed if we have a sync record
    if (syncRecord?.id) {
      await supabaseAdmin
        .from('sync_status')
        .update({
          status: 'FAILED',
          message: 'Microsoft sync failed: ' + (error as Error).message,
          updated_at: new Date().toISOString()
        })
        .eq('id', syncRecord.id);
    }
      
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

// Helper function to create user-application relationship
async function createUserAppRelationship(appId: string, token: any, organizationId: string) {
  try {
    // Get user by email, trying both mail and userPrincipalName
    let { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('organization_id', organizationId)
      .or(`email.eq.${token.userEmail},microsoft_user_id.eq.${token.userKey}`)
      .single();

    if (userError) {
      console.error('Error finding user:', userError);
      return;
    }

    if (!userData) {
      console.error(`No user found for email: ${token.userEmail} or microsoft_user_id: ${token.userKey}`);
      // Try to create the user if they don't exist
      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          organization_id: organizationId,
          microsoft_user_id: token.userKey,
          email: token.userEmail,
          name: token.userEmail.split('@')[0], // Use email prefix as name
          role: 'User',
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating missing user:', createError);
        return;
      }
      
      if (!newUser) {
        console.error('Failed to create user record');
        return;
      }

      userData = newUser;
    }

    // Create user-application relationship
    const { error: relationshipError } = await supabaseAdmin
      .from('user_applications')
      .upsert({
        user_id: userData.id,
        application_id: appId,
        scopes: token.scopes || [],
        updated_at: new Date().toISOString()
      });

    if (relationshipError) {
      console.error('Error upserting user-application relationship:', relationshipError);
    } else {
      console.log(`Successfully linked app ${token.displayText} to user ${token.userEmail}`);
    }
  } catch (error) {
    console.error('Error in createUserAppRelationship:', error);
  }
} 