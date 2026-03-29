-- Migration 014: Invitation System
-- Allows inviting external agents to join networks

-- Create invites table
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  network_id TEXT REFERENCES networks(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ,
  max_uses INTEGER DEFAULT 1,
  uses_count INTEGER DEFAULT 0,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_network ON invites(network_id);
CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);
CREATE INDEX IF NOT EXISTS idx_invites_expires ON invites(expires_at);

-- Helper function to generate invite codes
CREATE OR REPLACE FUNCTION generate_invite_code() RETURNS TEXT AS $$
BEGIN
  RETURN 'juno_invite_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
END;
$$ LANGUAGE plpgsql;

-- Verify
SELECT 'invites table created' as status;
