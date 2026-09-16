-- Migration 003: Payment Authorities for Delegated Agentic Spend
-- Introduces first-class delegated authorization granted by human users/admins to AI agents.

CREATE TABLE IF NOT EXISTS payment_authorities (
    id VARCHAR(26) PRIMARY KEY,
    organization_id VARCHAR(26) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(26) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id VARCHAR(26) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'mock',
    rail VARCHAR(50) NOT NULL DEFAULT 'upi_autopay',
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    max_transaction_amount_paise BIGINT NOT NULL,
    daily_limit_paise BIGINT NOT NULL,
    monthly_limit_paise BIGINT NOT NULL,
    spent_today_paise BIGINT NOT NULL DEFAULT 0,
    spent_this_month_paise BIGINT NOT NULL DEFAULT 0,
    last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    last_reset_month VARCHAR(7) NOT NULL DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
    allowed_categories TEXT[] NOT NULL DEFAULT '{}',
    blocked_categories TEXT[] NOT NULL DEFAULT '{}',
    allowed_merchants TEXT[] NOT NULL DEFAULT '{}',
    blocked_merchants TEXT[] NOT NULL DEFAULT '{}',
    purpose TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL,
    requires_approval_above_paise BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    provider_reference VARCHAR(255),
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_authorities_org_agent ON payment_authorities(organization_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_authorities_valid_until ON payment_authorities(valid_until);
CREATE INDEX IF NOT EXISTS idx_payment_authorities_status ON payment_authorities(status);
