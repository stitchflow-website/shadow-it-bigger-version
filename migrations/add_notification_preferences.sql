-- Set the search path to the shadow_it schema
SET search_path TO shadow_it;

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id),
    user_email text NOT NULL,
    new_app_detected boolean DEFAULT true,
    new_user_in_app boolean DEFAULT true,
    new_user_in_review_app boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Create notification_tracking table to track sent notifications
CREATE TABLE IF NOT EXISTS notification_tracking (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id),
    user_email text NOT NULL,
    application_id uuid REFERENCES applications(id),
    notification_type text NOT NULL CHECK (notification_type IN ('new_app', 'new_user', 'new_user_review')),
    sent_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_notification_preferences_org_user ON notification_preferences(organization_id, user_email);
CREATE INDEX IF NOT EXISTS idx_notification_tracking_app_type ON notification_tracking(application_id, notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_tracking_org ON notification_tracking(organization_id); 