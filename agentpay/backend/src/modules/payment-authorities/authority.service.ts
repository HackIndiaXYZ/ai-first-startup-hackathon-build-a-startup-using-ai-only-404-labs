// Payment Authority Service
// Financial authorization management plane for AI agents.

import { ulid } from 'ulid';
import { db } from '../../db';
import { createAuditEvent } from '../../lib/audit';
import {
  PaymentAuthorityRecord,
  CreateAuthorityInput,
  AuthorityStatus,
} from './authority.entity';

export class AuthorityServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'AuthorityServiceError';
  }
}

export class AuthorityService {
  /**
   * Creates a new PaymentAuthority granted to an agent by an authorized human user.
   */
  static async createAuthority(
    input: CreateAuthorityInput
  ): Promise<PaymentAuthorityRecord> {
    if (input.maxTransactionAmountPaise <= 0) {
      throw new AuthorityServiceError(
        'maxTransactionAmountPaise must be greater than 0',
        'INVALID_LIMIT'
      );
    }
    if (input.dailyLimitPaise < input.maxTransactionAmountPaise) {
      throw new AuthorityServiceError(
        'dailyLimitPaise cannot be less than maxTransactionAmountPaise',
        'INVALID_LIMIT'
      );
    }
    if (input.monthlyLimitPaise < input.dailyLimitPaise) {
      throw new AuthorityServiceError(
        'monthlyLimitPaise cannot be less than dailyLimitPaise',
        'INVALID_LIMIT'
      );
    }

    const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
    const validUntil = new Date(input.validUntil);
    if (validUntil.getTime() <= validFrom.getTime()) {
      throw new AuthorityServiceError(
        'validUntil must be in the future',
        'INVALID_EXPIRY'
      );
    }

    const id = ulid();
    const { rows } = await db.query(
      `INSERT INTO payment_authorities (
        id, organization_id, user_id, agent_id, provider, rail, currency,
        max_transaction_amount_paise, daily_limit_paise, monthly_limit_paise,
        allowed_categories, blocked_categories, allowed_merchants, blocked_merchants,
        purpose, valid_from, valid_until, requires_approval_above_paise,
        status, provider_reference, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        'ACTIVE', $19, NOW(), NOW()
      ) RETURNING *`,
      [
        id,
        input.organizationId,
        input.userId,
        input.agentId,
        input.provider || 'mock',
        input.rail || 'upi_autopay',
        input.currency || 'INR',
        input.maxTransactionAmountPaise,
        input.dailyLimitPaise,
        input.monthlyLimitPaise,
        input.allowedCategories || [],
        input.blockedCategories || [],
        input.allowedMerchants || [],
        input.blockedMerchants || [],
        input.purpose || null,
        validFrom,
        validUntil,
        input.requiresApprovalAbovePaise || null,
        input.providerReference || null,
      ]
    );

    const record: PaymentAuthorityRecord = rows[0];

    await createAuditEvent({
      organizationId: input.organizationId,
      actorType: 'user',
      actorId: input.userId,
      action: 'authority.created',
      resourceType: 'payment_authority',
      resourceId: id,
      newState: {
        agentId: input.agentId,
        maxTransaction: input.maxTransactionAmountPaise,
        dailyLimit: input.dailyLimitPaise,
        monthlyLimit: input.monthlyLimitPaise,
        validUntil,
      },
    });

    return record;
  }

  /**
   * Fetches an authority by ID, enforcing tenant isolation and auto-expiring if past validity.
   */
  static async getAuthority(
    id: string,
    organizationId: string
  ): Promise<PaymentAuthorityRecord | null> {
    const { rows } = await db.query(
      `SELECT * FROM payment_authorities
       WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    if (rows.length === 0) return null;

    let authority: PaymentAuthorityRecord = rows[0];

    // Check expiry
    const now = new Date();
    if (new Date(authority.valid_until) < now && authority.status === 'ACTIVE') {
      await db.query(
        `UPDATE payment_authorities
         SET status = 'EXPIRED', updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      authority.status = 'EXPIRED';
    }

    return authority;
  }

  /**
   * Lists authorities with optional filtering by agentId and status.
   */
  static async listAuthorities(
    organizationId: string,
    filters: { agentId?: string; status?: AuthorityStatus } = {}
  ): Promise<PaymentAuthorityRecord[]> {
    let query = `SELECT * FROM payment_authorities WHERE organization_id = $1`;
    const params: any[] = [organizationId];

    if (filters.agentId) {
      params.push(filters.agentId);
      query += ` AND agent_id = $${params.length}`;
    }

    if (filters.status) {
      params.push(filters.status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await db.query(query, params);

    // Auto-update expired records in memory/db
    const now = new Date();
    return rows.map((r: PaymentAuthorityRecord) => {
      if (new Date(r.valid_until) < now && r.status === 'ACTIVE') {
        r.status = 'EXPIRED';
      }
      return r;
    });
  }

  /**
   * Revokes an authority permanently.
   */
  static async revokeAuthority(
    id: string,
    organizationId: string,
    userId: string,
    reason: string = 'Revoked by user/admin'
  ): Promise<PaymentAuthorityRecord> {
    const authority = await this.getAuthority(id, organizationId);
    if (!authority) {
      throw new AuthorityServiceError('Authority not found', 'NOT_FOUND', 404);
    }

    const { rows } = await db.query(
      `UPDATE payment_authorities
       SET status = 'REVOKED',
           revocation_reason = $1,
           revoked_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [reason, id, organizationId]
    );

    await createAuditEvent({
      organizationId,
      actorType: 'user',
      actorId: userId,
      action: 'authority.revoked',
      resourceType: 'payment_authority',
      resourceId: id,
      previousState: { status: authority.status },
      newState: { status: 'REVOKED', reason },
    });

    return rows[0];
  }

  /**
   * Suspends an authority temporarily.
   */
  static async suspendAuthority(
    id: string,
    organizationId: string,
    userId: string,
    reason: string = 'Suspended by user/admin'
  ): Promise<PaymentAuthorityRecord> {
    const authority = await this.getAuthority(id, organizationId);
    if (!authority) {
      throw new AuthorityServiceError('Authority not found', 'NOT_FOUND', 404);
    }
    if (authority.status === 'REVOKED') {
      throw new AuthorityServiceError(
        'Cannot suspend a revoked authority',
        'ALREADY_REVOKED',
        400
      );
    }

    const { rows } = await db.query(
      `UPDATE payment_authorities
       SET status = 'SUSPENDED',
           revocation_reason = $1,
           updated_at = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [reason, id, organizationId]
    );

    await createAuditEvent({
      organizationId,
      actorType: 'user',
      actorId: userId,
      action: 'authority.suspended',
      resourceType: 'payment_authority',
      resourceId: id,
      previousState: { status: authority.status },
      newState: { status: 'SUSPENDED', reason },
    });

    return rows[0];
  }

  /**
   * Resumes a suspended authority.
   */
  static async resumeAuthority(
    id: string,
    organizationId: string,
    userId: string
  ): Promise<PaymentAuthorityRecord> {
    const authority = await this.getAuthority(id, organizationId);
    if (!authority) {
      throw new AuthorityServiceError('Authority not found', 'NOT_FOUND', 404);
    }
    if (authority.status !== 'SUSPENDED') {
      throw new AuthorityServiceError(
        `Cannot resume authority with status ${authority.status}`,
        'INVALID_STATUS_TRANSITION',
        400
      );
    }

    if (new Date(authority.valid_until) <= new Date()) {
      throw new AuthorityServiceError(
        'Cannot resume expired authority',
        'AUTHORITY_EXPIRED',
        400
      );
    }

    const { rows } = await db.query(
      `UPDATE payment_authorities
       SET status = 'ACTIVE',
           revocation_reason = null,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId]
    );

    await createAuditEvent({
      organizationId,
      actorType: 'user',
      actorId: userId,
      action: 'authority.resumed',
      resourceType: 'payment_authority',
      resourceId: id,
      previousState: { status: 'SUSPENDED' },
      newState: { status: 'ACTIVE' },
    });

    return rows[0];
  }

  /**
   * Increments spent counters upon successful settlement, managing calendar reset.
   */
  static async recordSpend(
    authorityId: string,
    amountPaise: number
  ): Promise<void> {
    await db.query(
      `UPDATE payment_authorities
       SET 
         spent_today_paise = CASE 
           WHEN last_reset_date = CURRENT_DATE THEN spent_today_paise + $1
           ELSE $1
         END,
         spent_this_month_paise = CASE 
           WHEN last_reset_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM') THEN spent_this_month_paise + $1
           ELSE $1
         END,
         last_reset_date = CURRENT_DATE,
         last_reset_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
         updated_at = NOW()
       WHERE id = $2`,
      [amountPaise, authorityId]
    );
  }

  /**
   * Validates whether an agent has an active, compliant authority for a requested purchase.
   * Returns { valid: true, authority, requiresApproval: boolean } or { valid: false, reason: string }.
   */
  static async evaluateAuthority(
    organizationId: string,
    agentId: string,
    amountPaise: number,
    category?: string,
    merchant?: string
  ): Promise<{
    valid: boolean;
    reason?: string;
    authority?: PaymentAuthorityRecord;
    requiresApproval?: boolean;
    approvalThreshold?: number;
  }> {
    // 1. Fetch all authorities for this agent in this organization
    const { rows } = await db.query(
      `SELECT *,
              (last_reset_date = CURRENT_DATE) as is_reset_today,
              (last_reset_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM')) as is_reset_this_month
       FROM payment_authorities
       WHERE organization_id = $1 AND agent_id = $2
       ORDER BY created_at DESC`,
      [organizationId, agentId]
    );

    if (rows.length === 0) {
      return {
        valid: false,
        reason: `Agent ${agentId} has not been granted any PaymentAuthority in this organization.`,
      };
    }

    const now = new Date();

    // Check specific reasons if all authorities fail
    let foundExpired = false;
    let foundRevoked = false;
    let foundSuspended = false;

    for (const auth of rows as (PaymentAuthorityRecord & { is_reset_today: boolean; is_reset_this_month: boolean })[]) {
      // Check status
      if (auth.status === 'REVOKED') {
        foundRevoked = true;
        continue;
      }
      if (auth.status === 'SUSPENDED') {
        foundSuspended = true;
        continue;
      }
      if (auth.status === 'EXPIRED' || new Date(auth.valid_until) < now) {
        foundExpired = true;
        continue;
      }

      // Check per-transaction limit
      if (amountPaise > Number(auth.max_transaction_amount_paise)) {
        return {
          valid: false,
          reason: `Transaction amount ₹${(amountPaise / 100).toFixed(2)} exceeds authority max transaction limit ₹${(Number(auth.max_transaction_amount_paise) / 100).toFixed(2)}.`,
        };
      }

      // Calculate effective daily spend
      const effectiveDailySpend = auth.is_reset_today ? Number(auth.spent_today_paise) : 0;
      if (effectiveDailySpend + amountPaise > Number(auth.daily_limit_paise)) {
        return {
          valid: false,
          reason: `Transaction would exceed daily spend limit of ₹${(Number(auth.daily_limit_paise) / 100).toFixed(2)} (Current spent: ₹${(effectiveDailySpend / 100).toFixed(2)}).`,
        };
      }

      // Calculate effective monthly spend
      const effectiveMonthlySpend = auth.is_reset_this_month ? Number(auth.spent_this_month_paise) : 0;
      if (effectiveMonthlySpend + amountPaise > Number(auth.monthly_limit_paise)) {
        return {
          valid: false,
          reason: `Transaction would exceed monthly spend limit of ₹${(Number(auth.monthly_limit_paise) / 100).toFixed(2)} (Current spent: ₹${(effectiveMonthlySpend / 100).toFixed(2)}).`,
        };
      }

      // Check category restrictions
      if (category) {
        const catNorm = category.toLowerCase().trim();
        if (
          auth.blocked_categories &&
          auth.blocked_categories.some(c => c.toLowerCase().trim() === catNorm)
        ) {
          return {
            valid: false,
            reason: `Category "${category}" is explicitly blocked by PaymentAuthority.`,
          };
        }
        if (
          auth.allowed_categories &&
          auth.allowed_categories.length > 0 &&
          !auth.allowed_categories.some(c => c.toLowerCase().trim() === catNorm)
        ) {
          return {
            valid: false,
            reason: `Category "${category}" is not in allowed categories for this PaymentAuthority.`,
          };
        }
      }

      // Check merchant restrictions
      if (merchant) {
        const merchNorm = merchant.toLowerCase().trim();
        if (
          auth.blocked_merchants &&
          auth.blocked_merchants.some(m => m.toLowerCase().trim() === merchNorm)
        ) {
          return {
            valid: false,
            reason: `Merchant "${merchant}" is explicitly blocked by PaymentAuthority.`,
          };
        }
        if (
          auth.allowed_merchants &&
          auth.allowed_merchants.length > 0 &&
          !auth.allowed_merchants.some(m => m.toLowerCase().trim() === merchNorm)
        ) {
          return {
            valid: false,
            reason: `Merchant "${merchant}" is not in allowed merchants for this PaymentAuthority.`,
          };
        }
      }

      // Check human approval escalation threshold on the authority
      let requiresApproval = false;
      if (
        auth.requires_approval_above_paise &&
        amountPaise > Number(auth.requires_approval_above_paise)
      ) {
        requiresApproval = true;
      }

      return {
        valid: true,
        authority: auth,
        requiresApproval,
        approvalThreshold: auth.requires_approval_above_paise ? Number(auth.requires_approval_above_paise) : undefined,
      };
    }

    // If no active authority matched
    if (foundRevoked) {
      return { valid: false, reason: 'PaymentAuthority has been revoked.' };
    }
    if (foundSuspended) {
      return { valid: false, reason: 'PaymentAuthority is currently suspended.' };
    }
    if (foundExpired) {
      return { valid: false, reason: 'PaymentAuthority has expired.' };
    }

    return { valid: false, reason: 'No valid active PaymentAuthority found for this agent.' };
  }
}
