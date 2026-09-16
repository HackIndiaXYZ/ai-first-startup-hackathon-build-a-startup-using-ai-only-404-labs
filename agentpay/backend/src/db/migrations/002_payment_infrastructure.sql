-- Frame — Migration 002: Payment Infrastructure & Provider Configuration

-- 1. Provider Configurations Table
CREATE TABLE IF NOT EXISTS provider_configs (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type VARCHAR(50) NOT NULL, -- 'mock' | 'sandbox_upi' | 'razorpay' | 'cashfree'
  name VARCHAR(255) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  credentials_encrypted TEXT, -- Encrypted JSON credentials
  webhook_secret TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, provider_type)
);

-- 2. Enhance Payments Table with Provider & Rail Tracking
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS provider_config_id VARCHAR(26) REFERENCES provider_configs(id),
  ADD COLUMN IF NOT EXISTS rail VARCHAR(20) NOT NULL DEFAULT 'upi',
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS error_description TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR(30) DEFAULT 'unreconciled';

-- 3. Enhance Payment Attempts Table
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS provider_request JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

-- 4. Reconciliation Runs Table
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed', -- 'running' | 'completed' | 'failed'
  total_checked INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  discrepancy_count INTEGER NOT NULL DEFAULT 0,
  details JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 5. Indexes for High-Performance State & Idempotency Lookups
CREATE INDEX IF NOT EXISTS idx_payments_reconciliation ON payments(organization_id, reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_provider_configs_org ON provider_configs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_created_status ON payments(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_org_key ON idempotency_keys(organization_id, key_value);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_payment_entry_type ON ledger_entries(payment_id, entry_type);
