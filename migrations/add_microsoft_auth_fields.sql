-- Add Microsoft fields to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS microsoft_user_id text,
ADD COLUMN IF NOT EXISTS microsoft_access_token text,
ADD COLUMN IF NOT EXISTS microsoft_refresh_token text,
ADD COLUMN IF NOT EXISTS microsoft_id_token text;

-- Add Microsoft app ID field to applications table
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS microsoft_app_id text,
ADD COLUMN IF NOT EXISTS user_count integer DEFAULT 0;

-- Create index for Microsoft user ID
CREATE INDEX IF NOT EXISTS idx_users_microsoft_user_id ON users(microsoft_user_id);

-- Create index for Microsoft app ID
CREATE INDEX IF NOT EXISTS idx_applications_microsoft_app_id ON applications(microsoft_app_id); 