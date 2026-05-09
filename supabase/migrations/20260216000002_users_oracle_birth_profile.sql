-- Oracle birth sketch (JSON). Run in dashboard SQL editor if migration not applied yet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oracle_birth_profile JSONB;
