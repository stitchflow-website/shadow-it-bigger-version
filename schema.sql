-- Table for storing signed up users
CREATE TABLE IF NOT EXISTS users_signedup (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS policies for users_signedup table
ALTER TABLE users_signedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read for users_signedup" ON users_signedup
    FOR SELECT USING (true);

CREATE POLICY "Allow insert for users_signedup" ON users_signedup
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update for own record" ON users_signedup
    FOR UPDATE USING (auth.uid()::text = id::text);

-- Add management_status column to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS management_status TEXT CHECK (management_status IN ('Managed', 'Unmanaged', 'Needs Review')) DEFAULT 'Needs Review'; 

-- Add all_scopes column to applications table to store all unique scopes
ALTER TABLE applications ADD COLUMN IF NOT EXISTS all_scopes TEXT[] DEFAULT '{}';

-- Table for tracking sync status
CREATE TABLE IF NOT EXISTS sync_status (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    access_token TEXT,
    refresh_token TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add RLS policies for sync_status table
ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for sync_status" ON sync_status
    FOR SELECT USING (true);

CREATE POLICY "Allow insert for sync_status" ON sync_status
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update for sync_status" ON sync_status
    FOR UPDATE USING (true); 