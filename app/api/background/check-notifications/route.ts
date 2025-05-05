import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EmailService } from '@/app/lib/services/email-service';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

// Use service role for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'shadow_it'
    }
  }
);

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
      .select('id, name, domain, google_org_id');

    if (orgError) {
      console.error('Error fetching organizations:', orgError);
      return NextResponse.json({ error: 'Error fetching organizations' }, { status: 500 });
    }

    if (!organizations || organizations.length === 0) {
      console.log('No organizations found to process');
      return NextResponse.json({ message: 'No organizations to process' });
    }

    // For each organization, check for new apps and users
    for (const org of organizations) {
      console.log(`Processing organization: ${org.id} (${org.name})`);
      
      // Check for new Google apps and users
      await processGoogleWorkspace(org);
      
      // Check for Microsoft apps and users
      await processMicrosoftEntra(org);
    }

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
        // Check if we've already sent notifications for this app
        for (const pref of notificationPrefs) {
          const { data: existingNotifications, error: trackingError } = await supabaseAdmin
            .from('notification_tracking')
            .select('*')
            .eq('organization_id', org.id)
            .eq('user_email', pref.user_email)
            .eq('application_id', app.id)
            .eq('notification_type', 'new_app');
          
          if (trackingError) {
            console.error(`Error checking notification tracking:`, trackingError);
            continue;
          }
          
          // Skip if notification was already sent
          if (existingNotifications && existingNotifications.length > 0) {
            console.log(`Notification already sent to ${pref.user_email} for app ${app.id}`);
            continue;
          }
          
          console.log(`Sending notification to ${pref.user_email} for new app ${app.name}`);
          
          try {
            // Record that we're sending a notification
            const { error: insertError } = await supabaseAdmin
              .from('notification_tracking')
              .insert({
                organization_id: org.id,
                user_email: pref.user_email,
                application_id: app.id,
                notification_type: 'new_app'
              });
            
            if (insertError) {
              console.error('Error inserting notification tracking record:', insertError);
              continue;
            }
            
            // Send the email notification
            await EmailService.sendNewAppNotification({
              to: pref.user_email,
              appName: app.name,
              organizationName: org.name,
              detectionTime: app.created_at,
              riskLevel: app.risk_level,
              category: app.category,
              userCount: app.user_count,
              totalPermissions: app.total_permissions
            });
            
            console.log(`Successfully sent new app notification to ${pref.user_email} for ${app.name}`);
          } catch (error) {
            console.error(`Error sending notification to ${pref.user_email}:`, error);
          }
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
        // Check if we've already sent notifications for this user-app relationship
        for (const pref of notificationPrefs) {
          // Create a unique key for this notification (app ID + user ID combination)
          const notificationKey = `${userApp.application.id}-${userApp.user.id}`;
          
          const { data: existingNotifications, error: trackingError } = await supabaseAdmin
            .from('notification_tracking')
            .select('*')
            .eq('organization_id', org.id)
            .eq('user_email', pref.user_email)
            .eq('application_id', userApp.application.id)
            .eq('notification_type', 'new_user');
          
          if (trackingError) {
            console.error(`Error checking notification tracking:`, trackingError);
            continue;
          }
          
          // Skip if notification was already sent
          if (existingNotifications && existingNotifications.length > 0) {
            console.log(`Notification already sent to ${pref.user_email} for user ${userApp.user.email} in app ${userApp.application.name}`);
            continue;
          }
          
          console.log(`Sending notification to ${pref.user_email} for new user ${userApp.user.email} in app ${userApp.application.name}`);
          
          try {
            // Record that we're sending a notification
            const { error: insertError } = await supabaseAdmin
              .from('notification_tracking')
              .insert({
                organization_id: org.id,
                user_email: pref.user_email,
                application_id: userApp.application.id,
                notification_type: 'new_user'
              });
            
            if (insertError) {
              console.error('Error inserting notification tracking record:', insertError);
              continue;
            }
            
            // Send the email notification
            await EmailService.sendNewUserNotification({
              to: pref.user_email,
              appName: userApp.application.name,
              userName: userApp.user.name || userApp.user.email,
              organizationName: org.name,
              riskLevel: userApp.application.risk_level,
              category: userApp.application.category,
              totalPermissions: userApp.application.total_permissions
            });
            
            console.log(`Successfully sent new user notification to ${pref.user_email}`);
          } catch (error) {
            console.error(`Error sending notification to ${pref.user_email}:`, error);
          }
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
        // Check if we've already sent notifications for this user-app relationship
        for (const pref of notificationPrefs) {
          const { data: existingNotifications, error: trackingError } = await supabaseAdmin
            .from('notification_tracking')
            .select('*')
            .eq('organization_id', org.id)
            .eq('user_email', pref.user_email)
            .eq('application_id', userApp.application.id)
            .eq('notification_type', 'new_user_review');
          
          if (trackingError) {
            console.error(`Error checking notification tracking:`, trackingError);
            continue;
          }
          
          // Skip if notification was already sent
          if (existingNotifications && existingNotifications.length > 0) {
            console.log(`Review notification already sent to ${pref.user_email} for user ${userApp.user.email} in app ${userApp.application.name}`);
            continue;
          }
          
          console.log(`Sending review notification to ${pref.user_email} for new user ${userApp.user.email} in review app ${userApp.application.name}`);
          
          try {
            // Record that we're sending a notification
            const { error: insertError } = await supabaseAdmin
              .from('notification_tracking')
              .insert({
                organization_id: org.id,
                user_email: pref.user_email,
                application_id: userApp.application.id,
                notification_type: 'new_user_review'
              });
            
            if (insertError) {
              console.error('Error inserting notification tracking record:', insertError);
              continue;
            }
            
            // Send the email notification
            await EmailService.sendNewUserReviewNotification({
              to: pref.user_email,
              appName: userApp.application.name,
              userName: userApp.user.name || userApp.user.email,
              organizationName: org.name,
              riskLevel: userApp.application.risk_level,
              category: userApp.application.category,
              totalPermissions: userApp.application.total_permissions
            });
            
            console.log(`Successfully sent review notification to ${pref.user_email}`);
          } catch (error) {
            console.error(`Error sending review notification to ${pref.user_email}:`, error);
          }
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
    
    // Initialize Google Workspace service
    console.log(`Initializing Google Workspace service for org ${org.id}...`);
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });
    
    await googleService.setCredentials({
      access_token: latestSync.access_token,
      refresh_token: latestSync.refresh_token,
      expiry_date: Date.now() + 3600 * 1000
    });
    
    // Fetch current apps from Google Workspace
    console.log(`Fetching current apps from Google Workspace for org ${org.id}...`);
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
      .select('id, name, google_app_id, category, risk_level, total_permissions, management_status, created_at')
      .eq('organization_id', org.id);
    
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
    
    console.log(`Found ${newApps.length} new apps from Google Workspace for org ${org.id}`);
    
    // Add new apps to the database and send notifications
    for (const newApp of newApps) {
      try {
        // Add app to database
        const { data: insertedApp, error: insertError } = await supabaseAdmin
          .from('applications')
          .insert({
            organization_id: org.id,
            name: newApp.name,
            google_app_id: newApp.clientId,
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
    
    // Get all existing user-app relationships for Google
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
    
    // Initialize Microsoft Entra service
    console.log(`Initializing Microsoft Entra service for org ${org.id}...`);
    const microsoftService = new MicrosoftWorkspaceService({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenant_id: process.env.MICROSOFT_TENANT_ID!
    });
    
    await microsoftService.setCredentials({
      access_token: latestSync.access_token,
      refresh_token: latestSync.refresh_token
    });
    
    // Fetch current apps from Microsoft Entra
    console.log(`Fetching current apps from Microsoft Entra for org ${org.id}...`);
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
          riskLevel: determineMicrosoftRiskLevel(token.scopes),
        });
      } else {
        // Update existing app entry
        const app = appMap.get(token.clientId);
        if (token.scopes && Array.isArray(token.scopes)) {
          token.scopes.forEach(scope => app.scopes.add(scope));
        }
        
        // Update risk level if needed
        const tokenRisk = determineMicrosoftRiskLevel(token.scopes);
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
        existingAppMap.set(app.microsoft_app_id, app);
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
    
  } catch (error) {
    console.error(`Error in Microsoft Entra processing for org ${org.id}:`, error);
  }
}

// Helper function to determine risk level for Microsoft permissions
function determineMicrosoftRiskLevel(scopes: string[] | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' {
  // If no scopes provided, default to LOW
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return 'LOW';
  }

  const highRiskScopes = [
    'Directory.ReadWrite.All',
    'User.ReadWrite.All',
    'Group.ReadWrite.All',
    'Mail.ReadWrite',
    'Files.ReadWrite.All',
    'Sites.ReadWrite.All',
  ];

  const mediumRiskScopes = [
    'Directory.Read.All',
    'User.Read.All',
    'Group.Read.All',
    'Mail.Read',
    'Files.Read.All',
    'Sites.Read.All',
  ];

  if (scopes.some(scope => {
    return highRiskScopes.some(highRiskScope => scope.includes(highRiskScope));
  })) {
    return 'HIGH';
  }

  if (scopes.some(scope => {
    return mediumRiskScopes.some(mediumRiskScope => scope.includes(mediumRiskScope));
  })) {
    return 'MEDIUM';
  }

  return 'LOW';
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
      try {
        // Check if we've already sent a notification for this app to this user
        const { data: existingNotifications, error: trackingError } = await supabaseAdmin
          .from('notification_tracking')
          .select('*')
          .eq('organization_id', org.id)
          .eq('user_email', pref.user_email)
          .eq('application_id', app.id)
          .eq('notification_type', 'new_app');
        
        if (trackingError) {
          console.error(`Error checking notification tracking:`, trackingError);
          continue;
        }
        
        // Skip if notification was already sent
        if (existingNotifications && existingNotifications.length > 0) {
          console.log(`Notification already sent to ${pref.user_email} for app ${app.id}`);
          continue;
        }
        
        console.log(`Sending notification to ${pref.user_email} for new app ${app.name}`);
        
        // Record that we're sending a notification
        const { error: insertError } = await supabaseAdmin
          .from('notification_tracking')
          .insert({
            organization_id: org.id,
            user_email: pref.user_email,
            application_id: app.id,
            notification_type: 'new_app'
          });
        
        if (insertError) {
          console.error('Error inserting notification tracking record:', insertError);
          continue;
        }
        
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
      } catch (error) {
        console.error(`Error sending notification to ${pref.user_email}:`, error);
      }
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
      try {
        // Create a unique identifier for this notification (combines app ID and user email)
        const notificationIdentifier = `${app.id}-${userEmail}`;
        
        // Check if we've already sent a notification for this app+user combination to this recipient
        const { data: existingNotifications, error: trackingError } = await supabaseAdmin
          .from('notification_tracking')
          .select('*')
          .eq('organization_id', org.id)
          .eq('user_email', pref.user_email)
          .eq('application_id', app.id)
          .eq('notification_type', notificationType);
        
        if (trackingError) {
          console.error(`Error checking notification tracking:`, trackingError);
          continue;
        }
        
        // Skip if notification was already sent
        if (existingNotifications && existingNotifications.length > 0) {
          console.log(`Notification already sent to ${pref.user_email} for user ${userEmail} in app ${app.name}`);
          continue;
        }
        
        console.log(`Sending ${notificationType} notification to ${pref.user_email} for new user ${userEmail} in app ${app.name}`);
        
        // Record that we're sending a notification
        const { error: insertError } = await supabaseAdmin
          .from('notification_tracking')
          .insert({
            organization_id: org.id,
            user_email: pref.user_email,
            application_id: app.id,
            notification_type: notificationType
          });
        
        if (insertError) {
          console.error('Error inserting notification tracking record:', insertError);
          continue;
        }
        
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
      } catch (error) {
        console.error(`Error sending notification to ${pref.user_email}:`, error);
      }
    }
  } catch (error) {
    console.error(`Error sending notifications for user ${userEmail} in app ${app.name}:`, error);
  }
} 