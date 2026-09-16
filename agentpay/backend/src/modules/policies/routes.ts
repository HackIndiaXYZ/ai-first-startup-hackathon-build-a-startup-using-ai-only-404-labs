import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { db } from '../../db';
import { requireUserAuth } from '../../middleware/auth';
import { createAuditEvent } from '../../lib/audit';

const CreatePolicySchema = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1).max(255),
  transaction_limit_paise: z.number().int().positive().optional(),
  daily_limit_paise: z.number().int().positive().optional(),
  monthly_limit_paise: z.number().int().positive().optional(),
  approval_threshold_paise: z.number().int().positive().optional(),
  merchant_allowlist: z.array(z.string()).optional(),
  merchant_blocklist: z.array(z.string()).optional(),
  allowed_categories: z.array(z.string()).optional(),
  blocked_categories: z.array(z.string()).optional(),
  max_payments_per_hour: z.number().int().positive().optional(),
  max_payments_per_day: z.number().int().positive().optional(),
  valid_from: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
});

const UpdatePolicySchema = CreatePolicySchema.partial().omit({ agent_id: true });

export async function policyRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/policies
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const query = request.query as { agent_id?: string };

    let sql = `SELECT p.*, pv.id as version_id, pv.version_number,
               pv.transaction_limit_paise, pv.daily_limit_paise, pv.monthly_limit_paise,
               pv.approval_threshold_paise, pv.merchant_allowlist, pv.merchant_blocklist,
               pv.allowed_categories, pv.blocked_categories,
               pv.max_payments_per_hour, pv.max_payments_per_day,
               pv.valid_from, pv.expires_at as version_expires_at,
               a.name as agent_name
               FROM policies p
               LEFT JOIN policy_versions pv ON pv.id = p.current_version_id
               LEFT JOIN agents a ON a.id = p.agent_id
               WHERE p.organization_id = $1`;
    const params: unknown[] = [ctx.organizationId];

    if (query.agent_id) {
      sql += ` AND p.agent_id = $${params.length + 1}`;
      params.push(query.agent_id);
    }
    sql += ' ORDER BY p.created_at DESC';

    const { rows } = await db.query(sql, params);
    return reply.send({ data: rows });
  });

  // POST /v1/policies
  app.post('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const body = CreatePolicySchema.parse(request.body);

    // Verify agent belongs to org
    const { rows: agentRows } = await db.query(
      'SELECT id FROM agents WHERE id = $1 AND organization_id = $2',
      [body.agent_id, ctx.organizationId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }

    const policyId = ulid();
    const versionId = ulid();

    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO policies (id, organization_id, agent_id, name, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [policyId, ctx.organizationId, body.agent_id, body.name, ctx.userId || null]
      );

      await db.query(
        `INSERT INTO policy_versions (
          id, policy_id, version_number,
          transaction_limit_paise, daily_limit_paise, monthly_limit_paise,
          approval_threshold_paise, merchant_allowlist, merchant_blocklist,
          allowed_categories, blocked_categories, max_payments_per_hour,
          max_payments_per_day, valid_from, expires_at, created_by
        ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          versionId, policyId,
          body.transaction_limit_paise || null,
          body.daily_limit_paise || null,
          body.monthly_limit_paise || null,
          body.approval_threshold_paise || null,
          body.merchant_allowlist || null,
          body.merchant_blocklist || null,
          body.allowed_categories || null,
          body.blocked_categories || null,
          body.max_payments_per_hour || null,
          body.max_payments_per_day || null,
          body.valid_from || null,
          body.expires_at || null,
          ctx.userId || null,
        ]
      );

      await db.query(
        'UPDATE policies SET current_version_id = $1 WHERE id = $2',
        [versionId, policyId]
      );

      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    const { rows } = await db.query(
      `SELECT p.*, pv.* FROM policies p JOIN policy_versions pv ON pv.id = p.current_version_id WHERE p.id = $1`,
      [policyId]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'policy.created',
      resourceType: 'policy',
      resourceId: policyId,
    });

    return reply.code(201).send({ data: rows[0] });
  });

  // GET /v1/policies/:id
  app.get('/:id', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `SELECT p.*, pv.*,
              a.name as agent_name
       FROM policies p
       LEFT JOIN policy_versions pv ON pv.id = p.current_version_id
       LEFT JOIN agents a ON a.id = p.agent_id
       WHERE p.id = $1 AND p.organization_id = $2`,
      [id, ctx.organizationId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Policy not found.' } });
    }

    // Also get version history
    const { rows: versions } = await db.query(
      'SELECT * FROM policy_versions WHERE policy_id = $1 ORDER BY version_number DESC',
      [id]
    );

    return reply.send({ data: { ...rows[0], versions } });
  });

  // PATCH /v1/policies/:id  — creates a new immutable version
  app.patch('/:id', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = UpdatePolicySchema.parse(request.body);

    const { rows: existing } = await db.query(
      `SELECT p.*, pv.*
       FROM policies p LEFT JOIN policy_versions pv ON pv.id = p.current_version_id
       WHERE p.id = $1 AND p.organization_id = $2`,
      [id, ctx.organizationId]
    );
    if (existing.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Policy not found.' } });
    }

    const current = existing[0];
    const nextVersionNumber = (current.version_number || 0) + 1;
    const versionId = ulid();

    await db.query('BEGIN');
    try {
      // Create new immutable version (merge with existing values)
      await db.query(
        `INSERT INTO policy_versions (
          id, policy_id, version_number,
          transaction_limit_paise, daily_limit_paise, monthly_limit_paise,
          approval_threshold_paise, merchant_allowlist, merchant_blocklist,
          allowed_categories, blocked_categories, max_payments_per_hour,
          max_payments_per_day, valid_from, expires_at, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          versionId, id, nextVersionNumber,
          body.transaction_limit_paise ?? current.transaction_limit_paise,
          body.daily_limit_paise ?? current.daily_limit_paise,
          body.monthly_limit_paise ?? current.monthly_limit_paise,
          body.approval_threshold_paise ?? current.approval_threshold_paise,
          body.merchant_allowlist ?? current.merchant_allowlist,
          body.merchant_blocklist ?? current.merchant_blocklist,
          body.allowed_categories ?? current.allowed_categories,
          body.blocked_categories ?? current.blocked_categories,
          body.max_payments_per_hour ?? current.max_payments_per_hour,
          body.max_payments_per_day ?? current.max_payments_per_day,
          body.valid_from ?? current.valid_from,
          body.expires_at ?? current.expires_at,
          ctx.userId || null,
        ]
      );

      // Update name if provided
      if (body.name) {
        await db.query('UPDATE policies SET name = $1 WHERE id = $2', [body.name, id]);
      }

      await db.query(
        'UPDATE policies SET current_version_id = $1, updated_at = NOW() WHERE id = $2',
        [versionId, id]
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
      action: 'policy.updated',
      resourceType: 'policy',
      resourceId: id,
      previousState: { version_number: current.version_number },
      newState: { version_number: nextVersionNumber, version_id: versionId },
    });

    const { rows } = await db.query(
      `SELECT p.*, pv.* FROM policies p JOIN policy_versions pv ON pv.id = p.current_version_id WHERE p.id = $1`,
      [id]
    );
    return reply.send({ data: rows[0] });
  });
}
