ALTER TABLE shadow_it.sync_status ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE shadow_it.sync_status ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMPTZ;
