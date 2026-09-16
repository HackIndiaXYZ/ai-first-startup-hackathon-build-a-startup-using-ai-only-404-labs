import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as crypto from 'crypto';
import { ulid } from 'ulid';
import { db } from '../../db';
import { requireUserAuth, requireAgentAuth, requireAnyAuth } from '../../middleware/auth';
import { createAuditEvent } from '../../lib/audit';
import { evaluatePolicy } from '../policies/firewall';

const CreateIntentSchema = z.object({
  amount_paise: z.number().int().positive({ message: 'Amount must be a positive integer in paise.' }),
  currency: z.string().default('INR'),
  merchant: z.string().min(1).max(255),
  merchant_reference: z.string().max(255).optional(),
  purpose: z.string().min(1).max(1000),
  task_reference: z.string().max(255).optional(),
  idempotency_key: z.string().min(1).max(255),
  metadata: z.record(z.unknown()).optional(),
  expires_in_seconds: z.number().int().positive().default(3600),
  category: z.string().max(100).optional(),
});

import { computeCanonicalIntentHash } from '../payments/domain/intent-hasher';
import { PaymentOrchestrator } from '../payments/orchestrator/payment-orchestrator';
import { IdempotencyService, IdempotencyConflictError } from '../payments/orchestrator/idempotency.service';

export async function paymentIntentRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/payment-intents  (agent or user can create)
  app.post('/', { preHandler: requireAnyAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const body = CreateIntentSchema.parse(request.body);

    const agentId = ctx.agentId || (request.body as Record<string, string>).agent_id;
    if (!agentId) {
      return reply.code(422).send({ error: { code: 'AGENT_REQUIRED', message: 'agent_id is required.' } });
    }

    // Verify agent is active and belongs to org
    const { rows: agentRows } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [agentId, ctx.organizationId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found.' } });
    }
    if (agentRows[0].status !== 'active') {
      return reply.code(403).send({ error: { code: 'AGENT_DISABLED', message: 'This agent is disabled or revoked.' } });
    }

    // ── Enterprise Idempotency & Atomic Lock ─────────────
    let lock;
    try {
      lock = await IdempotencyService.acquireLock(
        ctx.organizationId,
        body.idempotency_key,
        '/v1/payment-intents',
        body
      );
    } catch (err: any) {
      if (err instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }

    if (lock.isCached && lock.cachedResponse) {
      return reply.code(lock.cachedResponse.statusCode).send(lock.cachedResponse.body);
    }

    // Get active policy for this agent
    const { rows: policyRows } = await db.query(
      `SELECT p.current_version_id, p.id as policy_id
       FROM policies p
       WHERE p.agent_id = $1 AND p.organization_id = $2 AND p.status = 'active'
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [agentId, ctx.organizationId]
    );

    if (policyRows.length === 0 || !policyRows[0].current_version_id) {
      return reply.code(422).send({
        error: {
          code: 'NO_POLICY',
          message: 'No active policy found for this agent. Configure a policy before creating payment intents.',
        }
      });
    }

    const policyVersionId = policyRows[0].current_version_id;

    const intentId = ulid();
    const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000);
    const intentHash = computeCanonicalIntentHash({
      organization_id: ctx.organizationId,
      agent_id: agentId,
      amount_paise: body.amount_paise,
      currency: body.currency,
      merchant: body.merchant,
      merchant_reference: body.merchant_reference || null,
      purpose: body.purpose,
      task_reference: body.task_reference || null,
      policy_version_id: policyVersionId,
      idempotency_key: body.idempotency_key,
      expires_at: expiresAt,
    });

    // Create intent in CREATED state
    await db.query(
      `INSERT INTO payment_intents (
        id, organization_id, agent_id, policy_version_id,
        amount_paise, currency, merchant, merchant_reference,
        purpose, task_reference, intent_hash, idempotency_key,
        status, metadata, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CREATED',$13,$14)`,
      [
        intentId, ctx.organizationId, agentId, policyVersionId,
        body.amount_paise, body.currency, body.merchant, body.merchant_reference || null,
        body.purpose, body.task_reference || null, intentHash, body.idempotency_key,
        JSON.stringify(body.metadata || {}), expiresAt,
      ]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: ctx.type,
      actorId: ctx.agentId || ctx.userId,
      action: 'payment_intent.created',
      resourceType: 'payment_intent',
      resourceId: intentId,
      newState: { amount_paise: body.amount_paise, merchant: body.merchant, status: 'CREATED' },
      requestId: request.id,
    });

    // ── Transition to EVALUATING ──────────────────────────
    await db.query(
      `UPDATE payment_intents SET status = 'EVALUATING', updated_at = NOW() WHERE id = $1`,
      [intentId]
    );

    // ── Run Policy Firewall ───────────────────────────────
    let firewallResult;
    try {
      firewallResult = await evaluatePolicy({
        organizationId: ctx.organizationId,
        agentId,
        amountPaise: body.amount_paise,
        merchant: body.merchant,
        category: body.category,
        policyVersionId,
        requireAuthority: body.metadata?.require_authority === true,
      });
    } catch (err) {
      await db.query(
        `UPDATE payment_intents SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
        [intentId]
      );
      throw err;
    }

    // Save decision
    const decisionId = ulid();
    await db.query(
      `INSERT INTO payment_decisions (id, payment_intent_id, policy_version_id, decision, reasons, risk_level)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [decisionId, intentId, policyVersionId, firewallResult.decision, JSON.stringify(firewallResult.reasons), firewallResult.riskLevel]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'system',
      action: 'payment_intent.evaluated',
      resourceType: 'payment_intent',
      resourceId: intentId,
      decision: firewallResult.decision,
      policyVersionId,
      newState: { decision: firewallResult.decision, reasons: firewallResult.reasons },
    });

    let newStatus: string;
    let denialReason: string | null = null;

    if (firewallResult.decision === 'ALLOW') {
      newStatus = 'AUTHORIZED';
    } else if (firewallResult.decision === 'DENY') {
      newStatus = 'DENIED';
      denialReason = firewallResult.reasons.join('; ');
    } else {
      // REQUIRE_APPROVAL
      newStatus = 'PENDING_APPROVAL';
    }

    await db.query(
      `UPDATE payment_intents
       SET status = $1, decision = $2, denial_reason = $3, updated_at = NOW()
       WHERE id = $4`,
      [newStatus, firewallResult.decision, denialReason, intentId]
    );

    // If approval required, create approval task
    if (newStatus === 'PENDING_APPROVAL') {
      const approvalId = ulid();
      const approvalExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      await db.query(
        `INSERT INTO approval_tasks (id, payment_intent_id, organization_id, required_role, expires_at)
         VALUES ($1,$2,$3,'approver',$4)`,
        [approvalId, intentId, ctx.organizationId, approvalExpiry]
      );

      await createAuditEvent({
        organizationId: ctx.organizationId,
        actorType: 'system',
        action: 'approval_task.created',
        resourceType: 'approval_task',
        resourceId: approvalId,
        newState: { payment_intent_id: intentId },
      });
    }

    // Fetch current intent state
    const { rows: finalRows } = await db.query(
      'SELECT * FROM payment_intents WHERE id = $1',
      [intentId]
    );

    let finalIntent = finalRows[0];
    if (newStatus === 'AUTHORIZED') {
      try {
        const orchestrated = await PaymentOrchestrator.executeIntent(intentId, ctx.organizationId);
        finalIntent = orchestrated.intent;
      } catch (err) {
        request.log.error(err, 'Payment execution error in orchestrator');
      }
    }

    const responsePayload = {
      data: {
        ...finalIntent,
        firewall: {
          decision: firewallResult.decision,
          reasons: firewallResult.reasons,
          risk_level: firewallResult.riskLevel,
        },
      }
    };

    await lock.unlock(201, responsePayload);
    return reply.code(201).send(responsePayload);
  });

  // GET /v1/payment-intents
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const query = request.query as { status?: string; agent_id?: string; page?: string; per_page?: string };
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(query.per_page || '20', 10)));
    const offset = (page - 1) * perPage;

    let whereClauses = ['pi.organization_id = $1'];
    const params: unknown[] = [ctx.organizationId];
    let idx = 2;

    if (query.status) {
      whereClauses.push(`pi.status = $${idx++}`);
      params.push(query.status);
    }
    if (query.agent_id) {
      whereClauses.push(`pi.agent_id = $${idx++}`);
      params.push(query.agent_id);
    }

    const where = whereClauses.join(' AND ');

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM payment_intents pi WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0].count, 10);

    const { rows } = await db.query(
      `SELECT pi.*, a.name as agent_name
       FROM payment_intents pi
       JOIN agents a ON a.id = pi.agent_id
       WHERE ${where}
       ORDER BY pi.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, perPage, offset]
    );

    return reply.send({
      data: rows,
      meta: { total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) },
    });
  });

  // GET /v1/payment-intents/:id
  app.get('/:id', { preHandler: requireAnyAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    let query = `SELECT pi.*,
              a.name as agent_name, a.status as agent_status,
              pd.decision as firewall_decision, pd.reasons, pd.risk_level,
              at2.id as approval_task_id, at2.status as approval_status
       FROM payment_intents pi
       JOIN agents a ON a.id = pi.agent_id
       LEFT JOIN payment_decisions pd ON pd.payment_intent_id = pi.id
       LEFT JOIN approval_tasks at2 ON at2.payment_intent_id = pi.id
       WHERE pi.id = $1 AND pi.organization_id = $2`;
    const params: unknown[] = [id, ctx.organizationId];

    if (ctx.type === 'agent' && ctx.agentId) {
      query += ' AND pi.agent_id = $3';
      params.push(ctx.agentId);
    }

    const { rows } = await db.query(query, params);

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Payment intent not found.' } });
    }

    return reply.send({ data: rows[0] });
  });

  // POST /v1/payment-intents/:id/request-approval (Agent requests human review for PENDING_APPROVAL)
  app.post('/:id/request-approval', { preHandler: requireAgentAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { notes?: string };

    const { rows: intentRows } = await db.query(
      `SELECT pi.*, pd.decision as firewall_decision
       FROM payment_intents pi
       LEFT JOIN payment_decisions pd ON pd.payment_intent_id = pi.id
       WHERE pi.id = $1 AND pi.organization_id = $2 AND pi.agent_id = $3`,
      [id, ctx.organizationId, ctx.agentId]
    );

    if (intentRows.length === 0) {
      return reply.code(404).send({
        error: { code: 'INTENT_NOT_FOUND', message: 'Payment intent not found or access denied.' }
      });
    }

    const intent = intentRows[0];
    if (intent.status !== 'PENDING_APPROVAL') {
      return reply.code(400).send({
        error: {
          code: 'INVALID_STATE',
          message: `Payment intent is in '${intent.status}' state, not PENDING_APPROVAL.`
        }
      });
    }

    // Locate or create approval task
    const { rows: taskRows } = await db.query(
      `SELECT * FROM approval_tasks WHERE payment_intent_id = $1 AND organization_id = $2 ORDER BY requested_at DESC LIMIT 1`,
      [id, ctx.organizationId]
    );

    let task = taskRows[0];
    if (!task) {
      const approvalId = ulid();
      const approvalExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const { rows: newTask } = await db.query(
        `INSERT INTO approval_tasks (id, payment_intent_id, organization_id, required_role, expires_at)
         VALUES ($1,$2,$3,'approver',$4) RETURNING *`,
        [approvalId, id, ctx.organizationId, approvalExpiry]
      );
      task = newTask[0];
    }

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'agent',
      actorId: ctx.agentId,
      action: 'payment_intent.approval_requested',
      resourceType: 'payment_intent',
      resourceId: id,
      newState: { approval_task_id: task.id, status: task.status, notes: body.notes },
    });

    return reply.send({
      data: {
        payment_intent_id: id,
        decision: 'REQUIRE_APPROVAL',
        status: intent.status,
        approval_task_id: task.id,
        approval_status: task.status,
        expires_at: task.expires_at,
        next_action: 'WAIT_FOR_APPROVAL',
        message: 'Human approval has been requested. Check status using frame_get_payment_status once approved.'
      }
    });
  });
}
