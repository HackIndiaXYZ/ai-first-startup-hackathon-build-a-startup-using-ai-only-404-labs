-- Frame — Initial Database Schema
-- All monetary amounts in paise (integer), all timestamps in UTC

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- ORGANIZATIONS & USERS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(26) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  frame_env VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  -- Roles: owner | admin | approver | member | readonly
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AGENTS & CREDENTIALS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_team VARCHAR(255),
  purpose TEXT,
  frame_env VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Status: active | disabled | revoked
  created_by VARCHAR(26) REFERENCES users(id),
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id VARCHAR(26) PRIMARY KEY,
  agent_id VARCHAR(26) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_prefix VARCHAR(20) NOT NULL,
  key_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Status: active | revoked
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by VARCHAR(26) REFERENCES users(id)
);

-- ─────────────────────────────────────────
-- POLICIES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policies (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id VARCHAR(26) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Status: active | archived
  current_version_id VARCHAR(26),
  created_by VARCHAR(26) REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id VARCHAR(26) PRIMARY KEY,
  policy_id VARCHAR(26) NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  -- Budget limits (NULL = unlimited)
  transaction_limit_paise BIGINT,
  daily_limit_paise BIGINT,
  monthly_limit_paise BIGINT,
  -- Approval threshold
  approval_threshold_paise BIGINT,
  -- Merchant rules
  merchant_allowlist TEXT[],
  merchant_blocklist TEXT[],
  -- Category rules
  allowed_categories TEXT[],
  blocked_categories TEXT[],
  -- Frequency
  max_payments_per_hour INTEGER,
  max_payments_per_day INTEGER,
  -- Time bounds
  valid_from TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  -- Metadata
  created_by VARCHAR(26) REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(policy_id, version_number)
);

-- Note: current_version_id references policy_versions(id) enforced in application logic

-- ─────────────────────────────────────────
-- PAYMENT INTENTS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_intents (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  agent_id VARCHAR(26) NOT NULL REFERENCES agents(id),
  policy_version_id VARCHAR(26) REFERENCES policy_versions(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  merchant VARCHAR(255) NOT NULL,
  merchant_reference VARCHAR(255),
  purpose TEXT NOT NULL,
  task_reference VARCHAR(255),
  intent_hash TEXT NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  -- States: CREATED | EVALUATING | AUTHORIZED | EXECUTING | SUCCEEDED | DENIED | PENDING_APPROVAL | REJECTED | FAILED | EXPIRED
  decision VARCHAR(20),
  -- Decision: ALLOW | DENY | REQUIRE_APPROVAL
  denial_reason TEXT,
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_decisions (
  id VARCHAR(26) PRIMARY KEY,
  payment_intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  policy_version_id VARCHAR(26) REFERENCES policy_versions(id),
  decision VARCHAR(20) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]',
  risk_level VARCHAR(20) DEFAULT 'LOW_RISK',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- APPROVALS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_tasks (
  id VARCHAR(26) PRIMARY KEY,
  payment_intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  required_role VARCHAR(50) NOT NULL DEFAULT 'approver',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Status: pending | approved | rejected | expired
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_by VARCHAR(26) REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  comment TEXT
);

-- ─────────────────────────────────────────
-- PAYMENTS & PROVIDER
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(26) PRIMARY KEY,
  payment_intent_id VARCHAR(26) NOT NULL REFERENCES payment_intents(id),
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  provider VARCHAR(50) NOT NULL DEFAULT 'mock',
  provider_payment_id VARCHAR(255),
  amount_paise BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Status: pending | processing | succeeded | failed | unknown
  provider_status VARCHAR(100),
  provider_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id VARCHAR(26) PRIMARY KEY,
  payment_id VARCHAR(26) NOT NULL REFERENCES payments(id),
  attempt_number INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_response JSONB DEFAULT '{}',
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_events (
  id VARCHAR(26) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  raw_payload JSONB NOT NULL,
  signature TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  payment_id VARCHAR(26) REFERENCES payments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, event_id)
);

-- ─────────────────────────────────────────
-- LEDGER
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_entries (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  agent_id VARCHAR(26) REFERENCES agents(id),
  payment_intent_id VARCHAR(26) REFERENCES payment_intents(id),
  payment_id VARCHAR(26) REFERENCES payments(id),
  entry_type VARCHAR(50) NOT NULL,
  -- Types: DEBIT | CREDIT | HOLD | RELEASE | REFUND | FEE
  amount_paise BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  provider_reference VARCHAR(255),
  description TEXT,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AUDIT
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  actor_type VARCHAR(20) NOT NULL DEFAULT 'system',
  -- actor_type: user | agent | system
  actor_id VARCHAR(26),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  previous_state JSONB,
  new_state JSONB,
  request_id VARCHAR(100),
  policy_version_id VARCHAR(26),
  decision VARCHAR(20),
  ip_address TEXT,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- WEBHOOKS & IDEMPOTENCY
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  payment_intent_id VARCHAR(26) REFERENCES payment_intents(id),
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Status: pending | delivered | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id VARCHAR(26) PRIMARY KEY,
  organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id),
  key_value VARCHAR(255) NOT NULL,
  request_path VARCHAR(255),
  request_hash TEXT,
  response_status INTEGER,
  response_body JSONB,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, key_value)
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(organization_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_credentials_agent ON agent_credentials(agent_id);
CREATE INDEX IF NOT EXISTS idx_credentials_active ON agent_credentials(key_prefix, status);
CREATE INDEX IF NOT EXISTS idx_policies_agent ON policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_policy_versions_policy ON policy_versions(policy_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_org ON payment_intents(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_agent ON payment_intents(agent_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_created ON payment_intents(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_tasks_org_status ON approval_tasks(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_tasks_intent ON approval_tasks(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_provider_events_processed ON provider_events(processed);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_org ON ledger_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_intent ON ledger_entries(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred ON audit_events(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status, next_attempt_at);
