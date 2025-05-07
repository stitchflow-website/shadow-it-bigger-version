import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { EmailService } from '@/app/lib/services/email-service';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

// Helper function to safely refresh OAuth tokens with retry logic
async function safelyRefreshTokens(
  service: GoogleWorkspaceService | MicrosoftWorkspaceService, 
  syncId: string, 
  orgId: string,
  provider: string
) {
  const maxRetries = 3;
  let attemptCount = 0;
  
  while (attemptCount < maxRetries) {
    try {
      attemptCount++;
      console.log(`[${provider}] Attempting token refresh (attempt ${attemptCount}/${maxRetries}) for org ${orgId}...`);
      
      // Force token refresh
      const refreshedTokens = await service.refreshAccessToken(true);
      
      if (!refreshedTokens) {
        throw new Error(`No ${provider} tokens returned from refresh`);
      }
      
      console.log(`[${provider}] Successfully refreshed tokens for org ${orgId}`);
      return refreshedTokens;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${provider}] Error refreshing tokens (attempt ${attemptCount}/${maxRetries}):`, errorMessage);
      
      if (attemptCount >= maxRetries) {
        console.error(`[${provider}] Max retry attempts reached, giving up token refresh for org ${orgId}`);
        
        // Record the failure in the database
        try {
          await supabaseAdmin
            .from('sync_status')
            .insert({
              organization_id: orgId,
              status: 'FAILED',
              error_message: `${provider} token refresh failed after ${maxRetries} attempts: ${errorMessage}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
        } catch (dbError) {
          console.error(`[${provider}] Failed to record token refresh failure in database:`, dbError);
        }
        
        throw error; // Re-throw the original error
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attemptCount) * 1000; // 2s, 4s, 8s
      console.log(`[${provider}] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error(`Failed to refresh ${provider} tokens after ${maxRetries} attempts`);
}

/**
 * Helper function that safely checks if a notification has already been sent
 * and only sends a new notification if one hasn't been sent before
 */
async function safelySendNotification({
  organizationId,
  userEmail,
  applicationId,
  notificationType,
  sendFunction
}: {
  organizationId: string;
  userEmail: string;
  applicationId: string;
  notificationType: 'new_app' | 'new_user' | 'new_user_review';
  sendFunction: () => Promise<boolean>;
}) {
  try {
    console.log(`Checking if notification type=${notificationType} for app=${applicationId} to user=${userEmail} has already been sent...`);
    
    // First check if notification has already been sent using a transaction
    const { data: notificationExists, error: checkError } = await supabaseAdmin
      .from('notification_tracking')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_email', userEmail)
      .eq('application_id', applicationId)
      .eq('notification_type', notificationType)
      .single();
    
    if (checkError && !checkError.message.includes('No rows found')) {
      // Only report errors that aren't "no rows found"
      console.error(`Error checking notification tracking:`, checkError);
    }
    
    // If notification already exists, don't send again
    if (notificationExists) {
      console.log(`Notification already sent to ${userEmail} for app ${applicationId} (type: ${notificationType})`);
      return false;
    }
    
    console.log(`No existing notification found, proceeding to send...`);
    
    // Create a record BEFORE sending the notification to prevent race conditions
    const { error: insertError } = await supabaseAdmin
      .from('notification_tracking')
      .insert({
        organization_id: organizationId,
        user_email: userEmail,
        application_id: applicationId,
        notification_type: notificationType,
        sent_at: new Date().toISOString()
      });
    
    if (insertError) {
      console.error('Error inserting notification tracking record:', insertError);
      return false;
    }
    
    // Now send the actual notification
    const success = await sendFunction();
    
    if (success) {
      console.log(`Successfully sent ${notificationType} notification to ${userEmail}`);
      return true;
    } else {
      console.log(`Failed to send ${notificationType} notification to ${userEmail}`);
      return false;
    }
  } catch (error) {
    console.error(`Error in safelySendNotification:`, error);
    return false;
  }
}

// Removed edge runtime for Render compatibility
// export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    // Authenticate the request
    // This is a simple check based on a bearer token
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    
    if (token !== process.env.CRON_SECRET) {
      console.error('Unauthorized cron job request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, google_org_id, auth_provider');

    if (orgError) {
      console.error('Error fetching organizations:', orgError);
      return NextResponse.json({ error: 'Error fetching organizations' }, { status: 500 });
    }

    if (!organizations || organizations.length === 0) {
      console.log('No organizations found to process');
      return NextResponse.json({ message: 'No organizations to process' });
    }

    // For each organization, check for new apps and users from connected providers
    for (const org of organizations) {
      console.log(`Processing organization: ${org.id} (${org.name})`);
      
      // Check for new Google apps and users
      if (org.auth_provider === 'google') {
        await processGoogleWorkspace(org);
      }
      
      // Check for Microsoft apps and users
      if (org.auth_provider === 'microsoft') {
        await processMicrosoftEntra(org);
      }
    }

    // Set a flag to track whether we're running in notification-only mode
    // This would happen if we're not processing a cron job but instead responding
    // to a direct API call for notification processing
    const isNotificationOnlyMode = request.headers.get('X-Notification-Only') === 'true';
    
    // if (isNotificationOnlyMode) {
    //   console.log('Running in notification-only mode - processing notifications for already discovered apps/users');
      
    //   // Process notifications for apps/users that were already discovered
    //   try {
    //     await processNewAppNotifications();
    //   } catch (error) {
    //     console.error('Error in processNewAppNotifications:', error);
    //   }
      
    //   try {
    //     await processNewUserNotifications();
    //   } catch (error) {
    //     console.error('Error in processNewUserNotifications:', error);
    //   }
      
    //   try {
    //     await processNewUserReviewNotifications();
    //   } catch (error) {
    //     console.error('Error in processNewUserReviewNotifications:', error);
    //   }
    // }

    return NextResponse.json({ 
      success: true, 
      message: 'Notifications checked and processed'
    });
  } catch (error) {
    console.error('Error in notification check cron job:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function processNewAppNotifications() {
  try {
    console.log('Checking for new app notifications...');

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name');

    if (orgError) {
      throw orgError;
    }

    for (const org of organizations) {
      console.log(`Processing organization: ${org.id}`);
      
      // Get all applications created recently (within the last 24 hours)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const { data: newApps, error: appsError } = await supabaseAdmin
        .from('applications')
        .select('*')
        .eq('organization_id', org.id)
        .gte('created_at', oneDayAgo.toISOString());
      
      if (appsError) {
        console.error(`Error fetching new apps for org ${org.id}:`, appsError);
        continue;
      }

      if (!newApps || newApps.length === 0) {
        console.log(`No new apps found for organization ${org.id}`);
        continue;
      }

      console.log(`Found ${newApps.length} new apps for org ${org.id}`);
      
      // Get users who should be notified (have new_app_detected = true)
      const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('organization_id', org.id)
        .eq('new_app_detected', true);
      
      if (prefsError) {
        console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
        continue;
      }
      
      if (!notificationPrefs || notificationPrefs.length === 0) {
        console.log(`No users with new app notifications enabled for org ${org.id}`);
        continue;
      }
      
      // For each new app, send notifications to eligible users
      for (const app of newApps) {
        // Process each user who has notifications enabled
        for (const pref of notificationPrefs) {
          console.log(`Processing notification for ${pref.user_email} for new app ${app.name}`);
          
          // Use the new helper function to safely send notification
          await safelySendNotification({
            organizationId: org.id,
            userEmail: pref.user_email,
            applicationId: app.id,
            notificationType: 'new_app',
            sendFunction: async () => {
              try {
                // Send the email notification
                await EmailService.sendNewAppNotification({
                  to: pref.user_email,
                  appName: app.name,
                  organizationName: org.name,
                  detectionTime: app.created_at,
                  riskLevel: app.risk_level,
                  category: app.category || 'Uncategorized',
                  userCount: app.user_count,
                  totalPermissions: app.total_permissions
                });
                
                console.log(`Successfully sent new app notification to ${pref.user_email} for ${app.name}`);
                return true; // Indicate success
              } catch (error) {
                console.error(`Error sending notification to ${pref.user_email}:`, error);
                return false; // Indicate failure
              }
            }
          });
        }
      }
    }
    
    console.log('Completed new app notifications check');
  } catch (error) {
    console.error('Error processing new app notifications:', error);
    throw error;
  }
}

async function processNewUserNotifications() {
  try {
    console.log('Checking for new user notifications...');

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name');

    if (orgError) {
      throw orgError;
    }

    for (const org of organizations) {
      console.log(`Processing organization: ${org.id}`);
      
      // Get all user-application relationships created in the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const { data: newUserApps, error: userAppError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          *,
          user:users!inner (id, email, name),
          application:applications!inner (id, name, organization_id, risk_level, category, total_permissions)
        `)
        .gte('created_at', oneDayAgo.toISOString());
      
      if (userAppError) {
        console.error(`Error fetching new user-app relationships:`, userAppError);
        continue;
      }
      
      if (!newUserApps || newUserApps.length === 0) {
        console.log(`No new user-app relationships found for organization ${org.id}`);
        continue;
      }
      
      // Filter to only include this organization's applications
      const orgUserApps = newUserApps.filter(ua => ua.application.organization_id === org.id);
      
      if (orgUserApps.length === 0) {
        console.log(`No new user-app relationships for this organization`);
        continue;
      }
      
      console.log(`Found ${orgUserApps.length} new user-app relationships for org ${org.id}`);
      
      // Get users who should be notified (have new_user_in_app = true)
      const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('organization_id', org.id)
        .eq('new_user_in_app', true);
      
      if (prefsError) {
        console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
        continue;
      }
      
      if (!notificationPrefs || notificationPrefs.length === 0) {
        console.log(`No users with new user notifications enabled for org ${org.id}`);
        continue;
      }
      
      // For each new user-app relationship, send notifications to eligible users
      for (const userApp of orgUserApps) {
        // Process notifications for each eligible user
        for (const pref of notificationPrefs) {
          console.log(`Processing notification to ${pref.user_email} for user ${userApp.user.email} in app ${userApp.application.name}`);
          
          // Use the safe notification helper
          await safelySendNotification({
            organizationId: org.id,
            userEmail: pref.user_email,
            applicationId: userApp.application.id,
            notificationType: 'new_user',
            sendFunction: async () => {
              try {
                // Send the email notification
                await EmailService.sendNewUserNotification({
                  to: pref.user_email,
                  appName: userApp.application.name,
                  userName: userApp.user.name || userApp.user.email,
                  organizationName: org.name,
                  riskLevel: userApp.application.risk_level,
                  category: userApp.application.category || 'Uncategorized',
                  totalPermissions: userApp.application.total_permissions
                });
                
                console.log(`Successfully sent new user notification to ${pref.user_email}`);
                return true;
              } catch (error) {
                console.error(`Error sending notification to ${pref.user_email}:`, error);
                return false;
              }
            }
          });
        }
      }
    }
    
    console.log('Completed new user notifications check');
  } catch (error) {
    console.error('Error processing new user notifications:', error);
    throw error;
  }
}

async function processNewUserReviewNotifications() {
  try {
    console.log('Checking for new user in review app notifications...');

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name');

    if (orgError) {
      throw orgError;
    }

    for (const org of organizations) {
      console.log(`Processing organization: ${org.id}`);
      
      // Get all user-application relationships created in the last 24 hours for 'Needs Review' apps
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const { data: newUserReviewApps, error: userAppError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          *,
          user:users!inner (id, email, name),
          application:applications!inner (id, name, organization_id, risk_level, category, total_permissions, management_status)
        `)
        .gte('created_at', oneDayAgo.toISOString())
        .eq('application.management_status', 'Needs Review');
      
      if (userAppError) {
        console.error(`Error fetching new user-app relationships for review apps:`, userAppError);
        continue;
      }
      
      if (!newUserReviewApps || newUserReviewApps.length === 0) {
        console.log(`No new user-app relationships found for review apps in organization ${org.id}`);
        continue;
      }
      
      // Filter to only include this organization's applications
      const orgUserReviewApps = newUserReviewApps.filter(ua => ua.application.organization_id === org.id);
      
      if (orgUserReviewApps.length === 0) {
        console.log(`No new user-review app relationships for this organization`);
        continue;
      }
      
      console.log(`Found ${orgUserReviewApps.length} new user-review app relationships for org ${org.id}`);
      
      // Get users who should be notified (have new_user_in_review_app = true)
      const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('organization_id', org.id)
        .eq('new_user_in_review_app', true);
      
      if (prefsError) {
        console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
        continue;
      }
      
      if (!notificationPrefs || notificationPrefs.length === 0) {
        console.log(`No users with new user in review app notifications enabled for org ${org.id}`);
        continue;
      }
      
      // For each new user-review app relationship, send notifications to eligible users
      for (const userApp of orgUserReviewApps) {
        // Process notifications for each eligible user
        for (const pref of notificationPrefs) {
          console.log(`Processing review notification to ${pref.user_email} for user ${userApp.user.email} in app ${userApp.application.name}`);
          
          // Use the safe notification helper
          await safelySendNotification({
            organizationId: org.id,
            userEmail: pref.user_email,
            applicationId: userApp.application.id,
            notificationType: 'new_user_review',
            sendFunction: async () => {
              try {
                // Send the email notification
                await EmailService.sendNewUserReviewNotification({
                  to: pref.user_email,
                  appName: userApp.application.name,
                  userName: userApp.user.name || userApp.user.email,
                  organizationName: org.name,
                  riskLevel: userApp.application.risk_level,
                  category: userApp.application.category || 'Uncategorized',
                  totalPermissions: userApp.application.total_permissions
                });
                
                console.log(`Successfully sent review notification to ${pref.user_email}`);
                return true;
              } catch (error) {
                console.error(`Error sending review notification to ${pref.user_email}:`, error);
                return false;
              }
            }
          });
        }
      }
    }
    
    console.log('Completed new user in review app notifications check');
  } catch (error) {
    console.error('Error processing new user in review app notifications:', error);
    throw error;
  }
}

async function processGoogleWorkspace(org: any) {
  try {
    console.log(`Checking Google Workspace for organization ${org.id}...`);
    
    // Get the latest sync record to get auth tokens
    const { data: latestSync, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('organization_id', org.id)
      .eq('status', 'COMPLETED')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (syncError) {
      console.error(`Error fetching latest sync for org ${org.id}:`, syncError);
      return;
    }
    
    if (!latestSync || !latestSync.access_token || !latestSync.refresh_token) {
      console.log(`No valid sync record found for Google org ${org.id}`);
      return;
    }

    // Get provider information
    const { data: orgDetails, error: orgDetailsError } = await supabaseAdmin
      .from('organizations')
      .select('auth_provider')
      .eq('id', org.id)
      .single();

    if (orgDetailsError) {
      console.error(`Error fetching organization details for org ${org.id}:`, orgDetailsError);
      return;
    }

    // Skip if organization is not using Google
    if (orgDetails.auth_provider !== 'google' && orgDetails.auth_provider !== null) {
      console.log(`Organization ${org.id} is not using Google, skipping Google workspace check`);
      return;
    }
    
    // Initialize Google Workspace service
    console.log(`Initializing Google Workspace service for org ${org.id}...`);
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });
    
    // Set the credentials from the latest sync
    await googleService.setCredentials({
      access_token: latestSync.access_token,
      refresh_token: latestSync.refresh_token,
      expiry_date: latestSync.token_expiry || Date.now() + 3600 * 1000
    });
    
    // Always force token refresh before making any API calls
    try {
      console.log(`Forcing token refresh for org ${org.id}...`);
      const refreshedTokens = await safelyRefreshTokens(googleService, latestSync.id, org.id, 'Google');
      
      if (!refreshedTokens) {
        throw new Error('Failed to refresh tokens - no tokens returned');
      }
      
      console.log(`Tokens refreshed for org ${org.id}, updating in database...`);
      
      // Create a new sync_status record with updated tokens
      const { data: newSyncStatus, error: createError } = await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          status: 'COMPLETED',
          message: 'Tokens refreshed successfully',
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token || latestSync.refresh_token,
          token_expiry: refreshedTokens.expiry_date,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error(`Error creating new sync status record:`, createError);
        throw createError;
      }
      
      console.log(`Created new sync status record with ID: ${newSyncStatus.id}`);
    } catch (refreshError) {
      console.error(`Error refreshing tokens for org ${org.id}:`, refreshError);
      
      // Update sync status to indicate authentication failure
      await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          status: 'FAILED',
          error_message: `Token refresh failed: ${refreshError instanceof Error ? refreshError.message : 'Unknown error'}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      console.log(`Marked sync status as FAILED for org ${org.id} due to token refresh failure`);
      return; // Exit early as we can't proceed without valid tokens
    }
    
    // Fetch current apps from Google Workspace
    console.log(`Fetching current apps from Google Workspace for org ${org.id}...`);
    
    try {
      const tokens = await googleService.getOAuthTokens();
      console.log(`Fetched ${tokens.length} tokens from Google Workspace for org ${org.id}`);
      
      // Group tokens by application
      const appMap = new Map<string, any>(); // clientId -> app info
      for (const token of tokens) {
        if (!token.clientId || !token.displayText) continue;
        
        if (!appMap.has(token.clientId)) {
          // Calculate all unique scopes for this app across all users
          const allScopes = new Set<string>();
          if (token.scopes && Array.isArray(token.scopes)) {
            token.scopes.forEach(scope => allScopes.add(scope));
          }
          
          appMap.set(token.clientId, {
            clientId: token.clientId,
            name: token.displayText,
            scopes: allScopes,
            users: new Set(),
            riskLevel: determineRiskLevel(token.scopes),
          });
        } else {
          // Update existing app entry
          const app = appMap.get(token.clientId);
          if (token.scopes && Array.isArray(token.scopes)) {
            token.scopes.forEach(scope => app.scopes.add(scope));
          }
          
          // Update risk level if needed
          const tokenRisk = determineRiskLevel(token.scopes);
          if (tokenRisk === 'HIGH' || (tokenRisk === 'MEDIUM' && app.riskLevel !== 'HIGH')) {
            app.riskLevel = tokenRisk;
          }
        }
        
        // Add user to this app
        if (token.userEmail) {
          appMap.get(token.clientId).users.add(token.userEmail);
        }
      }
      
      console.log(`Processed ${appMap.size} unique apps from Google Workspace for org ${org.id}`);
      
      // Get existing apps from our database
      const { data: existingApps, error: appError } = await supabaseAdmin
        .from('applications')
        .select('id, name, google_app_id, category, risk_level, total_permissions, management_status, created_at, user_count')
        .eq('organization_id', org.id)
        .not('google_app_id', 'is', null);  // Only get Google apps
      
      if (appError) {
        console.error(`Error fetching existing apps for org ${org.id}:`, appError);
        return;
      }
      
      // Create a map of existing apps by Google client ID
      const existingAppMap = new Map<string, any>();
      existingApps?.forEach(app => {
        if (app.google_app_id) {
          // Handle multiple client IDs separated by commas
          app.google_app_id.split(',').forEach((clientId: string) => {
            existingAppMap.set(clientId.trim(), app);
          });
        }
      });
      
      // Track all Google client IDs we've seen in this sync
      const seenClientIds = new Set<string>();
      
      // Process each app from Google Workspace
      for (const [clientId, appInfo] of appMap.entries()) {
        seenClientIds.add(clientId);
        
        if (existingAppMap.has(clientId)) {
          // This is an existing app - update it with the latest info
          const existingApp = existingAppMap.get(clientId);
          const updatedValues: any = {};
          let needsUpdate = false;
          
          // Check if any values need to be updated
          if (appInfo.name !== existingApp.name) {
            updatedValues.name = appInfo.name;
            needsUpdate = true;
          }
          
          if (appInfo.riskLevel !== existingApp.risk_level) {
            updatedValues.risk_level = appInfo.riskLevel;
            needsUpdate = true;
          }
          
          if (appInfo.scopes.size !== existingApp.total_permissions) {
            updatedValues.total_permissions = appInfo.scopes.size;
            updatedValues.all_scopes = Array.from(appInfo.scopes);
            needsUpdate = true;
          }
          
          if (appInfo.users.size !== existingApp.user_count) {
            updatedValues.user_count = appInfo.users.size;
            needsUpdate = true;
          }
          
          if (needsUpdate) {
            console.log(`Updating existing app ${existingApp.name} (${existingApp.id}) with new info`);
            updatedValues.updated_at = new Date().toISOString();
            
            const { error: updateError } = await supabaseAdmin
              .from('applications')
              .update(updatedValues)
              .eq('id', existingApp.id);
            
            if (updateError) {
              console.error(`Error updating app ${existingApp.id}:`, updateError);
            } else {
              console.log(`Successfully updated app ${existingApp.name} (${existingApp.id})`);
            }
          } else {
            console.log(`No changes needed for existing app ${existingApp.name} (${existingApp.id})`);
          }
        } else {
          // This is a new app - add it to our database
          console.log(`Found new app ${appInfo.name} from Google Workspace`);
          
          try {
            // Add app to database
            const { data: insertedApp, error: insertError } = await supabaseAdmin
              .from('applications')
              .insert({
                organization_id: org.id,
                name: appInfo.name,
                google_app_id: appInfo.clientId,
                risk_level: appInfo.riskLevel,
                total_permissions: appInfo.scopes.size,
                all_scopes: Array.from(appInfo.scopes),
                user_count: appInfo.users.size,
                management_status: 'NEEDS_REVIEW',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();
            
            if (insertError) {
              console.error(`Error inserting new app ${appInfo.name}:`, insertError);
              continue;
            }
            
            console.log(`Added new app to database: ${appInfo.name} (${insertedApp.id})`);
            
            // Send notifications to users who have enabled them
            await sendNewAppNotifications(org, insertedApp);
            
          } catch (error) {
            console.error(`Error processing new app ${appInfo.name}:`, error);
          }
        }
      }
      
      // Check for apps in our database that no longer exist in Google Workspace
      console.log(`Checking for apps that no longer exist in Google Workspace...`);
      for (const [clientId, app] of existingAppMap.entries()) {
        if (!seenClientIds.has(clientId)) {
          console.log(`App ${app.name} (${app.id}) with client ID ${clientId} no longer exists in Google Workspace`);
          
          // You could mark these as inactive or remove them, depending on your requirements
          // For now, we'll just log them
        }
      }
      
      // Now reconcile users for each app
      console.log(`Reconciling users for Google Workspace apps...`);
      
      // Get all users from the database
      const { data: dbUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('organization_id', org.id);
      
      if (usersError) {
        console.error(`Error fetching users for org ${org.id}:`, usersError);
        return;
      }
      
      // Create a map of email to user ID and name
      const userEmailMap = new Map<string, { id: string, name: string }>();
      dbUsers?.forEach(user => {
        userEmailMap.set(user.email, { id: user.id, name: user.name || user.email });
      });
      
      // Process each app from Google Workspace that exists in our database
      for (const [clientId, appInfo] of appMap.entries()) {
        // Skip if app doesn't exist in our database
        if (!existingAppMap.has(clientId)) continue;
        
        const dbApp = existingAppMap.get(clientId);
        
        // Get all existing user-app relationships for this app
        const { data: existingUserApps, error: userAppError } = await supabaseAdmin
          .from('user_applications')
          .select(`
            id, 
            user_id,
            user:users!inner (email)
          `)
          .eq('application_id', dbApp.id);
        
        if (userAppError) {
          console.error(`Error fetching existing user-app relationships for app ${dbApp.id}:`, userAppError);
          continue;
        }
        
        // Create a set of existing user emails for this app
        const existingUserEmailSet = new Set<string>();
        const userIdsByEmail = new Map<string, string>(); // email -> user_application.id
        
        existingUserApps?.forEach(userApp => {
          const email = userApp.user?.[0]?.email;
          if (email) {
            existingUserEmailSet.add(email);
            userIdsByEmail.set(email, userApp.id);
          }
        });
        
        // Track emails we've seen in this sync
        const seenUserEmails = new Set<string>();
        
        // Check for new users for this app
        for (const userEmail of appInfo.users) {
          seenUserEmails.add(userEmail);
          
          // Skip if user doesn't exist in our database
          if (!userEmailMap.has(userEmail)) {
            console.log(`User ${userEmail} not found in database, skipping`);
            continue;
          }
          
          const userId = userEmailMap.get(userEmail)!.id;
          const userName = userEmailMap.get(userEmail)!.name;
          
          // Check if this user-app relationship already exists
          if (!existingUserEmailSet.has(userEmail)) {
            // This is a new user-app relationship
            console.log(`New user ${userEmail} for app ${dbApp.name}`);
            
            try {
              // Create user-app relationship in database
              const { error: insertError } = await supabaseAdmin
                .from('user_applications')
                .insert({
                  application_id: dbApp.id,
                  user_id: userId,
                  organization_id: org.id,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                });
              
              if (insertError) {
                console.error(`Error inserting user-app relationship:`, insertError);
                continue;
              }
              
              console.log(`Added new user-app relationship: ${userEmail} - ${dbApp.name}`);
              
              // Send notification for this new user-app relationship
              const isReviewApp = dbApp.management_status === 'NEEDS_REVIEW';
              await sendNewUserNotifications(
                org, 
                dbApp, 
                userEmail, 
                userName, 
                isReviewApp
              );
              
            } catch (error) {
              console.error(`Error processing new user-app relationship:`, error);
            }
          } else {
            console.log(`User ${userEmail} already exists for app ${dbApp.name}`);
          }
        }
        
        // Check for users who no longer have access to this app
        console.log(`Checking for removed users for app ${dbApp.name}...`);
        for (const userEmail of existingUserEmailSet) {
          if (!seenUserEmails.has(userEmail)) {
            console.log(`User ${userEmail} no longer has access to app ${dbApp.name}`);
            
            // Get the user_application.id for this relationship
            const userAppId = userIdsByEmail.get(userEmail);
            if (userAppId) {
              // Mark user-app relationship as removed or delete it
              // For now, we'll keep the record but update status
              const { error: updateError } = await supabaseAdmin
                .from('user_applications')
                .update({
                  status: 'REMOVED',
                  updated_at: new Date().toISOString()
                })
                .eq('id', userAppId);
              
              if (updateError) {
                console.error(`Error updating user-app relationship:`, updateError);
              } else {
                console.log(`Marked user-app relationship as REMOVED: ${userEmail} - ${dbApp.name}`);
              }
            }
          }
        }
      }
      
    } catch (error: any) {
      console.error(`Error fetching OAuth tokens from Google:`, error);
      
      // Update sync status to indicate authentication failure
      await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          status: 'FAILED',
          error_message: `Authentication failed: ${error.message || 'Unknown error'}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    }
    
  } catch (error) {
    console.error(`Error in Google Workspace processing for org ${org.id}:`, error);
  }
}

// Helper function to determine risk level based on scopes
function determineRiskLevel(scopes: string[] | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' {
  // If no scopes provided, default to LOW
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'LOW';
  }

  const highRiskScopes = [
    'https://www.googleapis.com/auth/admin.directory.user',
    'https://www.googleapis.com/auth/admin.directory.group',
    'https://www.googleapis.com/auth/admin.directory.user.security',
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail',
    'https://www.googleapis.com/auth/drive',
  ];

  const mediumRiskScopes = [
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
  ];

  if (scopes.some(scope => highRiskScopes.includes(scope))) {
    return 'HIGH';
  }

  if (scopes.some(scope => mediumRiskScopes.includes(scope))) {
    return 'MEDIUM';
  }

  return 'LOW';
}

async function processMicrosoftEntra(org: any) {
  try {
    console.log(`Checking Microsoft Entra for organization ${org.id}...`);
    
    // Get the latest sync record to get auth tokens
    const { data: latestSync, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('organization_id', org.id)
      .eq('status', 'COMPLETED')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (syncError) {
      console.error(`Error fetching latest sync for org ${org.id}:`, syncError);
      return;
    }
    
    if (!latestSync || !latestSync.access_token || !latestSync.refresh_token) {
      console.log(`No valid sync record found for Microsoft org ${org.id}`);
      return;
    }

    // Get provider information
    const { data: orgDetails, error: orgDetailsError } = await supabaseAdmin
      .from('organizations')
      .select('auth_provider')
      .eq('id', org.id)
      .single();

    if (orgDetailsError) {
      console.error(`Error fetching organization details for org ${org.id}:`, orgDetailsError);
      return;
    }

    // Skip if organization is not using Microsoft
    if (orgDetails.auth_provider !== 'microsoft' && orgDetails.auth_provider !== null) {
      console.log(`Organization ${org.id} is not using Microsoft, skipping Microsoft Entra check`);
      return;
    }
    
    // Initialize Microsoft Entra service
    console.log(`Initializing Microsoft Entra service for org ${org.id}...`);
    const microsoftService = new MicrosoftWorkspaceService({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
    });
    
    // Set the credentials from the latest sync
    await microsoftService.setCredentials({
      access_token: latestSync.access_token,
      refresh_token: latestSync.refresh_token,
      expiry_date: latestSync.token_expiry || Date.now() + 3600 * 1000
    });
    
    // Always force token refresh before making any API calls
    try {
      console.log(`Forcing token refresh for org ${org.id}...`);
      const refreshedTokens = await safelyRefreshTokens(microsoftService, latestSync.id, org.id, 'Microsoft');
      
      if (!refreshedTokens) {
        throw new Error('Failed to refresh tokens - no tokens returned');
      }
      
      console.log(`Tokens refreshed for org ${org.id}, updating in database...`);
      
      // Create a new sync_status record with updated tokens
      const { data: newSyncStatus, error: createError } = await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          status: 'COMPLETED',
          message: 'Tokens refreshed successfully',
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token || latestSync.refresh_token,
          token_expiry: refreshedTokens.expiry_date,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error(`Error creating new sync status record:`, createError);
        throw createError;
      }
      
      console.log(`Created new sync status record with ID: ${newSyncStatus.id}`);
    } catch (refreshError) {
      console.error(`Error refreshing tokens for org ${org.id}:`, refreshError);
      
      // Update sync status to indicate authentication failure
      await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          status: 'FAILED',
          error_message: `Token refresh failed: ${refreshError instanceof Error ? refreshError.message : 'Unknown error'}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      console.log(`Marked sync status as FAILED for org ${org.id} due to token refresh failure`);
      return; // Exit early as we can't proceed without valid tokens
    }
    
    // Fetch current apps from Microsoft Entra
    console.log(`Fetching current apps from Microsoft Entra for org ${org.id}...`);
    
    try {
      const tokens = await microsoftService.getOAuthTokens();
      console.log(`Fetched ${tokens.length} tokens from Microsoft Entra for org ${org.id}`);
      
      // Group tokens by application
      const appMap = new Map<string, any>(); // clientId -> app info
      for (const token of tokens) {
        if (!token.clientId || !token.displayText) continue;
        
        if (!appMap.has(token.clientId)) {
          // Calculate all unique scopes for this app across all users
          const allScopes = new Set<string>();
          if (token.scopes && Array.isArray(token.scopes)) {
            token.scopes.forEach(scope => allScopes.add(scope));
          }
          
          appMap.set(token.clientId, {
            clientId: token.clientId,
            name: token.displayText,
            scopes: allScopes,
            users: new Set(),
            riskLevel: determineRiskLevel(token.scopes),
          });
        } else {
          // Update existing app entry
          const app = appMap.get(token.clientId);
          if (token.scopes && Array.isArray(token.scopes)) {
            token.scopes.forEach(scope => app.scopes.add(scope));
          }
          
          // Update risk level if needed
          const tokenRisk = determineRiskLevel(token.scopes);
          if (tokenRisk === 'HIGH' || (tokenRisk === 'MEDIUM' && app.riskLevel !== 'HIGH')) {
            app.riskLevel = tokenRisk;
          }
        }
        
        // Add user to this app
        if (token.userEmail) {
          appMap.get(token.clientId).users.add(token.userEmail);
        }
      }
      
      console.log(`Processed ${appMap.size} unique apps from Microsoft Entra for org ${org.id}`);
      
      // Get existing apps from our database
      const { data: existingApps, error: appError } = await supabaseAdmin
        .from('applications')
        .select('id, name, microsoft_app_id, category, risk_level, total_permissions, management_status, created_at')
        .eq('organization_id', org.id);
      
      if (appError) {
        console.error(`Error fetching existing apps for org ${org.id}:`, appError);
        return;
      }
      
      // Create a map of existing apps by Microsoft client ID
      const existingAppMap = new Map<string, any>();
      existingApps?.forEach(app => {
        if (app.microsoft_app_id) {
          // Handle multiple client IDs separated by commas
          app.microsoft_app_id.split(',').forEach((clientId: string) => {
            existingAppMap.set(clientId.trim(), app);
          });
        }
      });
      
      // Check for new apps
      const newApps = [];
      for (const [clientId, appInfo] of appMap.entries()) {
        if (!existingAppMap.has(clientId)) {
          // This is a new app
          newApps.push({
            clientId,
            name: appInfo.name,
            scopes: Array.from(appInfo.scopes),
            userCount: appInfo.users.size,
            riskLevel: appInfo.riskLevel,
          });
        }
      }
      
      console.log(`Found ${newApps.length} new apps from Microsoft Entra for org ${org.id}`);
      
      // Add new apps to the database and send notifications
      for (const newApp of newApps) {
        try {
          // Add app to database
          const { data: insertedApp, error: insertError } = await supabaseAdmin
            .from('applications')
            .insert({
              organization_id: org.id,
              name: newApp.name,
              microsoft_app_id: newApp.clientId,
              risk_level: newApp.riskLevel,
              total_permissions: newApp.scopes.length,
              all_scopes: newApp.scopes,
              user_count: newApp.userCount,
              management_status: 'NEEDS_REVIEW',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (insertError) {
            console.error(`Error inserting new app ${newApp.name}:`, insertError);
            continue;
          }
          
          console.log(`Added new app to database: ${newApp.name} (${insertedApp.id})`);
          
          // Send notifications to users who have enabled them
          await sendNewAppNotifications(org, insertedApp);
          
        } catch (error) {
          console.error(`Error processing new app ${newApp.name}:`, error);
        }
      }
      
      // Now check for new users in existing apps
      console.log(`Checking for new users in existing apps for org ${org.id}...`);
      
      // Get all existing user-app relationships for Microsoft
      const { data: existingUserApps, error: userAppError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          id, 
          application_id, 
          user:users (email)
        `)
        .eq('organization_id', org.id);
      
      if (userAppError) {
        console.error(`Error fetching existing user-app relationships for org ${org.id}:`, userAppError);
        return;
      }
      
      // Create a set of existing user-app combinations
      const existingUserAppSet = new Set<string>();
      existingUserApps?.forEach(userApp => {
        // Access the email correctly from the nested user object
        const key = `${userApp.application_id}-${userApp.user?.[0]?.email}`;
        existingUserAppSet.add(key);
      });
      
      // Get all users from the database
      const { data: dbUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, email, name')
        .eq('organization_id', org.id);
      
      if (usersError) {
        console.error(`Error fetching users for org ${org.id}:`, usersError);
        return;
      }
      
      // Create a map of email to user ID and name
      const userEmailMap = new Map<string, { id: string, name: string }>();
      dbUsers?.forEach(user => {
        userEmailMap.set(user.email, { id: user.id, name: user.name || user.email });
      });
      
      // Check for new user-app relationships
      const newUserApps = [];
      
      for (const [clientId, appInfo] of appMap.entries()) {
        // Skip if app doesn't exist in our database
        if (!existingAppMap.has(clientId)) continue;
        
        const dbApp = existingAppMap.get(clientId);
        const isReviewApp = dbApp.management_status === 'NEEDS_REVIEW';
        
        // Check each user for this app
        for (const userEmail of appInfo.users) {
          // Skip if user doesn't exist in our database
          if (!userEmailMap.has(userEmail)) continue;
          
          const userId = userEmailMap.get(userEmail)!.id;
          const userName = userEmailMap.get(userEmail)!.name;
          
          // Check if this user-app relationship already exists
          const userAppKey = `${dbApp.id}-${userEmail}`;
          if (!existingUserAppSet.has(userAppKey)) {
            // This is a new user-app relationship
            newUserApps.push({
              appId: dbApp.id,
              appName: dbApp.name,
              userEmail,
              userId,
              userName,
              isReviewApp
            });
          }
        }
      }
      
      console.log(`Found ${newUserApps.length} new user-app relationships for org ${org.id}`);
      
      // Process new user-app relationships
      for (const newUserApp of newUserApps) {
        try {
          // Create user-app relationship in database
          const { error: insertError } = await supabaseAdmin
            .from('user_applications')
            .insert({
              application_id: newUserApp.appId,
              user_id: newUserApp.userId,
              organization_id: org.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          
          if (insertError) {
            console.error(`Error inserting user-app relationship:`, insertError);
            continue;
          }
          
          console.log(`Added new user-app relationship: ${newUserApp.userEmail} - ${newUserApp.appName}`);
          
          // Get full app details for notification
          const { data: app } = await supabaseAdmin
            .from('applications')
            .select('*')
            .eq('id', newUserApp.appId)
            .single();
          
          if (!app) {
            console.error(`Could not find app with ID ${newUserApp.appId}`);
            continue;
          }
          
          // Send notifications
          await sendNewUserNotifications(
            org, 
            app, 
            newUserApp.userEmail, 
            newUserApp.userName, 
            newUserApp.isReviewApp
          );
          
        } catch (error) {
          console.error(`Error processing new user-app relationship:`, error);
        }
      }
      
    } catch (error: any) {
      console.error(`Error fetching OAuth tokens from Microsoft:`, error);
      
      // Update sync status to indicate authentication failure
      await supabaseAdmin
        .from('sync_status')
        .insert({
          organization_id: org.id,
          status: 'FAILED',
          error_message: `Authentication failed: ${error.message || 'Unknown error'}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    }
    
  } catch (error) {
    console.error(`Error in Microsoft Entra processing for org ${org.id}:`, error);
  }
}

// Helper function to send notifications for a new app
async function sendNewAppNotifications(org: any, app: any) {
  try {
    console.log(`Preparing to send notifications for new app ${app.name} (${app.id})`);
    
    // Get users who should be notified (have new_app_detected = true)
    const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('organization_id', org.id)
      .eq('new_app_detected', true);
    
    if (prefsError) {
      console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
      return;
    }
    
    if (!notificationPrefs || notificationPrefs.length === 0) {
      console.log(`No users with new app notifications enabled for org ${org.id}`);
      return;
    }
    
    console.log(`Found ${notificationPrefs.length} users with notifications enabled for org ${org.id}`);
    
    // For each user with notifications enabled, send an email
    for (const pref of notificationPrefs) {
      await safelySendNotification({
        organizationId: org.id,
        userEmail: pref.user_email,
        applicationId: app.id,
        notificationType: 'new_app',
        sendFunction: async () => {
          try {
            // Send the email notification
            await EmailService.sendNewAppNotification({
              to: pref.user_email,
              appName: app.name,
              organizationName: org.name,
              detectionTime: app.created_at,
              riskLevel: app.risk_level,
              category: app.category || 'Uncategorized',
              userCount: app.user_count,
              totalPermissions: app.total_permissions
            });
            
            console.log(`Successfully sent new app notification to ${pref.user_email} for ${app.name}`);
            return true;
          } catch (error) {
            console.error(`Error sending notification to ${pref.user_email}:`, error);
            return false;
          }
        }
      });
    }
  } catch (error) {
    console.error(`Error sending notifications for app ${app.name}:`, error);
  }
}

// Helper function to send notifications for a new user in an app
async function sendNewUserNotifications(org: any, app: any, userEmail: string, userName: string, isReviewApp: boolean) {
  try {
    console.log(`Preparing to send notifications for new user ${userEmail} in app ${app.name}`);
    
    // Determine which notification type to check based on whether it's a review app
    const preferenceField = isReviewApp ? 'new_user_in_review_app' : 'new_user_in_app';
    const notificationType = isReviewApp ? 'new_user_review' : 'new_user';
    
    // Get users who should be notified
    const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('organization_id', org.id)
      .eq(preferenceField, true);
    
    if (prefsError) {
      console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
      return;
    }
    
    if (!notificationPrefs || notificationPrefs.length === 0) {
      console.log(`No users with ${preferenceField} notifications enabled for org ${org.id}`);
      return;
    }
    
    console.log(`Found ${notificationPrefs.length} users with ${preferenceField} notifications enabled for org ${org.id}`);
    
    // For each user with notifications enabled, send an email
    for (const pref of notificationPrefs) {
      await safelySendNotification({
        organizationId: org.id,
        userEmail: pref.user_email,
        applicationId: app.id,
        notificationType: notificationType,
        sendFunction: async () => {
          try {
            // Send the email notification based on notification type
            if (isReviewApp) {
              await EmailService.sendNewUserReviewNotification({
                to: pref.user_email,
                appName: app.name,
                userName: userName || userEmail,
                organizationName: org.name,
                riskLevel: app.risk_level,
                category: app.category || 'Uncategorized',
                totalPermissions: app.total_permissions
              });
            } else {
              await EmailService.sendNewUserNotification({
                to: pref.user_email,
                appName: app.name,
                userName: userName || userEmail,
                organizationName: org.name,
                riskLevel: app.risk_level,
                category: app.category || 'Uncategorized',
                totalPermissions: app.total_permissions
              });
            }
            
            console.log(`Successfully sent ${notificationType} notification to ${pref.user_email}`);
            return true;
          } catch (error) {
            console.error(`Error sending notification to ${pref.user_email}:`, error);
            return false;
          }
        }
      });
    }
  } catch (error) {
    console.error(`Error sending notifications for user ${userEmail} in app ${app.name}:`, error);
  }
}