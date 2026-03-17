-- One email per external agent — store hash only (never raw email)
ALTER TABLE external_api_keys ADD COLUMN IF NOT EXISTS email_hash TEXT UNIQUE;

-- Keys start inactive until email is verified
ALTER TABLE external_api_keys ALTER COLUMN is_active SET DEFAULT false;

-- Single-use verification tokens (expire in 24h)
CREATE TABLE IF NOT EXISTS email_verifications (
  token      TEXT PRIMARY KEY,
  key_id     TEXT NOT NULL REFERENCES external_api_keys(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verif_key ON email_verifications(key_id);
