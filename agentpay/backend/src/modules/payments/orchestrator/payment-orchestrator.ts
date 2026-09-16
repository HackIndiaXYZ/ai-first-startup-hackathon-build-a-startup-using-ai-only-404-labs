// Central Payment Orchestrator
// Coordinates the lifecycle: authorization -> provider execution -> normalization -> ledger -> audit.
// Supports both durable asynchronous queue execution and direct execution.

import { ulid } from 'ulid';
import { db } from '../../../db';
import { createAuditEvent } from '../../../lib/audit';
import { PaymentIntentStateMachine, PaymentStateMachine } from '../domain/payment-state-machine';
import { verifyIntentIntegrity } from '../domain/intent-hasher';
import { ProviderRegistry } from '../providers/provider-registry';
import { LedgerService } from '../ledger/ledger.service';
import {
  PaymentIntentRecord,
  PaymentRecord,
  PaymentExecutionStatus,
  PaymentRail,
} from '../domain/payment.entity';
import { ProviderPaymentResult } from '../providers/provider.interface';
import { enqueuePaymentExecution } from '../../../queue/payment-execution.queue';
import { AuthorityService } from '../../payment-authorities/authority.service';

export class PaymentExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PaymentExecutionError';
  }
}

export interface OrchestratedPaymentResult {
  payment: PaymentRecord;
  intent: PaymentIntentRecord;
  providerResult: ProviderPaymentResult;
}

export class PaymentOrchestrator {
  /**
   * Prepares and enqueues a payment execution.
   * Runs in the synchronous HTTP ingestion path (~15ms):
   * 1. Validates intent state (AUTHORIZED) and canonical hash integrity.
   * 2. Transitions intent to EXECUTING.
   * 3. Creates initial payment record with status 'pending' (provider_status: 'QUEUED').
   * 4. Enqueues durable BullMQ job.
   * Returns immediately without blocking on external provider network calls.
   */
  static async prepareExecution(
    intentId: string,
    organizationId: string,
    options: { rail?: PaymentRail; metadata?: Record<string, unknown>; synchronous?: boolean } = {}
  ): Promise<{ payment: PaymentRecord; intent: PaymentIntentRecord; jobId: string }> {
    // 1. Fetch Intent with Row Lock to prevent concurrent executions
    const { rows: intentRows } = await db.query(
      `SELECT * FROM payment_intents
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [intentId, organizationId]
    );

    if (intentRows.length === 0) {
      throw new PaymentExecutionError('Payment intent not found.', 'INTENT_NOT_FOUND');
    }

    const intent: PaymentIntentRecord = intentRows[0];

    // 2. State Machine Validation
    if (intent.status !== 'AUTHORIZED') {
      // If already executing or succeeded, return existing payment without re-executing
      if (intent.status === 'SUCCEEDED' || intent.status === 'EXECUTING') {
        const { rows: existingPayments } = await db.query(
          `SELECT * FROM payments WHERE payment_intent_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [intentId]
        );
        if (existingPayments.length > 0) {
          return {
            payment: existingPayments[0],
            intent,
            jobId: `existing_${existingPayments[0].id}`,
          };
        }
      }

      throw new PaymentExecutionError(
        `Cannot execute intent with status "${intent.status}". Intent must be in "AUTHORIZED" state.`,
        'INTENT_NOT_AUTHORIZED'
      );
    }

    // 3. Financial Integrity Verification (Canonical Hash Match)
    const isIntegrityValid = verifyIntentIntegrity({
      agent_id: intent.agent_id,
      organization_id: intent.organization_id,
      amount_paise: intent.amount_paise,
      currency: intent.currency,
      merchant: intent.merchant,
      merchant_reference: intent.merchant_reference,
      purpose: intent.purpose,
      task_reference: intent.task_reference,
      policy_version_id: intent.policy_version_id,
      idempotency_key: intent.idempotency_key,
      expires_at: intent.expires_at,
      intent_hash: intent.intent_hash,
    });

    if (!isIntegrityValid) {
      // Security Alert: Potential database tampering detected
      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment_intent.hash_mismatch_detected',
        resourceType: 'payment_intent',
        resourceId: intentId,
        newState: { status: 'FAILED', reason: 'INTENT_HASH_MISMATCH' },
      });

      await db.query(
        `UPDATE payment_intents SET status = 'FAILED', denial_reason = 'Cryptographic intent hash mismatch detected.', updated_at = NOW() WHERE id = $1`,
        [intentId]
      );

      throw new PaymentExecutionError(
        'Payment intent integrity verification failed: hash does not match canonical state.',
        'INTENT_HASH_MISMATCH'
      );
    }

    // 4. Transition Intent to EXECUTING
    PaymentIntentStateMachine.assertCanTransition(intent.status, 'EXECUTING');
    await db.query(
      `UPDATE payment_intents SET status = 'EXECUTING', updated_at = NOW() WHERE id = $1`,
      [intentId]
    );

    // 5. Resolve Active Provider
    const { provider, config } = await ProviderRegistry.resolveActiveProvider(organizationId);

    // 6. Create Payment Record (Status: 'pending', provider_status: 'QUEUED')
    const paymentId = ulid();
    const rail: PaymentRail = options.rail || (provider.supportedRails.includes('upi') ? 'upi' : 'mock');

    await db.query(
      `INSERT INTO payments (
        id, payment_intent_id, organization_id, provider_config_id,
        provider, amount_paise, currency, rail, status, provider_status,
        reconciliation_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'QUEUED', 'unreconciled')`,
      [
        paymentId,
        intentId,
        organizationId,
        config.id.startsWith('default_') ? null : config.id,
        provider.providerType,
        intent.amount_paise,
        intent.currency,
        rail,
      ]
    );

    // 7. Enqueue Durable BullMQ Execution Job (only if not synchronous execution)
    let jobId = `pay_job_${paymentId}`;
    if (!options.synchronous) {
      try {
        jobId = await enqueuePaymentExecution({
          organizationId,
          paymentId,
          paymentIntentId: intentId,
          idempotencyKey: intent.idempotency_key,
          createdAt: new Date().toISOString(),
        });
      } catch (err: any) {
        console.warn('Queue enqueue warning (non-fatal, falling back to direct job id):', err.message);
      }
    }

    const { rows: createdPaymentRows } = await db.query(
      `SELECT * FROM payments WHERE id = $1`,
      [paymentId]
    );
    const { rows: updatedIntentRows } = await db.query(
      `SELECT * FROM payment_intents WHERE id = $1`,
      [intentId]
    );

    return {
      payment: createdPaymentRows[0],
      intent: updatedIntentRows[0],
      jobId,
    };
  }

  /**
   * Consumes and executes a queued payment attempt.
   * Invoked by the background payment execution worker.
   * Guarantees:
   * 1. Acquires row lock (SELECT FOR UPDATE) on the payment.
   * 2. Guards against duplicate or completed executions (idempotent no-op).
   * 3. Crash safety: If an in-flight attempt was already initiated, flags UNKNOWN instead of blindly retrying.
   * 4. Dispatches to external provider and applies normalized outcome.
   */
  static async dispatchProviderExecution(
    paymentId: string,
    organizationId: string,
    options: { metadata?: Record<string, unknown> } = {}
  ): Promise<OrchestratedPaymentResult> {
    // 1. Atomic Compare-And-Swap (CAS) Execution Lease Acquisition
    // Guarantees at-most-once provider dispatch across all concurrent workers:
    // Only the single worker that transitions status from 'pending' to 'processing' wins execution authority.
    const { rows: acquiredRows } = await db.query(
      `UPDATE payments
       SET status = 'processing',
           provider_status = 'INITIATED',
           updated_at = NOW()
       WHERE id = $1
         AND organization_id = $2
         AND status = 'pending'
       RETURNING *`,
      [paymentId, organizationId]
    );

    let payment: PaymentRecord;

    if (acquiredRows.length === 0) {
      // Failed to acquire lease: Either already processing, terminal, unknown, or not found
      const { rows: existingRows } = await db.query(
        `SELECT * FROM payments WHERE id = $1 AND organization_id = $2`,
        [paymentId, organizationId]
      );

      if (existingRows.length === 0) {
        throw new PaymentExecutionError('Payment record not found.', 'PAYMENT_NOT_FOUND');
      }

      payment = existingRows[0];

      // If already terminal (succeeded, failed) or unknown, return existing state idempotently
      if (payment.status === 'succeeded' || payment.status === 'failed' || payment.status === 'unknown') {
        const { rows: intentRows } = await db.query(
          `SELECT * FROM payment_intents WHERE id = $1`,
          [payment.payment_intent_id]
        );
        return {
          payment,
          intent: intentRows[0],
          providerResult: {
            providerPaymentId: payment.provider_payment_id || '',
            status: payment.status,
            providerStatus: payment.provider_status || '',
            rawResponse: payment.provider_metadata || {},
          },
        };
      }

      // If already 'processing', another worker is currently executing the provider call.
      // ⚠️ CRITICAL RULE: NEVER blindly dispatch a second provider execution!
      // Poll briefly for the active worker to finish, then return the state.
      const waitStart = Date.now();
      while (Date.now() - waitStart < 4000) {
        await new Promise(r => setTimeout(r, 80));
        const { rows: pollRows } = await db.query(
          `SELECT * FROM payments WHERE id = $1 AND organization_id = $2`,
          [paymentId, organizationId]
        );
        if (pollRows.length > 0 && pollRows[0].status !== 'processing') {
          const { rows: intentRows } = await db.query(
            `SELECT * FROM payment_intents WHERE id = $1`,
            [pollRows[0].payment_intent_id]
          );
          return {
            payment: pollRows[0],
            intent: intentRows[0],
            providerResult: {
              providerPaymentId: pollRows[0].provider_payment_id || '',
              status: pollRows[0].status,
              providerStatus: pollRows[0].provider_status || '',
              rawResponse: pollRows[0].provider_metadata || {},
            },
          };
        }
      }

      // Return current in-flight state without duplicate provider call
      const { rows: intentRows } = await db.query(
        `SELECT * FROM payment_intents WHERE id = $1`,
        [payment.payment_intent_id]
      );
      return {
        payment,
        intent: intentRows[0],
        providerResult: {
          providerPaymentId: payment.provider_payment_id || '',
          status: payment.status,
          providerStatus: payment.provider_status || '',
          rawResponse: payment.provider_metadata || {},
        },
      };
    }

    // Successfully acquired exclusive execution lease!
    payment = acquiredRows[0];

    // 2. Fetch Parent Intent
    const { rows: intentRows } = await db.query(
      `SELECT * FROM payment_intents WHERE id = $1 AND organization_id = $2`,
      [payment.payment_intent_id, organizationId]
    );
    const intent: PaymentIntentRecord = intentRows[0];

    // 3. Crash Recovery Guard: Check if an attempt was initiated with external provider and worker crashed
    const { rows: existingAttempts } = await db.query(
      `SELECT * FROM payment_attempts WHERE payment_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
      [paymentId]
    );

    if (existingAttempts.length > 0 && existingAttempts[0].status === 'processing') {
      // Worker crashed while provider call was in-flight!
      // Invariant: NEVER blindly re-execute!
      const crashResult: ProviderPaymentResult = {
        providerPaymentId: payment.provider_payment_id || `unknown_${ulid()}`,
        status: 'unknown',
        providerStatus: 'WORKER_CRASH_IN_FLIGHT',
        errorCode: 'WORKER_CRASH_DURING_EXECUTION',
        errorDescription: 'Worker crashed or restarted while external provider call was in-flight. Dispatched to reconciliation.',
        rawResponse: { error: 'Worker crashed while awaiting provider response' },
      };

      await db.query(
        `UPDATE payment_attempts
         SET status = 'unknown', error_message = $1
         WHERE id = $2`,
        [crashResult.errorDescription, existingAttempts[0].id]
      );

      return await this.applyPaymentResult(
        payment.id,
        payment.payment_intent_id,
        organizationId,
        intent.agent_id,
        payment.amount_paise,
        payment.currency,
        crashResult
      );
    }

    // 6. Record Execution Attempt (marked 'processing' before external network call)
    const attemptId = ulid();
    const startTime = Date.now();
    const providerRequestPayload = {
      amountPaise: intent.amount_paise,
      currency: intent.currency,
      merchant: intent.merchant,
      purpose: intent.purpose,
      rail: payment.rail,
    };

    await db.query(
      `INSERT INTO payment_attempts (
        id, payment_id, attempt_number, status, provider_request, attempted_at
      ) VALUES ($1, $2, 1, 'processing', $3, NOW())`,
      [attemptId, paymentId, JSON.stringify(providerRequestPayload)]
    );

    // 7. Resolve Active Provider
    const { provider, config } = await ProviderRegistry.resolveActiveProvider(organizationId);

    // 7.1. Check Provider Capabilities
    const capabilities = provider.getCapabilities();
    if (!capabilities.supportsAgentInitiatedPayment) {
      const errorResult: ProviderPaymentResult = {
        providerPaymentId: `unsupported_${ulid()}`,
        status: 'failed',
        providerStatus: 'UNSUPPORTED_CAPABILITY',
        errorCode: 'UNSUPPORTED_PROVIDER_CAPABILITY',
        errorDescription: `Provider "${provider.name}" does not support autonomous agent-initiated payments.`,
        rawResponse: { capabilities },
      };
      return await this.applyPaymentResult(
        paymentId,
        intent.id,
        organizationId,
        intent.agent_id,
        intent.amount_paise,
        intent.currency,
        errorResult
      );
    }

    if (!provider.supportedRails.includes(payment.rail)) {
      const errorResult: ProviderPaymentResult = {
        providerPaymentId: `unsupported_${ulid()}`,
        status: 'failed',
        providerStatus: 'UNSUPPORTED_RAIL',
        errorCode: 'UNSUPPORTED_PAYMENT_RAIL',
        errorDescription: `Provider "${provider.name}" does not support payment rail "${payment.rail}".`,
        rawResponse: { supportedRails: provider.supportedRails },
      };
      return await this.applyPaymentResult(
        paymentId,
        intent.id,
        organizationId,
        intent.agent_id,
        intent.amount_paise,
        intent.currency,
        errorResult
      );
    }

    // 8. Execute via Provider Adapter
    let providerResult: ProviderPaymentResult;
    try {
      providerResult = await provider.executePayment(
        {
          paymentId,
          intentId: intent.id,
          organizationId,
          amountPaise: intent.amount_paise,
          currency: intent.currency,
          merchant: intent.merchant,
          merchantReference: intent.merchant_reference,
          purpose: intent.purpose,
          taskReference: intent.task_reference,
          rail: payment.rail,
          idempotencyKey: intent.idempotency_key,
          metadata: { ...intent.metadata, ...options.metadata },
        },
        config
      );
    } catch (err: any) {
      // ⚠️ CRITICAL FINANCIAL RULE: Network exception or timeout is UNKNOWN, NOT FAILED!
      providerResult = {
        providerPaymentId: `unknown_${ulid()}`,
        status: 'unknown',
        providerStatus: 'NETWORK_EXCEPTION',
        errorCode: 'PROVIDER_CONNECTION_ERROR',
        errorDescription: err.message || 'Error communicating with provider switch.',
        rawResponse: { error: err.message },
      };
    }

    const latencyMs = Date.now() - startTime;

    // 9. Update Attempt Record with Response & Latency
    await db.query(
      `UPDATE payment_attempts
       SET status = $1, provider_response = $2, error_message = $3, latency_ms = $4
       WHERE id = $5`,
      [
        providerResult.status,
        JSON.stringify(providerResult.rawResponse || {}),
        providerResult.errorDescription || null,
        latencyMs,
        attemptId,
      ]
    );

    // 10. Process Normalized Outcome
    return await this.applyPaymentResult(
      paymentId,
      intent.id,
      organizationId,
      intent.agent_id,
      intent.amount_paise,
      intent.currency,
      providerResult
    );
  }

  /**
   * Primary entry point to execute an AUTHORIZED payment intent.
   * Backward-compatible synchronous wrapper that prepares execution and dispatches provider call.
   */
  static async executeIntent(
    intentId: string,
    organizationId: string,
    options: { rail?: PaymentRail; metadata?: Record<string, unknown>; synchronous?: boolean } = {}
  ): Promise<OrchestratedPaymentResult> {
    const { payment } = await this.prepareExecution(intentId, organizationId, { ...options, synchronous: true });
    return await this.dispatchProviderExecution(payment.id, organizationId, options);
  }

  /**
   * Sweeps and recovers payments that were left in-flight by a crashed or killed worker process.
   * Scans for payments in 'processing' state where no progress has been made past the threshold.
   * Safely transitions them to 'unknown' with ZERO ledger debits, preserving intent in 'EXECUTING'.
   */
  static async recoverStaleExecutions(
    staleThresholdMs: number = 30000
  ): Promise<Array<{ paymentId: string; recoveredAt: string }>> {
    const cutoff = new Date(Date.now() - staleThresholdMs);

    const { rows: stalePayments } = await db.query(
      `SELECT p.id, p.organization_id, p.payment_intent_id, p.amount_paise, p.currency, pi.agent_id
       FROM payments p
       JOIN payment_intents pi ON pi.id = p.payment_intent_id
       WHERE p.status = 'processing'
         AND p.updated_at < $1
       FOR UPDATE SKIP LOCKED`,
      [cutoff]
    );

    const recovered: Array<{ paymentId: string; recoveredAt: string }> = [];

    for (const stale of stalePayments) {
      console.warn(`[PaymentOrchestrator] Recovering stale in-flight payment ${stale.id} (worker crashed or abandoned)`);

      const crashResult: ProviderPaymentResult = {
        providerPaymentId: `unknown_${ulid()}`,
        status: 'unknown',
        providerStatus: 'WORKER_CRASH_OR_TIMEOUT',
        errorCode: 'WORKER_CRASH_IN_FLIGHT',
        errorDescription: 'Worker process terminated or crashed while payment was in-flight. Dispatched to reconciliation.',
        rawResponse: { error: 'In-flight execution abandoned by worker' },
      };

      await db.query(
        `UPDATE payment_attempts
         SET status = 'unknown', error_message = $1
         WHERE payment_id = $2 AND status = 'processing'`,
        [crashResult.errorDescription, stale.id]
      );

      await this.applyPaymentResult(
        stale.id,
        stale.payment_intent_id,
        stale.organization_id,
        stale.agent_id,
        stale.amount_paise,
        stale.currency,
        crashResult
      );

      recovered.push({ paymentId: stale.id, recoveredAt: new Date().toISOString() });
    }

    return recovered;
  }

  /**
   * Applies the normalized provider result to the payment, intent, ledger, and audit log.
   */
  static async applyPaymentResult(
    paymentId: string,
    intentId: string,
    organizationId: string,
    agentId: string,
    amountPaise: number,
    currency: string,
    result: ProviderPaymentResult
  ): Promise<OrchestratedPaymentResult> {
    const { status, providerPaymentId, providerStatus, errorCode, errorDescription } = result;

    // 1. Fetch current payment status under lock to prevent race regressions
    const { rows: currPaymentRows } = await db.query(
      `SELECT * FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );

    if (currPaymentRows.length === 0) {
      throw new PaymentExecutionError('Payment record not found.', 'PAYMENT_NOT_FOUND');
    }

    const currentPayment: PaymentRecord = currPaymentRows[0];

    // 2. Terminal State Guard: Once succeeded or failed, state CANNOT regress or change
    if (PaymentStateMachine.isTerminal(currentPayment.status)) {
      const { rows: intentRows } = await db.query(
        `SELECT * FROM payment_intents WHERE id = $1`,
        [intentId]
      );

      if (currentPayment.status === status) {
        // Idempotent duplicate: already in target state
        return {
          payment: currentPayment,
          intent: intentRows[0],
          providerResult: result,
        };
      }

      // Illegal state transition attempted!
      console.warn(
        `[PaymentOrchestrator] BLOCKED illegal state mutation on terminal payment ${paymentId}: current=${currentPayment.status}, attempted=${status}`
      );

      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment.illegal_transition_prevented',
        resourceType: 'payment',
        resourceId: paymentId,
        newState: {
          current_status: currentPayment.status,
          attempted_status: status,
          reason: 'Cannot mutate terminal payment state',
        },
      });

      return {
        payment: currentPayment,
        intent: intentRows[0],
        providerResult: result,
      };
    }

    if (status === 'succeeded') {
      // A. Payment Succeeded
      await db.query(
        `UPDATE payments
         SET status = 'succeeded',
             provider_payment_id = $1,
             provider_status = $2,
             settled_at = NOW(),
             reconciliation_status = 'reconciled',
             reconciled_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [providerPaymentId, providerStatus, paymentId]
      );

      await db.query(
        `UPDATE payment_intents SET status = 'SUCCEEDED', updated_at = NOW() WHERE id = $1`,
        [intentId]
      );

      // B. Tamper-evident Ledger Entry (Double-Entry Debit with Idempotency Guard)
      await LedgerService.recordEntry({
        organizationId,
        agentId,
        paymentIntentId: intentId,
        paymentId,
        entryType: 'DEBIT',
        amountPaise,
        currency,
        providerReference: providerPaymentId,
        description: `Settled payment ${paymentId} via ${providerStatus}`,
      });

      // C. Record spend against active PaymentAuthority if exists
      const { rows: authRows } = await db.query(
        `SELECT id FROM payment_authorities
         WHERE organization_id = $1 AND agent_id = $2 AND status = 'ACTIVE'
         ORDER BY created_at DESC LIMIT 1`,
        [organizationId, agentId]
      );
      if (authRows.length > 0) {
        await AuthorityService.recordSpend(authRows[0].id, amountPaise);
      }

      // D. Audit Event
      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment.succeeded',
        resourceType: 'payment',
        resourceId: paymentId,
        newState: {
          intent_id: intentId,
          status: 'succeeded',
          provider_payment_id: providerPaymentId,
          amount_paise: amountPaise,
        },
      });

    } else if (status === 'failed') {
      // A. Payment Failed
      await db.query(
        `UPDATE payments
         SET status = 'failed',
             provider_payment_id = $1,
             provider_status = $2,
             error_code = $3,
             error_description = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [providerPaymentId, providerStatus, errorCode || null, errorDescription || null, paymentId]
      );

      await db.query(
        `UPDATE payment_intents
         SET status = 'FAILED', denial_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [errorDescription || 'Payment execution declined by provider.', intentId]
      );

      // ⚠️ Invariant: NO ledger debit for failed payment!

      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment.failed',
        resourceType: 'payment',
        resourceId: paymentId,
        newState: {
          intent_id: intentId,
          status: 'failed',
          error_code: errorCode,
          error_description: errorDescription,
        },
      });

    } else if (status === 'processing') {
      // B. Payment Processing (in-flight on payment provider / order created awaiting webhook or settlement)
      await db.query(
        `UPDATE payments
         SET status = 'processing',
             provider_payment_id = $1,
             provider_status = $2,
             reconciliation_status = 'unreconciled',
             updated_at = NOW()
         WHERE id = $3`,
        [providerPaymentId, providerStatus, paymentId]
      );

      await db.query(
        `UPDATE payment_intents
         SET status = 'EXECUTING', updated_at = NOW()
         WHERE id = $1`,
        [intentId]
      );

      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment.processing',
        resourceType: 'payment',
        resourceId: paymentId,
        newState: {
          intent_id: intentId,
          status: 'processing',
          provider_payment_id: providerPaymentId,
          provider_status: providerStatus,
        },
      });

    } else {
      // C. UNKNOWN state
      // ⚠️ Financial Safety: UNKNOWN must remain UNKNOWN. Do NOT retry blindly.
      await db.query(
        `UPDATE payments
         SET status = 'unknown',
             provider_payment_id = $1,
             provider_status = $2,
             error_code = $3,
             error_description = $4,
             reconciliation_status = 'pending_reconciliation',
             updated_at = NOW()
         WHERE id = $5`,
        [providerPaymentId, providerStatus, errorCode || 'TIMEOUT', errorDescription || 'Transaction status uncertain', paymentId]
      );

      // Intent remains in EXECUTING with flag
      await db.query(
        `UPDATE payment_intents
         SET status = 'EXECUTING', updated_at = NOW()
         WHERE id = $1`,
        [intentId]
      );

      // ⚠️ Invariant: NO false ledger debit!

      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment.unknown_state_flagged',
        resourceType: 'payment',
        resourceId: paymentId,
        newState: {
          intent_id: intentId,
          status: 'unknown',
          provider_status: providerStatus,
          reconciliation_required: true,
        },
      });
    }

    // Return updated records
    const { rows: updatedPayments } = await db.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const { rows: updatedIntents } = await db.query('SELECT * FROM payment_intents WHERE id = $1', [intentId]);

    return {
      payment: updatedPayments[0],
      intent: updatedIntents[0],
      providerResult: result,
    };
  }

  /**
   * Dispatches a refund for a previously succeeded payment.
   * Enforces:
   * 1. Payment must exist and be in 'succeeded' state.
   * 2. Calls provider refund adapter with provider credentials.
   * 3. Upon verified provider refund, records an immutable REFUND entry in the ledger.
   * 4. Emits tamper-evident audit event.
   */
  static async refundPayment(
    paymentId: string,
    organizationId: string,
    options: { amountPaise?: number; reason?: string } = {}
  ): Promise<{ payment: PaymentRecord; refundResult: any; ledgerEntryId?: string }> {
    const { rows: paymentRows } = await db.query(
      `SELECT * FROM payments WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [paymentId, organizationId]
    );

    if (paymentRows.length === 0) {
      throw new PaymentExecutionError('Payment record not found.', 'PAYMENT_NOT_FOUND');
    }

    const payment: PaymentRecord = paymentRows[0];

    if (payment.status !== 'succeeded') {
      throw new PaymentExecutionError(
        `Cannot refund payment with status "${payment.status}". Only "succeeded" payments can be refunded.`,
        'PAYMENT_NOT_SUCCEEDED'
      );
    }

    const refundAmount = options.amountPaise || payment.amount_paise;
    if (refundAmount <= 0 || refundAmount > payment.amount_paise) {
      throw new PaymentExecutionError(
        `Invalid refund amount ${refundAmount} paise. Must be positive and <= original payment amount (${payment.amount_paise} paise).`,
        'INVALID_REFUND_AMOUNT'
      );
    }

    const { provider, config } = await ProviderRegistry.resolveActiveProvider(organizationId);
    if (!provider.refundPayment) {
      throw new PaymentExecutionError(
        `Provider "${provider.name}" does not support refund execution.`,
        'REFUND_NOT_SUPPORTED'
      );
    }

    const refundId = ulid();
    const refundResult = await provider.refundPayment(
      {
        refundId,
        paymentId: payment.id,
        providerPaymentId: payment.provider_payment_id || payment.id,
        amountPaise: refundAmount,
        currency: payment.currency,
        reason: options.reason || 'Frame refund',
        idempotencyKey: `rfnd_${payment.id}`,
      },
      config
    );

    let ledgerEntryId: string | undefined;

    if (refundResult.status === 'succeeded') {
      // Record immutable REFUND entry in Ledger
      const { id } = await LedgerService.recordEntry({
        organizationId,
        paymentIntentId: payment.payment_intent_id,
        paymentId: payment.id,
        entryType: 'REFUND',
        amountPaise: refundAmount,
        currency: payment.currency,
        providerReference: refundResult.providerRefundId,
        description: `Refund for payment ${payment.id}: ${options.reason || 'Requested by merchant/user'}`,
      });
      ledgerEntryId = id;

      await createAuditEvent({
        organizationId,
        actorType: 'system',
        action: 'payment.refunded',
        resourceType: 'payment',
        resourceId: payment.id,
        newState: {
          refund_id: refundResult.providerRefundId,
          amount_paise: refundAmount,
          currency: payment.currency,
          ledger_entry_id: ledgerEntryId,
        },
      });
    }

    return {
      payment,
      refundResult,
      ledgerEntryId,
    };
  }
}
