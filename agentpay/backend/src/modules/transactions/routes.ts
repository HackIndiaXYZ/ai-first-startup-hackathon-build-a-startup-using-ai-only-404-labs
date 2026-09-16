import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { requireUserAuth } from '../../middleware/auth';

export async function transactionRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/transactions
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const q = request.query as { agent_id?: string; status?: string; page?: string; per_page?: string };
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(q.per_page || '20', 10)));
    const offset = (page - 1) * perPage;

    let where = 'p.organization_id = $1';
    const params: unknown[] = [ctx.organizationId];
    let idx = 2;

    if (q.status) { where += ` AND p.status = $${idx++}`; params.push(q.status); }
    if (q.agent_id) { where += ` AND pi.agent_id = $${idx++}`; params.push(q.agent_id); }

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM payments p JOIN payment_intents pi ON pi.id = p.payment_intent_id WHERE ${where}`,
      params
    );

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

    const total = parseInt(countRows[0].count, 10);
    return reply.send({
      data: rows,
      meta: { total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) },
    });
  });

  // GET /v1/transactions/:id
  app.get('/:id', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `SELECT p.id as id, p.id as payment_id, p.status as payment_status, p.status as status,
              p.amount_paise, p.currency, p.provider, p.provider_payment_id, p.rail,
              p.error_code, p.error_description, p.settled_at, p.reconciled_at, p.reconciliation_status,
              p.created_at, p.updated_at,
              pi.id as payment_intent_id, pi.merchant, pi.purpose, pi.merchant_reference,
              pi.status as intent_status, pi.decision, pi.denial_reason,
              a.id as agent_id, a.name as agent_name,
              le.id as ledger_id, le.entry_type as ledger_entry_type,
              le.amount_paise as ledger_amount, le.entry_hash
       FROM payments p
       JOIN payment_intents pi ON pi.id = p.payment_intent_id
       JOIN agents a ON a.id = pi.agent_id
       LEFT JOIN ledger_entries le ON le.payment_id = p.id
       WHERE (p.id = $1 OR pi.id = $1) AND p.organization_id = $2
       ORDER BY p.created_at DESC LIMIT 1`,
      [id, ctx.organizationId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Transaction not found.' } });
    }

    const tx = rows[0];
    const { rows: ledgerEntries } = await db.query(
      `SELECT * FROM ledger_entries WHERE payment_id = $1 ORDER BY recorded_at ASC`,
      [tx.id]
    );

    return reply.send({
      data: {
        ...tx,
        ledger_entries: ledgerEntries,
      },
    });
  });

  // POST /v1/transactions/:id/refund
  app.post('/:id/refund', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { amount_paise?: number; reason?: string };

    const { PaymentOrchestrator } = await import('../payments/orchestrator/payment-orchestrator');

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
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/audit-events
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const q = request.query as { resource_type?: string; resource_id?: string; page?: string; per_page?: string };
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(q.per_page || '50', 10)));
    const offset = (page - 1) * perPage;

    let where = 'ae.organization_id = $1';
    const params: unknown[] = [ctx.organizationId];
    let idx = 2;

    if (q.resource_type) { where += ` AND ae.resource_type = $${idx++}`; params.push(q.resource_type); }
    if (q.resource_id) { where += ` AND ae.resource_id = $${idx++}`; params.push(q.resource_id); }

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM audit_events ae WHERE ${where}`, params
    );
    const { rows } = await db.query(
      `SELECT ae.* FROM audit_events ae
       WHERE ${where}
       ORDER BY ae.occurred_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, perPage, offset]
    );

    const total = parseInt(countRows[0].count, 10);
    return reply.send({
      data: rows,
      meta: { total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) },
    });
  });
}

export async function ledgerRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/ledger
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const q = request.query as { agent_id?: string; page?: string; per_page?: string };
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(q.per_page || '20', 10)));
    const offset = (page - 1) * perPage;

    let where = 'le.organization_id = $1';
    const params: unknown[] = [ctx.organizationId];
    let idx = 2;

    if (q.agent_id) { where += ` AND le.agent_id = $${idx++}`; params.push(q.agent_id); }

    const { rows } = await db.query(
      `SELECT le.*, a.name as agent_name, pi.merchant, pi.purpose
       FROM ledger_entries le
       LEFT JOIN agents a ON a.id = le.agent_id
       LEFT JOIN payment_intents pi ON pi.id = le.payment_intent_id
       WHERE ${where}
       ORDER BY le.recorded_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, perPage, offset]
    );

    return reply.send({ data: rows });
  });
}

export async function overviewRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/overview
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const orgId = ctx.organizationId;

    const [agents, intents, pending, blocked, totalSpend, todaySpend] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM agents WHERE organization_id = $1 AND status = 'active'`, [orgId]),
      db.query(`SELECT status, COUNT(*) as count FROM payment_intents WHERE organization_id = $1 GROUP BY status`, [orgId]),
      db.query(`SELECT COUNT(*) FROM approval_tasks WHERE organization_id = $1 AND status = 'pending'`, [orgId]),
      db.query(`SELECT COUNT(*) FROM payment_intents WHERE organization_id = $1 AND status = 'DENIED'`, [orgId]),
      db.query(`SELECT COALESCE(SUM(amount_paise),0) as total FROM payment_intents WHERE organization_id = $1 AND status = 'SUCCEEDED'`, [orgId]),
      db.query(`SELECT COALESCE(SUM(amount_paise),0) as total FROM payment_intents WHERE organization_id = $1 AND status = 'SUCCEEDED' AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`, [orgId]),
    ]);

    const intentsByStatus = Object.fromEntries(
      intents.rows.map(r => [r.status, parseInt(r.count, 10)])
    );
    const totalSucceeded = intentsByStatus['SUCCEEDED'] || 0;
    const totalAll = Object.values(intentsByStatus).reduce((a: number, b) => a + (b as number), 0);

    return reply.send({
      data: {
        active_agents: parseInt(agents.rows[0].count, 10),
        pending_approvals: parseInt(pending.rows[0].count, 10),
        blocked_payments: parseInt(blocked.rows[0].count, 10),
        total_spend_paise: parseInt(totalSpend.rows[0].total, 10),
        today_spend_paise: parseInt(todaySpend.rows[0].total, 10),
        payment_success_rate: totalAll > 0 ? Math.round((totalSucceeded / totalAll) * 100) : 0,
        payment_intents_by_status: intentsByStatus,
      }
    });
  });
}
