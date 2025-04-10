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
    // If it's a timestamp in milliseconds (number)
    if (typeof dateValue === 'number') {
      return new Date(dateValue).toISOString();
    }
    
    // If it's a string that looks like an ISO date
    if (typeof dateValue === 'string') {
      // Google's lastLoginTime is already in ISO format
      if (dateValue.includes('T') && dateValue.includes('Z')) {
        return dateValue;
      }
      
      // If it's a string with a timestamp in milliseconds
      if (!isNaN(Number(dateValue))) {
        return new Date(Number(dateValue)).toISOString();
      }
      
      // Otherwise try to parse it
      return new Date(Date.parse(dateValue)).toISOString();
    }

    // Default to current time if invalid
    return new Date().toISOString();
  } catch (error) {
    console.warn('Invalid date value:', dateValue);
    return new Date().toISOString();
  }
}

export async function POST(request: Request) {
  try {
    // This ensures the API responds quickly while processing continues
    const { organization_id, sync_id, access_token, refresh_token } = await request.json();
    
    // Send immediate response
    const responsePromise = Promise.resolve(
      NextResponse.json({ message: 'Sync started in background' })
    );
    
    // Process in background
    backgroundProcess(organization_id, sync_id, access_token, refresh_token);
    
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
    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ 
      access_token,
      refresh_token
    });

    // Step 1: Fetch users list (20% progress)
    await updateSyncStatus(sync_id, 10, 'Fetching users from Google Workspace');
    const users = await googleService.getUsersList();
    console.log(`Fetched ${users.length} users`);
    
    await updateSyncStatus(sync_id, 20, `Processing ${users.length} users`);
    
    // Create a batch of all users to upsert
    const usersToUpsert = users.map((user: any) => {
      // Determine department from orgUnitPath if available
      const department = user.orgUnitPath ? 
        user.orgUnitPath.split('/').filter(Boolean).pop() || null : 
        null;
        
      // Determine role based on isAdmin flag
      const role = user.isAdmin ? 'Admin' : 'User';
      
      // Format the last login time if available
      const lastLogin = user.lastLoginTime ? formatDate(user.lastLoginTime) : null;
      
      return {
        google_user_id: user.id,
        email: user.primaryEmail,
        name: user.name.fullName,
        role: role,
        department: department,
        organization_id: organization_id,
        last_login: lastLogin,
      };
    });
    
    // Batch upsert all users
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert(usersToUpsert);
    
    if (usersError) throw usersError;
    
    // Get all users for this organization to create a mapping
    const { data: createdUsers } = await supabaseAdmin
      .from('users')
      .select('id, google_user_id')
      .eq('organization_id', organization_id);
    
    // Create a mapping for quick lookup
    const userMap = new Map();
    createdUsers?.forEach(user => {
      userMap.set(user.google_user_id, user.id);
    });

    // Step 2: Fetch OAuth tokens (40% progress)
    await updateSyncStatus(sync_id, 30, 'Fetching application data from Google Workspace');
    const applicationTokens = await googleService.getOAuthTokens();
    console.log(`Fetched ${applicationTokens.length} application tokens`);
    
    await updateSyncStatus(sync_id, 40, `Processing ${applicationTokens.length} application connections`);
    
    // Group applications by display name
    const appNameMap = new Map<string, any[]>();
    
    // First pass: Group tokens by application name
    for (const token of applicationTokens) {
      const appName = token.displayText || 'Unknown App';
      
      if (!appNameMap.has(appName)) {
        appNameMap.set(appName, []);
      }
      
      appNameMap.get(appName)!.push(token);
    }
    
    // Process each group of applications (40% to 80% progress)
    let appCount = 0;
    const totalApps = appNameMap.size;
    
    // Batch for collecting user-application relationships
    const userAppRelations: any[] = [];
    
    for (const [appName, tokens] of appNameMap.entries()) {
      appCount++;
      const progressPercent = 40 + Math.floor((appCount / totalApps) * 40);
      
      if (appCount % 5 === 0 || appCount === totalApps) {
        await updateSyncStatus(
          sync_id, 
          progressPercent, 
          `Processing applications: ${appCount}/${totalApps}`
        );
      }
      
      // Find or create application record using the app name
      const { data: existingApp } = await supabaseAdmin
        .from('applications')
        .select('id, total_permissions')
        .eq('name', appName)
        .eq('organization_id', organization_id)
        .single();
      
      // Calculate total unique permissions across all instances
      const allScopes = new Set<string>();
      tokens.forEach((token: any) => {
        if (token.scopes && Array.isArray(token.scopes)) {
          token.scopes.forEach((scope: string) => allScopes.add(scope));
        }
      });
      
      // Find the most recent last used time
      const lastUsedTime = tokens.reduce((latest: Date, token: any) => {
        const tokenTime = token.lastTimeUsed ? new Date(token.lastTimeUsed) : new Date(0);
        return tokenTime > latest ? tokenTime : latest;
      }, new Date(0));
      
      // Determine highest risk level across all instances
      const highestRiskLevel = tokens.reduce((highest: string, token: any) => {
        const tokenRisk = determineRiskLevel(token.scopes);
        if (tokenRisk === 'HIGH') return 'HIGH';
        if (tokenRisk === 'MEDIUM' && highest !== 'HIGH') return 'MEDIUM';
        return highest;
      }, 'LOW');
      
      // Create or update the application
      const { data: appData, error: appError } = await supabaseAdmin
        .from('applications')
        .upsert({
          id: existingApp?.id, // Include ID if it exists
          google_app_id: tokens.map(t => t.clientId).join(','), // Store all client IDs
          name: appName,
          category: 'Unknown',
          risk_level: highestRiskLevel,
          management_status: existingApp?.id ? undefined : 'PENDING', // Only set for new apps
          total_permissions: allScopes.size,
          all_scopes: Array.from(allScopes), // Store all unique scopes
          last_login: formatDate(lastUsedTime),
          organization_id: organization_id,
        })
        .select('id')
        .single();
      
      if (appError) throw appError;
      
      // Process each user separately for this application to avoid batch conflicts
      for (const token of tokens) {
        const userId = userMap.get(token.userKey);
        if (!userId) {
          console.warn('No matching user found for token:', token.userKey);
          continue;
        }
        
        try {
          // Extract this specific user's scopes from their token
          // We need to ensure that all scopes are correctly collected from the admin API
          // The token.scopes array might be incomplete due to how the Google Admin API returns data
          
          // Make sure we have a valid scopes array
          let userScopes = token.scopes || [];
          
          // Check if we should extract from other token fields
          if (token.scopeData && Array.isArray(token.scopeData)) {
            // Some admin API responses include detailed scope data in a separate field
            const scopesFromData = token.scopeData.map((sd: any) => sd.scope || sd.value || '').filter(Boolean);
            if (scopesFromData.length > 0) {
              userScopes = [...new Set([...userScopes, ...scopesFromData])];
            }
          }
          
          // Some scopes might come from a raw permission field in some API responses
          if (token.permissions && Array.isArray(token.permissions)) {
            const scopesFromPermissions = token.permissions.map((p: any) => p.scope || p.value || p).filter(Boolean);
            if (scopesFromPermissions.length > 0) {
              // Merge with existing scopes if any
              userScopes = [...new Set([...userScopes, ...scopesFromPermissions])];
            }
          }
          
          // If we still don't have scopes and have raw scope data as string
          if (userScopes.length === 0 && token.rawScopes) {
            userScopes = token.rawScopes.split(' ');
          }
          
          // If we have any scope-like fields, try to extract them
          const potentialScopeFields = ['scope_string', 'oauth_scopes', 'accessScopes'];
          for (const field of potentialScopeFields) {
            if (token[field] && typeof token[field] === 'string' && token[field].includes('://')) {
              const extractedScopes = token[field].split(/\s+/);
              userScopes = [...new Set([...userScopes, ...extractedScopes])];
            }
          }
          
          // Log what we found for debugging
          console.log(`User ${token.userEmail || token.userKey} with app ${appName} has ${userScopes.length} scopes`);
          
          // First check if the relationship already exists
          const { data: existingRel } = await supabaseAdmin
            .from('user_applications')
            .select('id, scopes')
            .eq('user_id', userId)
            .eq('application_id', appData.id)
            .maybeSingle();
          
          if (existingRel) {
            // Update existing relationship with merged scopes and last login
            const mergedScopes = [...new Set([...existingRel.scopes, ...userScopes])];
            const { error: updateError } = await supabaseAdmin
              .from('user_applications')
              .update({
                scopes: mergedScopes, // Merge with existing scopes
                last_login: formatDate(token.lastTimeUsed),
                updated_at: new Date().toISOString()
              })
              .eq('id', existingRel.id);
            
            if (updateError) {
              console.error('Error updating user-application relationship:', updateError);
              // Continue to next token rather than failing entire process
              continue;
            }
          } else {
            // Insert new relationship
            const { error: insertError } = await supabaseAdmin
              .from('user_applications')
              .insert({
                user_id: userId,
                application_id: appData.id,
                scopes: userScopes,
                last_login: formatDate(token.lastTimeUsed)
              });
            
            if (insertError) {
              console.error('Error inserting user-application relationship:', insertError);
              // Continue to next token rather than failing entire process
              continue;
            }
          }
        } catch (userAppError) {
          console.error('Error processing user-application relationship:', userAppError);
          // Continue to next token rather than failing entire process
          continue;
        }
      }
    }
    
    // Finalize (100% progress)
    await updateSyncStatus(
      sync_id, 
      100, 
      `Sync completed - Processed ${totalApps} applications and ${users.length} users`, 
      'COMPLETED'
    );
    
    console.log('Background sync completed successfully');
  } catch (error: any) {
    console.error('Error in background sync process:', error);
    
    // Update status to failed
    await updateSyncStatus(
      sync_id,
      -1,
      `Sync failed: ${error.message}`,
      'FAILED'
    );
  }
} 