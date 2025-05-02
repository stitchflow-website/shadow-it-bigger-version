-- Ensure user_applications has created_at with the right defaults
-- This ensures that if the created_at field is not explicitly set during insert, the current time will be used

-- Check if the created_at column exists, if not create it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_applications' AND column_name = 'created_at'
    ) THEN
        -- Add created_at column if it doesn't exist
        ALTER TABLE user_applications ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
    ELSE
        -- If column exists, ensure it has the correct default
        ALTER TABLE user_applications ALTER COLUMN created_at SET DEFAULT now();
    END IF;
END$$;

-- Add a comment explaining what this field represents
COMMENT ON COLUMN user_applications.created_at IS 'Date when the user first authorized the application (token creation date from Google/Microsoft)';

-- For existing records where the created_at is the same as updated_at,
-- update it to be a bit earlier to avoid confusion
UPDATE user_applications 
SET created_at = updated_at - interval '1 minute'
WHERE created_at = updated_at
AND created_at IS NOT NULL
AND updated_at IS NOT NULL;

-- For records where the created_at is after the updated_at, 
-- set created_at to be the updated_at - 1 minute
UPDATE user_applications 
SET created_at = updated_at - interval '1 minute'
WHERE created_at > updated_at
AND created_at IS NOT NULL
AND updated_at IS NOT NULL; 