// Payment Infrastructure Routes

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { db } from '../../db';
import { requireUserAuth, requireAnyAuth } from '../../middleware/auth';
import { PaymentOrchestrator } from './orchestrator/payment-orchestrator';
import { WebhookReceiver } from './webhooks/webhook-receiver';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { ProviderRegistry } from './providers/provider-registry';

const ConfigureProviderSchema = z.object({
  provider_type: z.string().min(1),
  name: z.string().min(1).max(255),
  is_default: z.boolean().default(false),
  webhook_secret: z.string().optional(),
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

export async function paymentInfrastructureRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /v1/payments ──────────────────────────────────
  app.get('/payments', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const q = request.query as { status?: string; agent_id?: string; page?: string; per_page?: string };
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(q.per_page || '20', 10)));
    const offset = (page - 1) * perPage;

    let where = 'p.organization_id = $1';
    const params: unknown[] = [ctx.organizationId];
    let idx = 2;

    if (q.status) {
      where += ` AND p.status = $${idx++}`;
      params.push(q.status);
    }
    if (q.agent_id) {
      where += ` AND pi.agent_id = $${idx++}`;
      params.push(q.agent_id);
    }

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM payments p JOIN payment_intents pi ON pi.id = p.payment_intent_id WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0].count, 10);

    const { rows } = await db.query(
      `SELECT p.*, pi.merchant, pi.purpose, pi.amount_paise as intent_amount,
              pi.agent_id, pi.status as intent_status, a.name as agent_name
       FROM payments p
       JOIN payment_intents pi ON pi.id = p.payment_intent_id
       JOIN agents a ON a.id = pi.agent_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, perPage, offset]
    );

    return reply.send({
      data: rows,
      meta: { total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) },
    });
  });

  // ── GET /v1/payments/:id ──────────────────────────────
  app.get('/payments/:id', { preHandler: requireAnyAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `SELECT p.*,
              pi.merchant, pi.purpose, pi.agent_id, pi.status as intent_status,
              a.name as agent_name,
              le.entry_hash, le.amount_paise as ledger_amount
       FROM payments p
       JOIN payment_intents pi ON pi.id = p.payment_intent_id
       JOIN agents a ON a.id = pi.agent_id
       LEFT JOIN ledger_entries le ON le.payment_id = p.id
       WHERE p.id = $1 AND p.organization_id = $2`,
      [id, ctx.organizationId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    }

    const { rows: attempts } = await db.query(
      `SELECT * FROM payment_attempts WHERE payment_id = $1 ORDER BY attempt_number ASC`,
      [id]
    );

    return reply.send({
      data: {
        ...rows[0],
        attempts,
      },
    });
  });

  // ── POST /v1/payments/:id/refund ──────────────────────
  app.post('/payments/:id/refund', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { amount_paise?: number; reason?: string };

    try {
      const result = await PaymentOrchestrator.refundPayment(id, ctx.organizationId, {
        amountPaise: body.amount_paise,
        reason: body.reason,
      });

      return reply.code(200).send({
        status: result.refundResult.status.toUpperCase(),
        data: {
          payment: result.payment,
          refund: result.refundResult,
          ledger_entry_id: result.ledgerEntryId,
        },
        message: 'Payment refund processed successfully.',
      });
    } catch (err: any) {
      const code = err.code || 'REFUND_ERROR';
      const statusCode = code === 'PAYMENT_NOT_FOUND' ? 404 : 400;
      return reply.code(statusCode).send({
        error: { code, message: err.message },
      });
    }
  });

  // ── POST /v1/payment-intents/:id/execute ──────────────
  app.post('/payment-intents/:id/execute', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    try {
      const prepared = await PaymentOrchestrator.prepareExecution(id, ctx.organizationId);
      return reply.code(202).send({
        status: 'ACCEPTED',
        data: {
          intent: prepared.intent,
          payment: prepared.payment,
          job_id: prepared.jobId,
        },
        message: 'Payment execution queued successfully. External provider execution is processed asynchronously.',
      });
    } catch (err: any) {
      return reply.code(400).send({
        error: { code: err.code || 'EXECUTION_FAILED', message: err.message },
      });
    }
  });

  // ── Providers Management ──────────────────────────────

  // GET /v1/providers — list available providers & configs
  app.get('/providers', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const available = ProviderRegistry.listAvailable();

    const { rows: configured } = await db.query(
      `SELECT id, provider_type, name, is_default, status, created_at, updated_at
       FROM provider_configs
       WHERE organization_id = $1
       ORDER BY created_at ASC`,
      [ctx.organizationId]
    );

    return reply.send({
      data: {
        available_providers: available,
        configured_providers: configured,
      }
    });
  });

  // POST /v1/providers — configure a provider
  app.post('/providers', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const body = ConfigureProviderSchema.parse(request.body);

    const configId = ulid();

    // If is_default, unmark previous default
    if (body.is_default) {
      await db.query(
        `UPDATE provider_configs SET is_default = FALSE WHERE organization_id = $1`,
        [ctx.organizationId]
      );
    }

    await db.query(
      `INSERT INTO provider_configs (
        id, organization_id, provider_type, name, is_default, webhook_secret, settings
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (organization_id, provider_type) DO UPDATE
      SET name = EXCLUDED.name,
          is_default = EXCLUDED.is_default,
          webhook_secret = EXCLUDED.webhook_secret,
          settings = EXCLUDED.settings,
          updated_at = NOW()`,
      [
        configId,
        ctx.organizationId,
        body.provider_type,
        body.name,
        body.is_default,
        body.webhook_secret || null,
        JSON.stringify(body.settings || {}),
      ]
    );

    return reply.code(201).send({
      message: `Provider "${body.name}" configured successfully.`,
    });
  });

  // ── Inbound Webhooks ──────────────────────────────────

  // POST /v1/webhooks/:provider
  app.post('/webhooks/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const rawPayload = request.body as Record<string, unknown>;
    const rawPayloadString = JSON.stringify(rawPayload);

    try {
      const result = await WebhookReceiver.processWebhook(
        provider,
        rawPayloadString,
        rawPayload,
        request.headers
      );

      return reply.code(200).send({
        status: 'ok',
        result,
      });
    } catch (err: any) {
      return reply.code(400).send({
        error: { code: 'WEBHOOK_PROCESSING_FAILED', message: err.message },
      });
    }
  });

  // GET /v1/webhooks/events — list received webhook events for auditability
  app.get('/webhooks/events', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { rows } = await db.query(
      `SELECT pe.id, pe.provider, pe.event_id, pe.event_type, pe.verified, pe.processed, pe.processed_at, pe.payment_id, pe.created_at,
              p.amount_paise, p.currency, p.status as payment_status
       FROM provider_events pe
       LEFT JOIN payments p ON p.id = pe.payment_id
       WHERE p.organization_id = $1 OR pe.payment_id IS NULL
       ORDER BY pe.created_at DESC
       LIMIT 50`,
      [ctx.organizationId]
    );
    return reply.send({ data: rows });
  });

  // ── Reconciliation ────────────────────────────────────

  // POST /v1/reconciliation/run
  app.post('/reconciliation/run', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const summary = await ReconciliationService.reconcileOrganization(ctx.organizationId);

    return reply.code(200).send({
      data: summary,
      message: `Reconciliation complete. ${summary.resolvedCount} payments resolved, ${summary.discrepancyCount} discrepancies noted.`,
    });
  });

  // GET /v1/reconciliation/runs
  app.get('/reconciliation/runs', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { rows } = await db.query(
      `SELECT * FROM reconciliation_runs
       WHERE organization_id = $1
       ORDER BY started_at DESC
       LIMIT 20`,
      [ctx.organizationId]
    );

    return reply.send({ data: rows });
  });
}
