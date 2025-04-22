-- Set the search path to the shadow_it schema
SET search_path TO shadow_it;

-- Create sync_status table
CREATE TABLE IF NOT EXISTS sync_status (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id),
    user_email text NOT NULL,
    status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
    progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    message text,
    access_token text,
    refresh_token text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
); 