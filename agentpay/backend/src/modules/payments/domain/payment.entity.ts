// Payment Domain Entities & Types

export type PaymentIntentStatus =
  | 'CREATED'
  | 'EVALUATING'
  | 'AUTHORIZED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'DENIED'
  | 'EXPIRED'
  | 'EXECUTING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type PaymentExecutionStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'unknown';

export type FirewallDecision =
  | 'ALLOW'
  | 'DENY'
  | 'REQUIRE_APPROVAL';

export type RiskLevel =
  | 'LOW_RISK'
  | 'MEDIUM_RISK'
  | 'HIGH_RISK';

export type PaymentRail =
  | 'upi'
  | 'card'
  | 'bank_transfer'
  | 'mock'
  | 'upi_autopay'
  | 'card_mandate'
  | 'pre_auth';

export interface PaymentIntentRecord {
  id: string;
  organization_id: string;
  agent_id: string;
  policy_version_id: string | null;
  amount_paise: number;
  currency: string;
  merchant: string;
  merchant_reference?: string | null;
  purpose: string;
  task_reference?: string | null;
  intent_hash: string;
  idempotency_key: string;
  status: PaymentIntentStatus;
  decision?: FirewallDecision | null;
  denial_reason?: string | null;
  metadata?: Record<string, unknown>;
  expires_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PaymentRecord {
  id: string;
  payment_intent_id: string;
  organization_id: string;
  provider_config_id?: string | null;
  provider: string;
  provider_payment_id?: string | null;
  amount_paise: number;
  currency: string;
  rail: PaymentRail;
  status: PaymentExecutionStatus;
  provider_status?: string | null;
  provider_metadata?: Record<string, unknown>;
  error_code?: string | null;
  error_description?: string | null;
  settled_at?: Date | string | null;
  reconciled_at?: Date | string | null;
  reconciliation_status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PaymentAttemptRecord {
  id: string;
  payment_id: string;
  attempt_number: number;
  status: PaymentExecutionStatus;
  provider_request?: Record<string, unknown>;
  provider_response?: Record<string, unknown>;
  latency_ms?: number | null;
  error_message?: string | null;
  attempted_at: Date | string;
}
