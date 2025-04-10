import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  return await supabaseAdmin
    .from('sync_status')
    .update({
      status,
      progress,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', syncId);
}

// Helper function to safely format date
function formatDate(dateValue: any): string {
  if (!dateValue) return new Date().toISOString();
  
  try {
    if (typeof dateValue === 'number') return new Date(dateValue).toISOString();
    if (typeof dateValue === 'string') {
      if (dateValue.includes('T') && dateValue.includes('Z')) return dateValue;
      if (!isNaN(Number(dateValue))) return new Date(Number(dateValue)).toISOString();
      return new Date(Date.parse(dateValue)).toISOString();
    }
    return new Date().toISOString();
  } catch (error) {
    return new Date().toISOString();
  }
}

// Helper function to process applications in batches
async function processBatchOfApplications(
  applications: [string, any[]][],
  organization_id: string,
  userMap: Map<string, string>,
  sync_id: string,
  startProgress: number,
  endProgress: number
) {
  const batchSize = 10; // Process 10 apps at a time
  const progressPerBatch = (endProgress - startProgress) / Math.ceil(applications.length / batchSize);
  
  for (let i = 0; i < applications.length; i += batchSize) {
    const batch = applications.slice(i, i + batchSize);
    const currentProgress = startProgress + (Math.floor(i / batchSize) * progressPerBatch);
    
    await updateSyncStatus(
      sync_id,
      Math.round(currentProgress),
      `Processing applications batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(applications.length / batchSize)}`
    );

    await Promise.all(batch.map(async ([appName, tokens]) => {
      try {
        // Calculate application data
        const allScopes = new Set<string>();
        tokens.forEach((token: any) => {
          if (token.scopes && Array.isArray(token.scopes)) {
            token.scopes.forEach((scope: string) => allScopes.add(scope));
          }
        });

        const lastUsedTime = tokens.reduce((latest: Date, token: any) => {
          const tokenTime = token.lastTimeUsed ? new Date(token.lastTimeUsed) : new Date(0);
          return tokenTime > latest ? tokenTime : latest;
        }, new Date(0));

        const highestRiskLevel = tokens.reduce((highest: string, token: any) => {
          const tokenRisk = determineRiskLevel(token.scopes);
          return tokenRisk === 'HIGH' ? 'HIGH' : (tokenRisk === 'MEDIUM' && highest !== 'HIGH' ? 'MEDIUM' : highest);
        }, 'LOW');

        // Upsert application
        const { data: appData, error: appError } = await supabaseAdmin
          .from('applications')
          .upsert({
            name: appName,
            google_app_id: tokens.map(t => t.clientId).join(','),
            category: 'Unknown',
            risk_level: highestRiskLevel,
            management_status: 'PENDING',
            total_permissions: allScopes.size,
            all_scopes: Array.from(allScopes),
            last_login: formatDate(lastUsedTime),
            organization_id: organization_id,
          })
          .select('id')
          .single();

        if (appError) throw appError;

        // Prepare user-application relationships
        const userAppRelations = tokens
          .map(token => {
            const userId = userMap.get(token.userKey);
            if (!userId) return null;

            let userScopes = new Set(token.scopes || []);
            
            // Collect scopes from all possible locations
            if (token.scopeData?.length) {
              token.scopeData.forEach((sd: any) => {
                if (sd.scope) userScopes.add(sd.scope);
                if (sd.value) userScopes.add(sd.value);
              });
            }
            
            if (token.permissions?.length) {
              token.permissions.forEach((p: any) => {
                const scope = p.scope || p.value || p;
                if (scope) userScopes.add(scope);
              });
            }
            
            if (token.rawScopes) {
              token.rawScopes.split(' ').forEach((s: string) => userScopes.add(s));
            }

            return {
              user_id: userId,
              application_id: appData.id,
              scopes: Array.from(userScopes),
              last_login: formatDate(token.lastTimeUsed)
            };
          })
          .filter(Boolean);

        // Batch upsert user-application relationships
        if (userAppRelations.length > 0) {
          const { error: relError } = await supabaseAdmin
            .from('user_applications')
            .upsert(userAppRelations, {
              onConflict: 'user_id,application_id',
              ignoreDuplicates: false
            });

          if (relError) throw relError;
        }
      } catch (error) {
        console.error(`Error processing application ${appName}:`, error);
      }
    }));
  }
}

export async function POST(request: Request) {
  try {
    const { organization_id, sync_id, access_token, refresh_token } = await request.json();
    
    if (!organization_id || !sync_id || !access_token) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    
    const responsePromise = Promise.resolve(
      NextResponse.json({ message: 'Sync started in background' })
    );
    
    backgroundProcess(organization_id, sync_id, access_token, refresh_token).catch(error => {
      console.error('Background process failed:', error);
    });
    
    return responsePromise;
  } catch (error: any) {
    console.error('Error in background sync API:', error);
    return NextResponse.json(
      { error: 'Failed to start background sync' },
      { status: 500 }
    );
  }
}

async function backgroundProcess(organization_id: string, sync_id: string, access_token: string, refresh_token: string) {
  try {
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ access_token, refresh_token });

    // Step 1: Fetch users (20% progress)
    await updateSyncStatus(sync_id, 10, 'Fetching users from Google Workspace');
    const users = await googleService.getUsersList();
    
    // Process users in parallel with applications
    const processUsersPromise = (async () => {
      const usersToUpsert = users.map((user: { 
        id: string;
        primaryEmail: string;
        name?: { fullName: string };
        isAdmin: boolean;
        orgUnitPath?: string;
        lastLoginTime?: string;
      }) => ({
        google_user_id: user.id,
        email: user.primaryEmail,
        name: user.name?.fullName || user.primaryEmail,
        role: user.isAdmin ? 'Admin' : 'User',
        department: user.orgUnitPath ? user.orgUnitPath.split('/').filter(Boolean).pop() || null : null,
        organization_id: organization_id,
        last_login: user.lastLoginTime ? formatDate(user.lastLoginTime) : null,
      }));

      await supabaseAdmin.from('users').upsert(usersToUpsert);
    })();

    // Step 2: Start fetching OAuth tokens while users are being processed
    await updateSyncStatus(sync_id, 30, 'Fetching application data');
    const applicationTokens = await googleService.getOAuthTokens();

    // Wait for users to be processed
    await processUsersPromise;
    
    // Get user mapping
    const { data: createdUsers } = await supabaseAdmin
      .from('users')
      .select('id, google_user_id')
      .eq('organization_id', organization_id);
    
    const userMap = new Map(createdUsers?.map(user => [user.google_user_id, user.id]) || []);

    // Group applications by name
    const appNameMap = new Map<string, any[]>();
    for (const token of applicationTokens) {
      const appName = token.displayText || 'Unknown App';
      if (!appNameMap.has(appName)) appNameMap.set(appName, []);
      appNameMap.get(appName)!.push(token);
    }

    // Process applications in batches
    await processBatchOfApplications(
      Array.from(appNameMap.entries()),
      organization_id,
      userMap,
      sync_id,
      40,
      90
    );

    // Finalize
    await updateSyncStatus(
      sync_id, 
      100, 
      `Sync completed - Processed ${appNameMap.size} applications and ${users.length} users`, 
      'COMPLETED'
    );

    console.log('Background sync completed successfully');
  } catch (error: any) {
    console.error('Error in background sync process:', error);
    await updateSyncStatus(
      sync_id,
      -1,
      `Sync failed: ${error.message}`,
      'FAILED'
    );
  }
} 