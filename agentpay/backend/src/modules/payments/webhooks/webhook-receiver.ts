// Webhook Ingestion Engine
// Handles signature verification, raw event persistence, deduplication, and state updates.

import { ulid } from 'ulid';
import { db } from '../../../db';
import { createAuditEvent } from '../../../lib/audit';
import { ProviderRegistry } from '../providers/provider-registry';
import { PaymentOrchestrator } from '../orchestrator/payment-orchestrator';
import { PaymentStateMachine } from '../domain/payment-state-machine';

export interface WebhookProcessResult {
  status: 'processed' | 'deduplicated' | 'ignored_terminal' | 'unmatched';
  eventId: string;
  paymentId?: string;
  normalizedStatus?: string;
}

export class WebhookReceiver {
  /**
   * Securely processes inbound payment provider callbacks.
   */
  static async processWebhook(
    providerType: string,
    rawPayloadString: string,
    rawPayloadJson: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookProcessResult> {
    const provider = ProviderRegistry.get(providerType);

    // 1. Normalize Event Metadata
    const normalized = provider.normalizeWebhookEvent(rawPayloadJson);

    // 2. Find Matching Internal Payment by Provider Payment ID (order_id, payment_id, or receipt)
    const payloadWrapper = (rawPayloadJson.payload as Record<string, any>) || {};
    const altOrderId = payloadWrapper.payment?.entity?.order_id || payloadWrapper.order?.entity?.id;
    const altPaymentId = payloadWrapper.payment?.entity?.id;
    const altReceipt = payloadWrapper.order?.entity?.receipt || payloadWrapper.payment?.entity?.receipt;

    const { rows: paymentRows } = await db.query(
      `SELECT p.*, pi.agent_id
       FROM payments p
       JOIN payment_intents pi ON pi.id = p.payment_intent_id
       WHERE p.provider = $1 
         AND (
           p.provider_payment_id = $2 
           OR p.id = $2 
           OR ($3::text IS NOT NULL AND p.provider_payment_id = $3)
           OR ($4::text IS NOT NULL AND p.provider_payment_id = $4)
           OR ($5::text IS NOT NULL AND p.id = $5)
         )
       LIMIT 1`,
      [provider.providerType, normalized.providerPaymentId, altOrderId || null, altPaymentId || null, altReceipt || null]
    );

    let paymentId: string | null = null;
    let organizationId: string | null = null;
    let secret = '';

    if (paymentRows.length > 0) {
      paymentId = paymentRows[0].id;
      organizationId = paymentRows[0].organization_id;

      // 1. Check organization's specific provider_config secret
      if (paymentRows[0].provider_config_id) {
        const { rows: configRows } = await db.query(
          `SELECT webhook_secret FROM provider_configs WHERE id = $1`,
          [paymentRows[0].provider_config_id]
        );
        if (configRows.length > 0 && configRows[0].webhook_secret) {
          secret = configRows[0].webhook_secret;
        }
      }

      if (!secret && organizationId) {
        const { rows: orgConfigRows } = await db.query(
          `SELECT webhook_secret FROM provider_configs WHERE organization_id = $1 AND provider_type = $2 AND webhook_secret IS NOT NULL LIMIT 1`,
          [organizationId, provider.providerType]
        );
        if (orgConfigRows.length > 0 && orgConfigRows[0].webhook_secret) {
          secret = orgConfigRows[0].webhook_secret;
        }
      }
    }

    // 2. If not found on tenant, check default env secret or global provider_configs
    if (!secret) {
      secret = providerType === 'razorpay'
        ? (process.env.RAZORPAY_WEBHOOK_SECRET || '')
        : 'mock_webhook_secret_default';

      if (!secret || secret === 'YOUR_WEBHOOK_SECRET_HERE') {
        const { rows: configRows } = await db.query(
          `SELECT webhook_secret FROM provider_configs WHERE provider_type = $1 AND webhook_secret IS NOT NULL LIMIT 1`,
          [provider.providerType]
        );
        if (configRows.length > 0 && configRows[0].webhook_secret) {
          secret = configRows[0].webhook_secret;
        }
      }
    }

    // 3. Mandatory Cryptographic Signature Verification
    const isSignatureValid = provider.verifyWebhookSignature(
      rawPayloadString,
      headers,
      secret
    );

    if (!isSignatureValid) {
      // Record unverified attempt for forensic audit trail
      const providerEventId = ulid();
      await db.query(
        `INSERT INTO provider_events (
          id, provider, event_id, event_type, raw_payload, verified, processed, payment_id
        ) VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
        ON CONFLICT (provider, event_id) DO NOTHING`,
        [
          providerEventId,
          provider.providerType,
          normalized.eventId,
          normalized.eventType,
          JSON.stringify(rawPayloadJson),
          paymentId,
        ]
      );
      throw new Error(`Invalid webhook signature for provider "${providerType}".`);
    }

    // 4. Deduplication Check against provider_events (Replay Protection)
    const { rows: existingEvents } = await db.query(
      `SELECT * FROM provider_events WHERE provider = $1 AND event_id = $2 LIMIT 1`,
      [provider.providerType, normalized.eventId]
    );

    if (existingEvents.length > 0 && existingEvents[0].verified) {
      // Event already recorded & processed/verified
      return {
        status: 'deduplicated',
        eventId: normalized.eventId,
        paymentId: existingEvents[0].payment_id || paymentId,
      };
    }

    // 5. Store Valid Raw Event in provider_events for Auditability & Replay Protection
    const providerEventId = ulid();
    await db.query(
      `INSERT INTO provider_events (
        id, provider, event_id, event_type, raw_payload, verified, processed, payment_id
      ) VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6)
      ON CONFLICT (provider, event_id) DO UPDATE SET
        verified = EXCLUDED.verified,
        raw_payload = EXCLUDED.raw_payload,
        payment_id = COALESCE(provider_events.payment_id, EXCLUDED.payment_id)`,
      [
        providerEventId,
        provider.providerType,
        normalized.eventId,
        normalized.eventType,
        JSON.stringify(rawPayloadJson),
        paymentId,
      ]
    );

    if (!paymentRows || paymentRows.length === 0) {
      await db.query(
        `UPDATE provider_events SET processed = TRUE, processed_at = NOW() WHERE id = $1`,
        [providerEventId]
      );
      return {
        status: 'unmatched',
        eventId: normalized.eventId,
      };
    }

    const payment = paymentRows[0];

    // 6. Out-of-Order Webhook Protection
    // If payment is already in a terminal state (succeeded or failed), do NOT regress state.
    if (PaymentStateMachine.isTerminal(payment.status)) {
      await db.query(
        `UPDATE provider_events SET processed = TRUE, processed_at = NOW() WHERE id = $1`,
        [providerEventId]
      );
      return {
        status: 'ignored_terminal',
        eventId: normalized.eventId,
        paymentId: payment.id,
      };
    }

    // 7. Apply Transition via Orchestrator
    await PaymentOrchestrator.applyPaymentResult(
      payment.id,
      payment.payment_intent_id,
      payment.organization_id,
      payment.agent_id,
      payment.amount_paise,
      payment.currency,
      {
        providerPaymentId: normalized.providerPaymentId,
        status: normalized.status,
        providerStatus: normalized.providerStatus,
        rawResponse: rawPayloadJson,
      }
    );

    // 8. Mark Event as Processed
    await db.query(
      `UPDATE provider_events SET processed = TRUE, processed_at = NOW() WHERE id = $1`,
      [providerEventId]
    );

    return {
      status: 'processed',
      eventId: normalized.eventId,
      paymentId: payment.id,
      normalizedStatus: normalized.status,
    };
  }
}
