import { z } from 'zod';
import {
  FrameMcpConfig,
  McpCreateIntentResponse,
  McpPaymentStatusResponse,
  McpSafeIntentResponse,
  McpApprovalResponse,
  McpAuthorityResponse,
} from './types';

// Prohibited sensitive keys that MUST never be accepted from an AI agent
const PROHIBITED_KEYS = [
  'pin',
  'upi_pin',
  'upipin',
  'otp',
  'cvv',
  'cvc',
  'password',
  'bank_password',
  'card_pin',
  'secret',
  'provider_secret',
  'private_key',
];

export class McpSecurityError extends Error {
  code: string;
  retryable: boolean;
  next_action: string;
  constructor(code: string, message: string, retryable = false, next_action = 'DO_NOT_RETRY') {
    super(message);
    this.name = 'McpSecurityError';
    this.code = code;
    this.retryable = retryable;
    this.next_action = next_action;
  }
}

/**
 * Recursively scans any input object to detect and reject sensitive payment credentials.
 */
export function assertNoSensitiveCredentials(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    for (const prohibited of PROHIBITED_KEYS) {
      if (normalizedKey === prohibited || normalizedKey.includes(prohibited)) {
        throw new McpSecurityError(
          'SENSITIVE_CREDENTIAL_REJECTED',
          `Security rejection: Field '${key}' contains sensitive payment credential data. Frame strictly prohibits AI agents from handling PINs, OTPs, CVVs, or passwords.`
        );
      }
    }

    if (value && typeof value === 'object') {
      assertNoSensitiveCredentials(value, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Resolves the agent API key from tool arguments, config, or process.env
 */
export function resolveApiKey(providedKey?: string, configApiKey?: string): string {
  const key = providedKey || configApiKey || process.env.FRAME_AGENT_API_KEY;
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new McpSecurityError(
      'UNAUTHORIZED',
      'Agent API key required. Pass "agent_api_key" in tool arguments or configure FRAME_AGENT_API_KEY environment variable.'
    );
  }
  return key.trim();
}

/**
 * Tool Schemas for MCP Registration
 */
export const CreatePaymentIntentSchema = z.object({
  amount: z.number().positive().optional().describe('Amount in currency units (e.g. 2499 or 2499.50)'),
  amount_paise: z.number().int().positive().optional().describe('Amount in paise/minor units (e.g. 249900)'),
  currency: z.string().default('INR').describe('ISO currency code (default: INR)'),
  merchant: z.string().min(1).max(255).describe('Name of the merchant or payee (e.g. "Amazon")'),
  merchant_reference: z.string().max(255).optional().describe('Optional order or merchant invoice reference'),
  order_reference: z.string().max(255).optional().describe('Merchant checkout order or invoice reference'),
  purpose: z.string().min(1).max(1000).describe('Description of what is being purchased'),
  category: z.string().max(100).optional().describe('Spending category (e.g. "electronics", "saas")'),
  idempotency_key: z.string().min(1).max(255).describe('Unique client idempotency key to prevent duplicate payments'),
  metadata: z.record(z.unknown()).optional().describe('Arbitrary non-sensitive key-value metadata'),
  agent_api_key: z.string().optional().describe('Frame Agent API key (starts with frm_). Defaults to env variable.'),
});

export const GetPaymentStatusSchema = z.object({
  payment_intent_id: z.string().min(1).describe('The unique payment intent ID to inspect'),
  agent_api_key: z.string().optional().describe('Frame Agent API key. Defaults to env variable.'),
});

export const GetPaymentIntentSchema = z.object({
  payment_intent_id: z.string().min(1).describe('The unique payment intent ID to retrieve'),
  agent_api_key: z.string().optional().describe('Frame Agent API key. Defaults to env variable.'),
});

export const RequestApprovalSchema = z.object({
  payment_intent_id: z.string().min(1).describe('The payment intent ID currently in PENDING_APPROVAL status'),
  notes: z.string().max(1000).optional().describe('Optional justification or urgency notes for the human approver'),
  action: z.string().optional().describe('Prohibited: Agents cannot pass approval actions'),
  agent_api_key: z.string().optional().describe('Frame Agent API key. Defaults to env variable.'),
});

export const ListPaymentAuthoritiesSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED']).optional().describe('Filter by authority status'),
  agent_api_key: z.string().optional().describe('Frame Agent API key. Defaults to env variable.'),
});

export const GetPaymentAuthoritySchema = z.object({
  authority_id: z.string().min(1).describe('The unique payment authority ID to inspect'),
  agent_api_key: z.string().optional().describe('Frame Agent API key. Defaults to env variable.'),
});

/**
 * MCP Tools Implementation Class
 */
export class FrameMcpTools {
  private apiUrl: string;
  private defaultApiKey?: string;

  constructor(config: FrameMcpConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.defaultApiKey = config.agentApiKey;
  }

  /**
   * 1. frame_create_payment_intent
   */
  async createPaymentIntent(args: unknown): Promise<McpCreateIntentResponse> {
    assertNoSensitiveCredentials(args);

    const input = CreatePaymentIntentSchema.parse(args);
    const apiKey = resolveApiKey(input.agent_api_key, this.defaultApiKey);

    // Compute amount_paise
    let amountPaise: number;
    if (typeof input.amount_paise === 'number' && input.amount_paise > 0) {
      amountPaise = input.amount_paise;
    } else if (typeof input.amount === 'number' && input.amount > 0) {
      amountPaise = Math.round(input.amount * 100);
    } else {
      throw new McpSecurityError(
        'INVALID_AMOUNT',
        'Either "amount" (e.g. 2499) or "amount_paise" (e.g. 249900) must be provided as a positive number.'
      );
    }

    const merchantRef = input.merchant_reference || input.order_reference;

    const payload = {
      amount_paise: amountPaise,
      currency: input.currency || 'INR',
      merchant: input.merchant,
      merchant_reference: merchantRef,
      purpose: input.purpose,
      category: input.category,
      idempotency_key: input.idempotency_key,
      metadata: input.metadata || {},
    };

    const response = await fetch(`${this.apiUrl}/payment-intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = body.error || {};
      throw new McpSecurityError(
        err.code || `HTTP_${response.status}`,
        err.message || `Payment intent creation failed with HTTP ${response.status}`,
        err.retryable ?? false,
        err.next_action ?? (response.status >= 500 ? 'RETRY_LATER' : 'DO_NOT_RETRY')
      );
    }

    const intent = body.data;
    const firewall = intent.firewall || {};
    const decision = firewall.decision || intent.decision || 'ALLOW';

    let nextAction: 'PAYMENT_EXECUTION' | 'WAIT_FOR_APPROVAL' | 'DO_NOT_RETRY' = 'PAYMENT_EXECUTION';
    if (decision === 'REQUIRE_APPROVAL' || intent.status === 'PENDING_APPROVAL') {
      nextAction = 'WAIT_FOR_APPROVAL';
    } else if (decision === 'DENY' || intent.status === 'DENIED') {
      nextAction = 'DO_NOT_RETRY';
    }

    return {
      payment_intent_id: intent.id,
      decision,
      status: intent.status,
      amount: intent.amount_paise / 100,
      currency: intent.currency,
      merchant: intent.merchant,
      next_action: nextAction,
      reason_code: intent.denial_reason || undefined,
      reasons: firewall.reasons || (intent.denial_reason ? [intent.denial_reason] : []),
      approval_task_id: intent.approval_task_id || undefined,
    };
  }

  /**
   * 2. frame_get_payment_status
   */
  async getPaymentStatus(args: unknown): Promise<McpPaymentStatusResponse> {
    assertNoSensitiveCredentials(args);

    const input = GetPaymentStatusSchema.parse(args);
    const apiKey = resolveApiKey(input.agent_api_key, this.defaultApiKey);

    const response = await fetch(`${this.apiUrl}/payment-intents/${input.payment_intent_id}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = body.error || {};
      throw new McpSecurityError(
        err.code || `HTTP_${response.status}`,
        err.message || `Failed to fetch payment status: ${response.statusText}`
      );
    }

    const intent = body.data;
    const decision = intent.firewall_decision || intent.decision || 'UNKNOWN';

    let nextAction = 'IN_PROGRESS';
    if (['COMPLETED', 'SETTLED', 'SUCCEEDED'].includes(intent.status)) {
      nextAction = 'NONE';
    } else if (intent.status === 'PENDING_APPROVAL') {
      nextAction = 'WAIT_FOR_APPROVAL';
    } else if (['DENIED', 'REJECTED', 'FAILED'].includes(intent.status)) {
      nextAction = 'DO_NOT_RETRY';
    } else if (intent.status === 'AUTHORIZED' || intent.status === 'EXECUTING') {
      nextAction = 'PAYMENT_EXECUTION';
    }

    return {
      payment_intent_id: intent.id,
      status: intent.status,
      decision,
      approval_state: intent.approval_status || null,
      payment_state: intent.provider_status || null,
      next_action: nextAction,
      error: intent.denial_reason || null,
    };
  }

  /**
   * 3. frame_get_payment_intent
   */
  async getPaymentIntent(args: unknown): Promise<McpSafeIntentResponse> {
    assertNoSensitiveCredentials(args);

    const input = GetPaymentIntentSchema.parse(args);
    const apiKey = resolveApiKey(input.agent_api_key, this.defaultApiKey);

    const response = await fetch(`${this.apiUrl}/payment-intents/${input.payment_intent_id}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = body.error || {};
      throw new McpSecurityError(
        err.code || `HTTP_${response.status}`,
        err.message || `Failed to fetch payment intent: ${response.statusText}`
      );
    }

    const intent = body.data;

    return {
      id: intent.id,
      organization_id: intent.organization_id,
      agent_id: intent.agent_id,
      amount: intent.amount_paise / 100,
      amount_paise: intent.amount_paise,
      currency: intent.currency,
      merchant: intent.merchant,
      merchant_reference: intent.merchant_reference || null,
      purpose: intent.purpose,
      category: intent.category || null,
      status: intent.status,
      decision: intent.firewall_decision || intent.decision || null,
      denial_reason: intent.denial_reason || null,
      approval_status: intent.approval_status || null,
      approval_task_id: intent.approval_task_id || null,
      created_at: intent.created_at,
      expires_at: intent.expires_at,
      metadata: intent.metadata || {},
    };
  }

  /**
   * 4. frame_request_approval
   */
  async requestApproval(args: unknown): Promise<McpApprovalResponse> {
    assertNoSensitiveCredentials(args);

    const input = RequestApprovalSchema.parse(args);
    if (input.action && (input.action.toLowerCase() === 'approve' || input.action.toLowerCase() === 'reject')) {
      throw new McpSecurityError(
        'UNAUTHORIZED_APPROVAL_ATTEMPT',
        'Agents are strictly forbidden from approving or rejecting payments. Human approval is mandatory.'
      );
    }

    const apiKey = resolveApiKey(input.agent_api_key, this.defaultApiKey);

    const response = await fetch(`${this.apiUrl}/payment-intents/${input.payment_intent_id}/request-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ notes: input.notes }),
    });

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = body.error || {};
      throw new McpSecurityError(
        err.code || `HTTP_${response.status}`,
        err.message || `Approval request failed: ${response.statusText}`
      );
    }

    return body.data;
  }

  /**
   * 5. frame_list_payment_authorities
   */
  async listPaymentAuthorities(args: unknown): Promise<McpAuthorityResponse[]> {
    assertNoSensitiveCredentials(args);
    const input = ListPaymentAuthoritiesSchema.parse(args || {});
    const apiKey = resolveApiKey(input.agent_api_key, this.defaultApiKey);

    let url = `${this.apiUrl}/payment-authorities`;
    if (input.status) {
      url += `?status=${input.status}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = body.error || {};
      throw new McpSecurityError(
        err.code || `HTTP_${response.status}`,
        err.message || `Failed to list authorities: ${response.statusText}`
      );
    }

    const authorities: any[] = body.data || [];
    return authorities.map(a => ({
      id: a.id,
      agent_id: a.agent_id,
      provider: a.provider,
      rail: a.rail,
      currency: a.currency,
      max_transaction_amount: Number(a.max_transaction_amount_paise) / 100,
      daily_limit: Number(a.daily_limit_paise) / 100,
      monthly_limit: Number(a.monthly_limit_paise) / 100,
      spent_today: Number(a.spent_today_paise) / 100,
      spent_this_month: Number(a.spent_this_month_paise) / 100,
      remaining_daily: Math.max(0, (Number(a.daily_limit_paise) - Number(a.spent_today_paise)) / 100),
      remaining_monthly: Math.max(0, (Number(a.monthly_limit_paise) - Number(a.spent_this_month_paise)) / 100),
      allowed_categories: a.allowed_categories || [],
      blocked_categories: a.blocked_categories || [],
      allowed_merchants: a.allowed_merchants || [],
      blocked_merchants: a.blocked_merchants || [],
      purpose: a.purpose || null,
      valid_from: a.valid_from,
      valid_until: a.valid_until,
      requires_approval_above: a.requires_approval_above_paise ? Number(a.requires_approval_above_paise) / 100 : null,
      status: a.status,
    }));
  }

  /**
   * 6. frame_get_payment_authority
   */
  async getPaymentAuthority(args: unknown): Promise<McpAuthorityResponse> {
    assertNoSensitiveCredentials(args);
    const input = GetPaymentAuthoritySchema.parse(args);
    const apiKey = resolveApiKey(input.agent_api_key, this.defaultApiKey);

    const response = await fetch(`${this.apiUrl}/payment-authorities/${input.authority_id}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = body.error || {};
      throw new McpSecurityError(
        err.code || `HTTP_${response.status}`,
        err.message || `Failed to get authority: ${response.statusText}`
      );
    }

    const a = body.data;
    return {
      id: a.id,
      agent_id: a.agent_id,
      provider: a.provider,
      rail: a.rail,
      currency: a.currency,
      max_transaction_amount: Number(a.max_transaction_amount_paise) / 100,
      daily_limit: Number(a.daily_limit_paise) / 100,
      monthly_limit: Number(a.monthly_limit_paise) / 100,
      spent_today: Number(a.spent_today_paise) / 100,
      spent_this_month: Number(a.spent_this_month_paise) / 100,
      remaining_daily: Math.max(0, (Number(a.daily_limit_paise) - Number(a.spent_today_paise)) / 100),
      remaining_monthly: Math.max(0, (Number(a.monthly_limit_paise) - Number(a.spent_this_month_paise)) / 100),
      allowed_categories: a.allowed_categories || [],
      blocked_categories: a.blocked_categories || [],
      allowed_merchants: a.allowed_merchants || [],
      blocked_merchants: a.blocked_merchants || [],
      purpose: a.purpose || null,
      valid_from: a.valid_from,
      valid_until: a.valid_until,
      requires_approval_above: a.requires_approval_above_paise ? Number(a.requires_approval_above_paise) / 100 : null,
      status: a.status,
    };
  }
}
