-- Set the search path to the shadow_it schema
SET search_path TO shadow_it;

-- Create categorization_status table
CREATE TABLE IF NOT EXISTS categorization_status (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id),
    status text NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'ERROR')),
    progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    message text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
); 