-- Migration 004: Agent Identity Enhancements
-- Adds last_used_at to agents table for first-class developer observability.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_last_used ON agents(organization_id, last_used_at DESC);
