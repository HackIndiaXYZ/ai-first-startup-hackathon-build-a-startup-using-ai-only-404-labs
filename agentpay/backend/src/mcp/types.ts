export interface FrameMcpConfig {
  apiUrl: string;
  agentApiKey?: string;
}

export interface CreatePaymentIntentInput {
  amount?: number; // In rupees/major units (e.g. 2499)
  amount_paise?: number; // In paise/minor units (e.g. 249900)
  currency?: string;
  merchant: string;
  merchant_reference?: string;
  purpose: string;
  category?: string;
  idempotency_key: string;
  metadata?: Record<string, unknown>;
  agent_api_key?: string;
  // Explicitly disallow sensitive fields
  pin?: never;
  upi_pin?: never;
  otp?: never;
  cvv?: never;
  password?: never;
  card_pin?: never;
}

export interface GetPaymentStatusInput {
  payment_intent_id: string;
  agent_api_key?: string;
}

export interface GetPaymentIntentInput {
  payment_intent_id: string;
  agent_api_key?: string;
}

export interface RequestApprovalInput {
  payment_intent_id: string;
  notes?: string;
  agent_api_key?: string;
}

export type McpPolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface McpCreateIntentResponse {
  payment_intent_id: string;
  decision: McpPolicyDecision;
  status: string;
  amount: number;
  currency: string;
  merchant: string;
  next_action: 'PAYMENT_EXECUTION' | 'WAIT_FOR_APPROVAL' | 'DO_NOT_RETRY';
  reason_code?: string;
  reasons?: string[];
  approval_task_id?: string;
}

export interface McpPaymentStatusResponse {
  payment_intent_id: string;
  status: string;
  decision: string;
  approval_state: string | null;
  payment_state?: string | null;
  next_action: string;
  error?: string | null;
}

export interface McpSafeIntentResponse {
  id: string;
  organization_id: string;
  agent_id: string;
  amount: number;
  amount_paise: number;
  currency: string;
  merchant: string;
  merchant_reference: string | null;
  purpose: string;
  category: string | null;
  status: string;
  decision: string | null;
  denial_reason: string | null;
  approval_status: string | null;
  approval_task_id: string | null;
  created_at: string;
  expires_at: string;
  metadata?: Record<string, unknown>;
}

export interface McpApprovalResponse {
  payment_intent_id: string;
  decision: 'REQUIRE_APPROVAL';
  status: string;
  approval_task_id: string;
  approval_status: string;
  expires_at: string;
  next_action: 'WAIT_FOR_APPROVAL';
  message: string;
}

export interface ListPaymentAuthoritiesInput {
  status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
  agent_api_key?: string;
}

export interface GetPaymentAuthorityInput {
  authority_id: string;
  agent_api_key?: string;
}

export interface McpAuthorityResponse {
  id: string;
  agent_id: string;
  provider: string;
  rail: string;
  currency: string;
  max_transaction_amount: number;
  daily_limit: number;
  monthly_limit: number;
  spent_today: number;
  spent_this_month: number;
  remaining_daily: number;
  remaining_monthly: number;
  allowed_categories: string[];
  blocked_categories: string[];
  allowed_merchants: string[];
  blocked_merchants: string[];
  purpose: string | null;
  valid_from: string;
  valid_until: string;
  requires_approval_above: number | null;
  status: string;
}

