// Payment Authority Domain Entity
// Represents delegated financial authorization granted by a human principal to an AI agent.

export type AuthorityStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface PaymentAuthorityRecord {
  id: string;
  organization_id: string;
  user_id: string;
  agent_id: string;
  provider: string;
  rail: string;
  currency: string;
  max_transaction_amount_paise: number;
  daily_limit_paise: number;
  monthly_limit_paise: number;
  spent_today_paise: number;
  spent_this_month_paise: number;
  last_reset_date: string;
  last_reset_month: string;
  allowed_categories: string[];
  blocked_categories: string[];
  allowed_merchants: string[];
  blocked_merchants: string[];
  purpose?: string | null;
  valid_from: Date | string;
  valid_until: Date | string;
  requires_approval_above_paise?: number | null;
  status: AuthorityStatus;
  provider_reference?: string | null;
  revocation_reason?: string | null;
  created_at: Date | string;
  revoked_at?: Date | string | null;
  updated_at: Date | string;
}

export interface CreateAuthorityInput {
  organizationId: string;
  userId: string;
  agentId: string;
  provider?: string;
  rail?: string;
  currency?: string;
  maxTransactionAmountPaise: number;
  dailyLimitPaise: number;
  monthlyLimitPaise: number;
  allowedCategories?: string[];
  blockedCategories?: string[];
  allowedMerchants?: string[];
  blockedMerchants?: string[];
  purpose?: string;
  validFrom?: Date | string;
  validUntil: Date | string;
  requiresApprovalAbovePaise?: number;
  providerReference?: string;
}
