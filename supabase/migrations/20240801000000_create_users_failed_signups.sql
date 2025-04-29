-- Create table for tracking failed sign-up attempts
CREATE TABLE IF NOT EXISTS public.users_failed_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    name TEXT,
    reason TEXT NOT NULL, -- 'not_workspace_account', 'not_admin', etc.
    provider TEXT NOT NULL, -- 'google', 'microsoft', etc.
    domain TEXT, -- Domain of the email if applicable
    metadata JSONB, -- Additional user data
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- Add indexes
CREATE INDEX IF NOT EXISTS users_failed_signups_email_idx ON public.users_failed_signups (email);
CREATE INDEX IF NOT EXISTS users_failed_signups_provider_idx ON public.users_failed_signups (provider);
CREATE INDEX IF NOT EXISTS users_failed_signups_reason_idx ON public.users_failed_signups (reason);
CREATE INDEX IF NOT EXISTS users_failed_signups_domain_idx ON public.users_failed_signups (domain);

-- Add RLS (Row Level Security) policies
ALTER TABLE public.users_failed_signups ENABLE ROW LEVEL SECURITY;

-- Only allow admins to view this table
CREATE POLICY "Allow admins to view failed signups" 
    ON public.users_failed_signups
    FOR SELECT
    USING (auth.role() = 'authenticated' AND auth.jwt() ->> 'email' IN (
        SELECT email FROM public.users_signedup WHERE is_admin = true
    ));

-- Add comments
COMMENT ON TABLE public.users_failed_signups IS 'Table for tracking failed sign-up attempts';
COMMENT ON COLUMN public.users_failed_signups.reason IS 'Reason for failure: not_workspace_account, not_admin, etc.';
COMMENT ON COLUMN public.users_failed_signups.provider IS 'Authentication provider: google, microsoft, etc.';
COMMENT ON COLUMN public.users_failed_signups.metadata IS 'Additional user data captured during sign-up attempt'; 