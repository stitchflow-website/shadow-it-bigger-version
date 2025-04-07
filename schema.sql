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