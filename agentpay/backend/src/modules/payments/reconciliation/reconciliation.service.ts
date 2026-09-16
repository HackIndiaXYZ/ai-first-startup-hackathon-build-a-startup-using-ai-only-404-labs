// Financial Reconciliation Engine
// Automatically detects and resolves state discrepancies between Frame and payment providers.

import { ulid } from 'ulid';
import { db } from '../../../db';
import { createAuditEvent } from '../../../lib/audit';
import { ProviderRegistry } from '../providers/provider-registry';
import { PaymentOrchestrator } from '../orchestrator/payment-orchestrator';

export interface ReconciliationSummary {
  runId: string;
  totalChecked: number;
  matchedCount: number;
  resolvedCount: number;
  discrepancyCount: number;
  details: Array<{
    paymentId: string;
    previousStatus: string;
    resolvedStatus: string;
    note: string;
  }>;
}

export class ReconciliationService {
  /**
   * Reconciles all pending, processing, and unknown payments for an organization.
   */
  static async reconcileOrganization(
    organizationId: string,
    options: { maxAgeMinutes?: number } = {}
  ): Promise<ReconciliationSummary> {
    const runId = ulid();
    const startTime = new Date();

    // 0. Sweep any abandoned in-flight executions left by crashed workers
    await PaymentOrchestrator.recoverStaleExecutions(options.maxAgeMinutes ? options.maxAgeMinutes * 60000 : 30000);

    // 1. Fetch payments needing reconciliation (status in 'processing' or 'unknown')
    const { rows: unresolvedPayments } = await db.query(
      `SELECT p.*, pi.agent_id
       FROM payments p
       JOIN payment_intents pi ON pi.id = p.payment_intent_id
       WHERE p.organization_id = $1
         AND p.status IN ('processing', 'unknown')
       ORDER BY p.created_at ASC
       LIMIT 100`,
      [organizationId]
    );

    const { provider, config } = await ProviderRegistry.resolveActiveProvider(organizationId);

    let matchedCount = 0;
    let resolvedCount = 0;
    let discrepancyCount = 0;
    const details: ReconciliationSummary['details'] = [];

    // 2. Iterate and query ground-truth provider status
    for (const payment of unresolvedPayments) {
      const lookupId = payment.provider_payment_id || payment.id;

      try {
        const providerStatusResult = await provider.getPaymentStatus(
          lookupId,
          config
        );

        if (providerStatusResult.status === payment.status) {
          matchedCount++;
          continue;
        }

        // Status Discrepancy Found! (e.g. unknown -> succeeded, or processing -> failed)
        if (providerStatusResult.status === 'succeeded' || providerStatusResult.status === 'failed') {
          await PaymentOrchestrator.applyPaymentResult(
            payment.id,
            payment.payment_intent_id,
            organizationId,
            payment.agent_id,
            payment.amount_paise,
            payment.currency,
            providerStatusResult
          );

          resolvedCount++;
          details.push({
            paymentId: payment.id,
            previousStatus: payment.status,
            resolvedStatus: providerStatusResult.status,
            note: `Resolved via reconciliation lookup with provider ground truth: ${providerStatusResult.providerStatus}`,
          });

          await createAuditEvent({
            organizationId,
            actorType: 'system',
            action: 'reconciliation.payment_resolved',
            resourceType: 'payment',
            resourceId: payment.id,
            newState: {
              previous_status: payment.status,
              resolved_status: providerStatusResult.status,
              run_id: runId,
            },
          });
        } else {
          discrepancyCount++;
          details.push({
            paymentId: payment.id,
            previousStatus: payment.status,
            resolvedStatus: providerStatusResult.status,
            note: `Status remains uncertain. Provider returned ${providerStatusResult.providerStatus}.`,
          });
        }
      } catch (err: any) {
        discrepancyCount++;
        details.push({
          paymentId: payment.id,
          previousStatus: payment.status,
          resolvedStatus: 'error',
          note: `Provider lookup failed: ${err.message}`,
        });
      }
    }

    // 3. Persist Reconciliation Run Record
    await db.query(
      `INSERT INTO reconciliation_runs (
        id, organization_id, provider, status, total_checked, matched_count,
        discrepancy_count, details, started_at, completed_at
      ) VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, NOW())`,
      [
        runId,
        organizationId,
        provider.providerType,
        unresolvedPayments.length,
        matchedCount,
        discrepancyCount,
        JSON.stringify(details),
        startTime,
      ]
    );

    return {
      runId,
      totalChecked: unresolvedPayments.length,
      matchedCount,
      resolvedCount,
      discrepancyCount,
      details,
    };
  }
}
