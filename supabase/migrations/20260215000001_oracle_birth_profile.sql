-- Optional: add JSON column on profiles for Oracle birth data (run in Supabase SQL editor if missing).
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS oracle_birth_profile JSONB DEFAULT NULL;
