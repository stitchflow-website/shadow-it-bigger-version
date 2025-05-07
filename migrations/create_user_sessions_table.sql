-- Set the search path to the shadow_it schema
SET search_path TO shadow_it;

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    user_email text NOT NULL,
    auth_provider text NOT NULL CHECK (auth_provider IN ('google', 'microsoft')),
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    id_token text,
    expires_at timestamptz NOT NULL,
    last_active_at timestamptz DEFAULT now(),
    user_agent text,
    ip_address text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_email ON user_sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
CREATE TRIGGER update_user_session_timestamp
BEFORE UPDATE ON user_sessions
FOR EACH ROW
EXECUTE FUNCTION update_user_session_timestamp(); 