// Frame — Shared Types

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface PaginationQuery {
  page?: number;
  per_page?: number;
}

// ── Entity Types ──────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  frame_env: 'sandbox' | 'production';
  webhook_url?: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
}

export type UserRole = 'owner' | 'admin' | 'approver' | 'member' | 'readonly';

export interface Agent {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  owner_team?: string;
  purpose?: string;
  frame_env: 'sandbox' | 'production';
  status: AgentStatus;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export type AgentStatus = 'active' | 'disabled' | 'revoked';

export interface AgentCredential {
  id: string;
  agent_id: string;
  organization_id: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface Policy {
  id: string;
  organization_id: string;
  agent_id: string;
  name: string;
  status: 'active' | 'archived';
  current_version_id?: string;
  current_version?: PolicyVersion;
  created_at: string;
  updated_at: string;
}

export interface PolicyVersion {
  id: string;
  policy_id: string;
  version_number: number;
  transaction_limit_paise?: number;
  daily_limit_paise?: number;
  monthly_limit_paise?: number;
  approval_threshold_paise?: number;
  merchant_allowlist?: string[];
  merchant_blocklist?: string[];
  allowed_categories?: string[];
  blocked_categories?: string[];
  max_payments_per_hour?: number;
  max_payments_per_day?: number;
  valid_from?: string;
  expires_at?: string;
  created_at: string;
}

export interface PaymentIntent {
  id: string;
  organization_id: string;
  agent_id: string;
  policy_version_id?: string;
  amount_paise: number;
  currency: string;
  merchant: string;
  merchant_reference?: string;
  purpose: string;
  task_reference?: string;
  intent_hash: string;
  idempotency_key: string;
  status: PaymentIntentStatus;
  decision?: PaymentDecisionResult;
  denial_reason?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export type PaymentIntentStatus =
  | 'CREATED'
  | 'EVALUATING'
  | 'AUTHORIZED'
  | 'EXECUTING'
  | 'SUCCEEDED'
  | 'DENIED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED';

export type PaymentDecisionResult = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface PaymentDecision {
  id: string;
  payment_intent_id: string;
  policy_version_id?: string;
  decision: PaymentDecisionResult;
  reasons: string[];
  risk_level: 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK';
  evaluated_at: string;
}

export interface ApprovalTask {
  id: string;
  payment_intent_id: string;
  organization_id: string;
  required_role: UserRole;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requested_at: string;
  expires_at: string;
  decided_by?: string;
  decided_at?: string;
  comment?: string;
  payment_intent?: PaymentIntent;
}

export interface Payment {
  id: string;
  payment_intent_id: string;
  organization_id: string;
  provider: string;
  provider_payment_id?: string;
  amount_paise: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'unknown';
  provider_status?: string;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  organization_id: string;
  agent_id?: string;
  payment_intent_id?: string;
  payment_id?: string;
  entry_type: 'DEBIT' | 'CREDIT' | 'HOLD' | 'RELEASE' | 'REFUND' | 'FEE';
  amount_paise: number;
  currency: string;
  provider_reference?: string;
  description?: string;
  entry_hash: string;
  recorded_at: string;
}

export interface AuditEvent {
  id: string;
  organization_id: string;
  actor_type: 'user' | 'agent' | 'system';
  actor_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  previous_state?: Record<string, unknown>;
  new_state?: Record<string, unknown>;
  request_id?: string;
  policy_version_id?: string;
  decision?: string;
  occurred_at: string;
}

// ── Auth Types ────────────────────────────────────

export interface JwtPayload {
  sub: string;        // user id
  org: string;        // organization id
  role: UserRole;
  env: 'sandbox' | 'production';
  iat?: number;
  exp?: number;
}

export interface AgentApiKeyPayload {
  agent_id: string;
  organization_id: string;
  credential_id: string;
}
