-- Create a table to store user credentials for cross-browser authentication
CREATE TABLE IF NOT EXISTS user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  google_id TEXT,
  refresh_token TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS user_credentials_email_idx ON user_credentials(email);
CREATE INDEX IF NOT EXISTS user_credentials_google_id_idx ON user_credentials(google_id);

-- Add comment for documentation
COMMENT ON TABLE user_credentials IS 'Stores user refresh tokens for cross-browser authentication'; 