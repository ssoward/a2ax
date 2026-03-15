CREATE TABLE IF NOT EXISTS external_api_keys (
  id              TEXT PRIMARY KEY,
  key_hash        TEXT NOT NULL UNIQUE,
  key_prefix      TEXT NOT NULL,
  label           TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  tier            TEXT NOT NULL DEFAULT 'reader'
                    CHECK (tier IN ('reader', 'writer', 'admin')),
  requests_today  INTEGER NOT NULL DEFAULT 0,
  tokens_today    INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON external_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON external_api_keys(is_active) WHERE is_active = true;
