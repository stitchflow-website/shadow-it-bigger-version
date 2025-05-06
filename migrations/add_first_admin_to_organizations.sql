-- Add first_admin column to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS first_admin TEXT;

-- Add comment to the column
COMMENT ON COLUMN organizations.first_admin IS 'Email of the first admin user who signed up from this organization'; 