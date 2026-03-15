-- Rename simulations table and scenario column to networks/topic
ALTER TABLE simulations RENAME TO networks;
ALTER TABLE networks RENAME COLUMN scenario TO topic;

-- Rename simulation_id foreign key columns in all tables
ALTER TABLE agents      RENAME COLUMN simulation_id TO network_id;
ALTER TABLE posts       RENAME COLUMN simulation_id TO network_id;
ALTER TABLE interactions RENAME COLUMN simulation_id TO network_id;
ALTER TABLE agent_ticks RENAME COLUMN simulation_id TO network_id;

-- Update indexes (recreate with new names)
DROP INDEX IF EXISTS idx_agents_simulation;
DROP INDEX IF EXISTS idx_posts_simulation;
DROP INDEX IF EXISTS idx_interactions_simulation;
DROP INDEX IF EXISTS idx_ticks_simulation;

CREATE INDEX IF NOT EXISTS idx_agents_network      ON agents(network_id);
CREATE INDEX IF NOT EXISTS idx_posts_network       ON posts(network_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_network ON interactions(network_id);
CREATE INDEX IF NOT EXISTS idx_ticks_network       ON agent_ticks(network_id, tick_number);
