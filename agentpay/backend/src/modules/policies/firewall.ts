import { db } from '../../db';
import { PolicyVersion, PaymentDecisionResult } from '../../types';
import { AuthorityService } from '../payment-authorities/authority.service';

export interface FirewallInput {
  organizationId: string;
  agentId: string;
  amountPaise: number;
  merchant: string;
  category?: string;
  policyVersionId: string;
  requestedAt?: Date;
  requireAuthority?: boolean;
}

export interface FirewallResult {
  decision: PaymentDecisionResult;
  reasons: string[];
  riskLevel: 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK';
  policyVersionId: string;
  authorityId?: string;
}

/**
 * Frame Policy Firewall — Deterministic Authorization Engine
 *
 * RULE: No LLM makes the final payment decision. This is pure logic.
 *
 * Evaluation order:
 * 1. Payment Authority verification (active, unexpired, unrevoked, limits, categories, merchants)
 * 2. Agent active check (caller's responsibility)
 * 3. Policy active & not expired
 * 4. Transaction limit
 * 5. Daily limit
 * 6. Monthly limit
 * 7. Merchant blocklist (hard block)
 * 8. Merchant allowlist (if set, deny if not in list)
 * 9. Category blocklist/allowlist
 * 10. Frequency limits
 * 11. Approval threshold → REQUIRE_APPROVAL
 */
export async function evaluatePolicy(input: FirewallInput): Promise<FirewallResult> {
  const { organizationId, agentId, amountPaise, merchant, category, policyVersionId } = input;
  const now = input.requestedAt || new Date();

  // ── Delegated Payment Authority Evaluation ──────────────
  const { rows: authCheckRows } = await db.query(
    `SELECT COUNT(*) as count FROM payment_authorities WHERE organization_id = $1 AND agent_id = $2`,
    [organizationId, agentId]
  );
  const authorityCount = parseInt(authCheckRows[0]?.count || '0', 10);
  const mustEnforceAuthority = input.requireAuthority || authorityCount > 0 || process.env.ENFORCE_PAYMENT_AUTHORITY === 'true';

  let authorityApprovalRequired = false;
  let activeAuthorityId: string | undefined;

  if (mustEnforceAuthority) {
    const authEval = await AuthorityService.evaluateAuthority(
      organizationId,
      agentId,
      amountPaise,
      category,
      merchant
    );

    if (!authEval.valid) {
      return {
        decision: 'DENY',
        reasons: [`AUTHORITY_DENIED: ${authEval.reason}`],
        riskLevel: 'HIGH_RISK',
        policyVersionId,
      };
    }

    if (authEval.requiresApproval) {
      authorityApprovalRequired = true;
    }
    activeAuthorityId = authEval.authority?.id;
  }

  // Load policy version
  const { rows: pvRows } = await db.query(
    `SELECT pv.*, p.status as policy_status
     FROM policy_versions pv
     JOIN policies p ON p.id = pv.policy_id
     WHERE pv.id = $1 AND p.organization_id = $2`,
    [policyVersionId, organizationId]
  );

  if (pvRows.length === 0) {
    return {
      decision: 'DENY',
      reasons: ['POLICY_NOT_FOUND: No active policy found for this agent.'],
      riskLevel: 'HIGH_RISK',
      policyVersionId,
    };
  }

  const pv: PolicyVersion & { policy_status: string } = pvRows[0];

  // Check policy active
  if (pv.policy_status !== 'active') {
    return { decision: 'DENY', reasons: ['POLICY_ARCHIVED'], riskLevel: 'HIGH_RISK', policyVersionId };
  }

  // Check policy validity window
  if (pv.valid_from && new Date(pv.valid_from) > now) {
    return { decision: 'DENY', reasons: ['POLICY_NOT_YET_VALID'], riskLevel: 'HIGH_RISK', policyVersionId };
  }
  if (pv.expires_at && new Date(pv.expires_at) < now) {
    return { decision: 'DENY', reasons: ['POLICY_EXPIRED'], riskLevel: 'HIGH_RISK', policyVersionId };
  }

  // ── Transaction limit ─────────────────────────────────
  if (pv.transaction_limit_paise !== null && pv.transaction_limit_paise !== undefined) {
    if (amountPaise > pv.transaction_limit_paise) {
      return {
        decision: 'DENY',
        reasons: [`TRANSACTION_LIMIT_EXCEEDED: ₹${amountPaise / 100} exceeds limit ₹${pv.transaction_limit_paise / 100}`],
        riskLevel: 'HIGH_RISK',
        policyVersionId,
      };
    }
  }

  // ── Daily spend limit ─────────────────────────────────
  if (pv.daily_limit_paise !== null && pv.daily_limit_paise !== undefined) {
    const { rows: dailyRows } = await db.query(
      `SELECT COALESCE(SUM(amount_paise), 0) as daily_spend
       FROM payment_intents
       WHERE agent_id = $1
         AND organization_id = $2
         AND status IN ('SUCCEEDED', 'EXECUTING', 'AUTHORIZED')
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
      [agentId, organizationId]
    );
    const dailySpend = parseInt(dailyRows[0].daily_spend, 10);
    if (dailySpend + amountPaise > pv.daily_limit_paise) {
      return {
        decision: 'DENY',
        reasons: [`DAILY_LIMIT_EXCEEDED: Daily spend ₹${dailySpend / 100} + ₹${amountPaise / 100} exceeds ₹${pv.daily_limit_paise / 100}`],
        riskLevel: 'HIGH_RISK',
        policyVersionId,
      };
    }
  }

  // ── Monthly spend limit ───────────────────────────────
  if (pv.monthly_limit_paise !== null && pv.monthly_limit_paise !== undefined) {
    const { rows: monthlyRows } = await db.query(
      `SELECT COALESCE(SUM(amount_paise), 0) as monthly_spend
       FROM payment_intents
       WHERE agent_id = $1
         AND organization_id = $2
         AND status IN ('SUCCEEDED', 'EXECUTING', 'AUTHORIZED')
         AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')`,
      [agentId, organizationId]
    );
    const monthlySpend = parseInt(monthlyRows[0].monthly_spend, 10);
    if (monthlySpend + amountPaise > pv.monthly_limit_paise) {
      return {
        decision: 'DENY',
        reasons: [`MONTHLY_LIMIT_EXCEEDED: Monthly spend ₹${monthlySpend / 100} + ₹${amountPaise / 100} exceeds ₹${pv.monthly_limit_paise / 100}`],
        riskLevel: 'HIGH_RISK',
        policyVersionId,
      };
    }
  }

  // ── Merchant blocklist (hard DENY) ────────────────────
  const normalizedMerchant = merchant.toLowerCase().trim();
  if (pv.merchant_blocklist && pv.merchant_blocklist.length > 0) {
    const blocked = pv.merchant_blocklist.some(
      (m) => m.toLowerCase().trim() === normalizedMerchant
    );
    if (blocked) {
      return {
        decision: 'DENY',
        reasons: [`MERCHANT_BLOCKED: Merchant "${merchant}" is on the blocklist.`],
        riskLevel: 'HIGH_RISK',
        policyVersionId,
      };
    }
  }

  // ── Merchant allowlist (if set, only listed merchants pass) ──
  if (pv.merchant_allowlist && pv.merchant_allowlist.length > 0) {
    const allowed = pv.merchant_allowlist.some(
      (m) => m.toLowerCase().trim() === normalizedMerchant
    );
    if (!allowed) {
      return {
        decision: 'DENY',
        reasons: [`MERCHANT_NOT_ALLOWED: Merchant "${merchant}" is not in the allowlist.`],
        riskLevel: 'HIGH_RISK',
        policyVersionId,
      };
    }
  }

  // ── Category checks ───────────────────────────────────
  if (category) {
    const normalizedCategory = category.toLowerCase().trim();

    if (pv.blocked_categories && pv.blocked_categories.length > 0) {
      const blocked = pv.blocked_categories.some((c) => c.toLowerCase().trim() === normalizedCategory);
      if (blocked) {
        return {
          decision: 'DENY',
          reasons: [`CATEGORY_BLOCKED: Category "${category}" is blocked.`],
          riskLevel: 'HIGH_RISK',
          policyVersionId,
        };
      }
    }

    if (pv.allowed_categories && pv.allowed_categories.length > 0) {
      const allowed = pv.allowed_categories.some((c) => c.toLowerCase().trim() === normalizedCategory);
      if (!allowed) {
        return {
          decision: 'DENY',
          reasons: [`CATEGORY_NOT_ALLOWED: Category "${category}" is not permitted.`],
          riskLevel: 'MEDIUM_RISK',
          policyVersionId,
        };
      }
    }
  }

  // ── Frequency limits ──────────────────────────────────
  if (pv.max_payments_per_hour !== null && pv.max_payments_per_hour !== undefined) {
    const { rows: hourRows } = await db.query(
      `SELECT COUNT(*) as count FROM payment_intents
       WHERE agent_id = $1 AND organization_id = $2
         AND status NOT IN ('DENIED', 'REJECTED', 'EXPIRED')
         AND created_at >= NOW() - INTERVAL '1 hour'`,
      [agentId, organizationId]
    );
    if (parseInt(hourRows[0].count, 10) >= pv.max_payments_per_hour) {
      return {
        decision: 'DENY',
        reasons: [`FREQUENCY_EXCEEDED: Max ${pv.max_payments_per_hour} payments/hour reached.`],
        riskLevel: 'MEDIUM_RISK',
        policyVersionId,
      };
    }
  }

  if (pv.max_payments_per_day !== null && pv.max_payments_per_day !== undefined) {
    const { rows: dayRows } = await db.query(
      `SELECT COUNT(*) as count FROM payment_intents
       WHERE agent_id = $1 AND organization_id = $2
         AND status NOT IN ('DENIED', 'REJECTED', 'EXPIRED')
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
      [agentId, organizationId]
    );
    if (parseInt(dayRows[0].count, 10) >= pv.max_payments_per_day) {
      return {
        decision: 'DENY',
        reasons: [`FREQUENCY_EXCEEDED: Max ${pv.max_payments_per_day} payments/day reached.`],
        riskLevel: 'MEDIUM_RISK',
        policyVersionId,
      };
    }
  }

  // ── Approval threshold ────────────────────────────────
  if (pv.approval_threshold_paise !== null && pv.approval_threshold_paise !== undefined) {
    if (amountPaise >= pv.approval_threshold_paise) {
      const riskLevel = amountPaise >= pv.approval_threshold_paise * 2 ? 'HIGH_RISK' : 'MEDIUM_RISK';
      return {
        decision: 'REQUIRE_APPROVAL',
        reasons: [`APPROVAL_REQUIRED: ₹${amountPaise / 100} meets or exceeds approval threshold ₹${pv.approval_threshold_paise / 100}`],
        riskLevel,
        policyVersionId,
      };
    }
  }

  // ── Authority Approval threshold ─────────────────────
  if (authorityApprovalRequired) {
    return {
      decision: 'REQUIRE_APPROVAL',
      reasons: ['APPROVAL_REQUIRED: PaymentAuthority requires approval above specified threshold.'],
      riskLevel: 'MEDIUM_RISK',
      policyVersionId,
      authorityId: activeAuthorityId,
    };
  }

  // ── All checks passed → ALLOW ─────────────────────────
  return {
    decision: 'ALLOW',
    reasons: ['All policy and authority checks passed.'],
    riskLevel: 'LOW_RISK',
    policyVersionId,
    authorityId: activeAuthorityId,
  };
}
