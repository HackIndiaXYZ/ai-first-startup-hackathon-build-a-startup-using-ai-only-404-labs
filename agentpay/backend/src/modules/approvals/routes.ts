import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { requireUserAuth } from '../../middleware/auth';
import { createAuditEvent } from '../../lib/audit';
import { ulid } from 'ulid';
import * as crypto from 'crypto';
import { PaymentOrchestrator } from '../payments/orchestrator/payment-orchestrator';

const ApprovalActionSchema = z.object({
  comment: z.string().max(1000).optional(),
});

export async function approvalRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/approvals — list pending approvals
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const query = request.query as { status?: string };

    const statusFilter = query.status || 'pending';

    const { rows } = await db.query(
      `SELECT at2.*,
              pi.amount_paise, pi.currency, pi.merchant, pi.purpose, pi.merchant_reference,
              pi.task_reference, pi.status as intent_status, pi.agent_id,
              a.name as agent_name,
              pd.reasons, pd.risk_level
       FROM approval_tasks at2
       JOIN payment_intents pi ON pi.id = at2.payment_intent_id
       JOIN agents a ON a.id = pi.agent_id
       LEFT JOIN payment_decisions pd ON pd.payment_intent_id = pi.id
       WHERE at2.organization_id = $1 AND at2.status = $2
       ORDER BY at2.requested_at DESC`,
      [ctx.organizationId, statusFilter]
    );

    return reply.send({ data: rows });
  });

  // GET /v1/approvals/:id
  app.get('/:id', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `SELECT at2.*,
              pi.*, a.name as agent_name, pd.reasons, pd.risk_level
       FROM approval_tasks at2
       JOIN payment_intents pi ON pi.id = at2.payment_intent_id
       JOIN agents a ON a.id = pi.agent_id
       LEFT JOIN payment_decisions pd ON pd.payment_intent_id = pi.id
       WHERE at2.id = $1 AND at2.organization_id = $2`,
      [id, ctx.organizationId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Approval task not found.' } });
    }

    return reply.send({ data: rows[0] });
  });

  // POST /v1/approvals/:id/approve
  app.post('/:id/approve', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = ApprovalActionSchema.parse(request.body || {});

    // Verify approver role
    if (!['owner', 'admin', 'approver'].includes(ctx.role || '')) {
      return reply.code(403).send({
        error: { code: 'INSUFFICIENT_ROLE', message: 'You need the "approver" role or higher to approve payments.' }
      });
    }

    const { rows: taskRows } = await db.query(
      `SELECT at2.*, pi.status as intent_status, pi.intent_hash, pi.agent_id
       FROM approval_tasks at2
       JOIN payment_intents pi ON pi.id = at2.payment_intent_id
       WHERE at2.id = $1 AND at2.organization_id = $2`,
      [id, ctx.organizationId]
    );

    if (taskRows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Approval task not found.' } });
    }

    const task = taskRows[0];

    // Security checks
    if (task.status !== 'pending') {
      return reply.code(409).send({
        error: { code: 'ALREADY_DECIDED', message: `Approval is already ${task.status}.` }
      });
    }
    if (new Date(task.expires_at) < new Date()) {
      await db.query(`UPDATE approval_tasks SET status = 'expired' WHERE id = $1`, [id]);
      return reply.code(409).send({
        error: { code: 'APPROVAL_EXPIRED', message: 'This approval request has expired.' }
      });
    }
    if (task.intent_status !== 'PENDING_APPROVAL') {
      return reply.code(409).send({
        error: { code: 'INVALID_INTENT_STATE', message: 'Payment intent is not in PENDING_APPROVAL state.' }
      });
    }

    // Verify authority is not revoked before dispatching approval
    const { rows: authCheck } = await db.query(
      `SELECT * FROM payment_authorities
       WHERE organization_id = $1 AND agent_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.organizationId, task.agent_id]
    );
    if (authCheck.length > 0 && (authCheck[0].status === 'REVOKED' || authCheck[0].status === 'SUSPENDED')) {
      await db.query(
        `UPDATE payment_intents SET status = 'DENIED', denial_reason = 'Payment authority is revoked or suspended.', updated_at = NOW() WHERE id = $1`,
        [task.payment_intent_id]
      );
      await db.query(
        `UPDATE approval_tasks SET status = 'rejected', decided_by = $1, decided_at = NOW(), comment = 'Authority revoked' WHERE id = $2`,
        [ctx.userId, id]
      );
      return reply.code(403).send({
        error: { code: 'AUTHORITY_REVOKED', message: 'Payment authority is revoked or suspended.' }
      });
    }

    await db.query('BEGIN');
    try {
      await db.query(
        `UPDATE approval_tasks
         SET status = 'approved', decided_by = $1, decided_at = NOW(), comment = $2
         WHERE id = $3`,
        [ctx.userId, body.comment || null, id]
      );

      await db.query(
        `UPDATE payment_intents SET status = 'AUTHORIZED', updated_at = NOW() WHERE id = $1`,
        [task.payment_intent_id]
      );

      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'approval.approved',
      resourceType: 'approval_task',
      resourceId: id,
      newState: { status: 'approved', comment: body.comment },
    });

    // Execute approved intent via central PaymentOrchestrator
    try {
      await PaymentOrchestrator.executeIntent(task.payment_intent_id, ctx.organizationId);
    } catch (err: any) {
      request.log.error(err, 'Payment execution error following approval');
    }

    const { rows: updatedTask } = await db.query(
      'SELECT * FROM approval_tasks WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );

    return reply.send({
      data: updatedTask[0],
      message: 'Payment approved and executed via payment orchestrator.',
    });
  });

  // POST /v1/approvals/:id/reject
  app.post('/:id/reject', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = ApprovalActionSchema.parse(request.body || {});

    if (!['owner', 'admin', 'approver'].includes(ctx.role || '')) {
      return reply.code(403).send({
        error: { code: 'INSUFFICIENT_ROLE', message: 'You need the "approver" role or higher to reject payments.' }
      });
    }

    const { rows: taskRows } = await db.query(
      `SELECT at2.*, pi.status as intent_status
       FROM approval_tasks at2
       JOIN payment_intents pi ON pi.id = at2.payment_intent_id
       WHERE at2.id = $1 AND at2.organization_id = $2`,
      [id, ctx.organizationId]
    );

    if (taskRows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Approval task not found.' } });
    }

    const task = taskRows[0];

    if (task.status !== 'pending') {
      return reply.code(409).send({
        error: { code: 'ALREADY_DECIDED', message: `Approval is already ${task.status}.` }
      });
    }

    await db.query('BEGIN');
    try {
      await db.query(
        `UPDATE approval_tasks SET status = 'rejected', decided_by = $1, decided_at = NOW(), comment = $2 WHERE id = $3`,
        [ctx.userId, body.comment || null, id]
      );
      await db.query(
        `UPDATE payment_intents SET status = 'REJECTED', updated_at = NOW() WHERE id = $1`,
        [task.payment_intent_id]
      );
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'approval.rejected',
      resourceType: 'approval_task',
      resourceId: id,
      newState: { status: 'rejected', comment: body.comment },
    });

    const { rows } = await db.query(
      'SELECT * FROM approval_tasks WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    return reply.send({ data: rows[0] });
  });
}
