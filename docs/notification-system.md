# Shadow IT Notification System

This document explains how the Shadow IT notification system works and how to set it up.

## Overview

The Shadow IT notification system has three main components:

1. **User Preferences**: Users can choose which notifications they want to receive
2. **Notification Tracking**: Tracks which notifications have been sent
3. **Notification Cron Job**: Background process that checks for new apps and users and sends notifications

## Notification Types

The system supports three types of notifications:

1. **New App Detection**: Notifies when a new application is detected in the organization
2. **New User in App**: Notifies when a new user is added to any application
3. **New User in Review App**: Notifies when a new user is added to an application marked as "Needs Review"

## Database Schema

The system uses two primary tables:

1. `notification_preferences` - Stores user notification preferences
   - `id`: UUID primary key
   - `organization_id`: Organization UUID
   - `user_email`: User's email 
   - `new_app_detected`: Boolean flag for new app notifications
   - `new_user_in_app`: Boolean flag for new user notifications
   - `new_user_in_review_app`: Boolean flag for new user in review app notifications
   - `created_at`: Timestamp
   - `updated_at`: Timestamp

2. `notification_tracking` - Tracks sent notifications
   - `id`: UUID primary key
   - `organization_id`: Organization UUID
   - `user_email`: User's email
   - `application_id`: Application UUID
   - `notification_type`: Type of notification sent
   - `sent_at`: Timestamp

## Email Service

The system uses [Loops](https://loops.so) to send transactional emails. Three email templates are required:

1. `NEW_APP_TEMPLATE_ID` - Template for new app notifications
2. `NEW_USER_TEMPLATE_ID` - Template for new user notifications
3. `NEW_USER_REVIEW_TEMPLATE_ID` - Template for new user in review app notifications

These template IDs must be set in the environment variables.

## Environment Variables

The following environment variables are required:

```
LOOPS_API_KEY=your_loops_api_key
NEW_APP_TEMPLATE_ID=your_new_app_template_id
NEW_USER_TEMPLATE_ID=your_new_user_template_id
NEW_USER_REVIEW_TEMPLATE_ID=your_new_user_review_template_id
CRON_SECRET=your_cron_job_secret_key
```

## Cron Job Setup

The notification system requires a cron job to run periodically. We use [Render](https://render.com) for this purpose.

1. Go to your Render Dashboard
2. Create a new Cron Job
3. Set the schedule (recommended: every hour)
4. Set the command to:
   ```bash
   curl -X POST https://your-domain.com/api/background/check-notifications \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json"
   ```
5. Add the `CRON_SECRET` environment variable with your secret key

## Implementation Details

### When User Signs Up

When a user successfully signs in through Google or Microsoft auth, default notification preferences are created:

```typescript
// Create default notification preferences for the user
try {
  await fetch('/api/auth/create-default-preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      orgId: org.id,
      userEmail: userInfo.email
    })
  });
} catch (error) {
  console.error('Error creating default notification preferences:', error);
}
```

### Settings UI

Users can change their notification preferences through the Settings UI, which shows toggle switches for each notification type.

### Cron Job Process

The cron job performs these steps:

1. Authenticates the request using the `CRON_SECRET`
2. Processes new app notifications:
   - Finds apps created in the last 24 hours
   - Checks for users with new app notifications enabled
   - Sends notifications for new apps
3. Processes new user notifications:
   - Finds user-app relationships created in the last 24 hours
   - Checks for users with new user notifications enabled
   - Sends notifications for new users
4. Processes new user in review app notifications:
   - Finds user-app relationships for "Needs Review" apps created in the last 24 hours
   - Checks for users with review app notifications enabled
   - Sends notifications for new users in review apps

## Debugging

To debug notification issues:

1. Check the notification_tracking table for sent notifications
2. Check the notification_preferences table for user preferences
3. Check server logs for any errors in the cron job
4. Verify that the Loops API key and template IDs are correctly set
5. Test sending a notification manually using the Email Service

## API Endpoints

- `GET /api/user/notification-preferences` - Gets the current user's notification preferences
- `POST /api/user/notification-preferences` - Updates the current user's notification preferences
- `POST /api/auth/create-default-preferences` - Creates default notification preferences for a user
- `POST /api/background/check-notifications` - Endpoint for the cron job to check and send notifications