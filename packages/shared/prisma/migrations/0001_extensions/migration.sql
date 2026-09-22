-- 0001_extensions — extensiones y helper de updatedAt (specs/14 §2)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- búsqueda por título de sala
CREATE EXTENSION IF NOT EXISTS "citext";     -- email case-insensitive

CREATE OR REPLACE FUNCTION "setUpdatedAt"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
