import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { db } from '../../db';
import { requireUserAuth } from '../../middleware/auth';
import { createAuditEvent } from '../../lib/audit';

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  owner_team: z.string().max(255).optional(),
  purpose: z.string().max(1000).optional(),
});

const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  owner_team: z.string().max(255).optional(),
  purpose: z.string().max(1000).optional(),
});

function generateApiKey(env: string): { key: string; prefix: string } {
  const envTag = env === 'production' ? 'live' : 'test';
  const random = crypto.randomBytes(24).toString('base64url');
  const key = `frm_${envTag}_${random}`;
  const prefix = key.slice(0, 12);
  return { key, prefix };
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {

  // GET /v1/agents
  app.get('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { rows } = await db.query(
      `SELECT a.*,
              (SELECT COUNT(*) FROM agent_credentials ac WHERE ac.agent_id = a.id AND ac.status = 'active') as credential_count,
              (SELECT COUNT(*) FROM payment_intents pi WHERE pi.agent_id = a.id AND pi.status = 'SUCCEEDED') as total_payments,
              (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_intents pi WHERE pi.agent_id = a.id AND pi.status = 'SUCCEEDED') as total_spend_paise
       FROM agents a
       WHERE a.organization_id = $1
       ORDER BY a.created_at DESC`,
      [ctx.organizationId]
    );
    return reply.send({ data: rows });
  });

  // POST /v1/agents
  app.post('/', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const body = CreateAgentSchema.parse(request.body);

    // Get org env
    const { rows: orgRows } = await db.query(
      'SELECT frame_env FROM organizations WHERE id = $1',
      [ctx.organizationId]
    );
    const frameEnv = orgRows[0]?.frame_env || 'sandbox';

    const agentId = ulid();
    const { rows } = await db.query(
      `INSERT INTO agents (id, organization_id, name, description, owner_team, purpose, frame_env, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [agentId, ctx.organizationId, body.name, body.description || null, body.owner_team || null, body.purpose || null, frameEnv, ctx.userId || null]
    );

    const agent = rows[0];

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.created',
      resourceType: 'agent',
      resourceId: agentId,
      newState: agent,
    });

    return reply.code(201).send({ data: agent });
  });

  // GET /v1/agents/:id
  app.get('/:id', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `SELECT a.*,
              p.id as policy_id, p.name as policy_name, p.current_version_id
       FROM agents a
       LEFT JOIN policies p ON p.agent_id = a.id AND p.status = 'active'
       WHERE a.id = $1 AND a.organization_id = $2`,
      [id, ctx.organizationId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }

    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/agents/:id
  app.patch('/:id', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = UpdateAgentSchema.parse(request.body);

    const { rows: existing } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    if (existing.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(body.name); }
    if (body.description !== undefined) { updates.push(`description = $${idx++}`); values.push(body.description); }
    if (body.owner_team !== undefined) { updates.push(`owner_team = $${idx++}`); values.push(body.owner_team); }
    if (body.purpose !== undefined) { updates.push(`purpose = $${idx++}`); values.push(body.purpose); }

    if (updates.length === 0) {
      return reply.send({ data: existing[0] });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, ctx.organizationId);

    const { rows } = await db.query(
      `UPDATE agents SET ${updates.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
      values
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.updated',
      resourceType: 'agent',
      resourceId: id,
      previousState: existing[0],
      newState: rows[0],
    });

    return reply.send({ data: rows[0] });
  });

  // POST /v1/agents/:id/disable
  app.post('/:id/disable', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = (request.body as { reason?: string }) || {};

    const { rows: existing } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    if (existing.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }
    if (existing[0].status === 'revoked') {
      return reply.code(409).send({ error: { code: 'ALREADY_REVOKED', message: 'Agent is already revoked.' } });
    }

    const { rows } = await db.query(
      `UPDATE agents SET status = 'disabled', disabled_at = NOW(), disabled_reason = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3 RETURNING *`,
      [body.reason || null, id, ctx.organizationId]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.disabled',
      resourceType: 'agent',
      resourceId: id,
      previousState: { status: existing[0].status },
      newState: { status: 'disabled' },
    });

    return reply.send({ data: rows[0] });
  });

  // POST /v1/agents/:id/enable
  app.post('/:id/enable', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows: existing } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    if (existing.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }
    if (existing[0].status === 'revoked') {
      return reply.code(409).send({ error: { code: 'REVOKED', message: 'Revoked agents cannot be re-enabled.' } });
    }

    const { rows } = await db.query(
      `UPDATE agents SET status = 'active', disabled_at = NULL, disabled_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, ctx.organizationId]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.enabled',
      resourceType: 'agent',
      resourceId: id,
      previousState: { status: existing[0].status },
      newState: { status: 'active' },
    });

    return reply.send({ data: rows[0] });
  });

  // POST /v1/agents/:id/revoke — permanently revoke agent
  app.post('/:id/revoke', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };
    const body = (request.body as { reason?: string }) || {};

    const { rows: existing } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    if (existing.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }
    if (existing[0].status === 'revoked') {
      return reply.code(409).send({ error: { code: 'ALREADY_REVOKED', message: 'Agent is already revoked.' } });
    }

    // 1. Mark agent as revoked
    const { rows } = await db.query(
      `UPDATE agents SET status = 'revoked', disabled_at = NOW(), disabled_reason = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3 RETURNING *`,
      [body.reason || 'Agent revoked by administrator', id, ctx.organizationId]
    );

    // 2. Revoke all active credentials for this agent
    await db.query(
      `UPDATE agent_credentials SET status = 'revoked', revoked_at = NOW(), revoked_by = $1
       WHERE agent_id = $2 AND organization_id = $3 AND status = 'active'`,
      [ctx.userId || null, id, ctx.organizationId]
    );

    // 3. Revoke all active payment authorities for this agent
    await db.query(
      `UPDATE payment_authorities SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = 'Agent revoked'
       WHERE agent_id = $1 AND organization_id = $2 AND status = 'ACTIVE'`,
      [id, ctx.organizationId]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.revoked',
      resourceType: 'agent',
      resourceId: id,
      previousState: { status: existing[0].status },
      newState: { status: 'revoked' },
    });

    return reply.send({ data: rows[0] });
  });

  // POST /v1/agents/:id/credentials/rotate — rotate agent API key (revoke existing, issue new)
  app.post('/:id/credentials/rotate', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows: agentRows } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }
    if (agentRows[0].status !== 'active') {
      return reply.code(422).send({ error: { code: 'AGENT_NOT_ACTIVE', message: 'Cannot rotate credentials for an inactive or revoked agent.' } });
    }

    // Revoke previous active credentials
    await db.query(
      `UPDATE agent_credentials SET status = 'revoked', revoked_at = NOW(), revoked_by = $1
       WHERE agent_id = $2 AND organization_id = $3 AND status = 'active'`,
      [ctx.userId || null, id, ctx.organizationId]
    );

    // Issue new credential
    const { key, prefix } = generateApiKey(agentRows[0].frame_env);
    const keyHash = await bcrypt.hash(key, 12);
    const credId = ulid();

    await db.query(
      `INSERT INTO agent_credentials (id, agent_id, organization_id, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [credId, id, ctx.organizationId, prefix, keyHash]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.credential_rotated',
      resourceType: 'agent',
      resourceId: id,
    });

    // Return key ONCE
    return reply.code(201).send({
      data: {
        id: credId,
        agent_id: id,
        key_prefix: prefix,
        api_key: key, // ⚠️ Shown only once
        status: 'active',
        created_at: new Date().toISOString(),
        warning: 'Store this API key securely. It will not be shown again.',
      }
    });
  });

  // POST /v1/agents/:id/credentials  — generate new API key
  app.post('/:id/credentials', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows: agentRows } = await db.query(
      'SELECT * FROM agents WHERE id = $1 AND organization_id = $2',
      [id, ctx.organizationId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found.' } });
    }
    if (agentRows[0].status !== 'active') {
      return reply.code(422).send({ error: { code: 'AGENT_NOT_ACTIVE', message: 'Cannot generate credentials for a disabled agent.' } });
    }

    const { key, prefix } = generateApiKey(agentRows[0].frame_env);
    const keyHash = await bcrypt.hash(key, 12);
    const credId = ulid();

    await db.query(
      `INSERT INTO agent_credentials (id, agent_id, organization_id, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [credId, id, ctx.organizationId, prefix, keyHash]
    );

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.credential_created',
      resourceType: 'agent',
      resourceId: id,
    });

    // Return key ONCE — never stored in plain text
    return reply.code(201).send({
      data: {
        id: credId,
        agent_id: id,
        key_prefix: prefix,
        api_key: key, // ⚠️ Shown only once
        status: 'active',
        created_at: new Date().toISOString(),
        warning: 'Store this API key securely. It will not be shown again.',
      }
    });
  });

  // GET /v1/agents/:id/credentials
  app.get('/:id/credentials', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `SELECT id, agent_id, organization_id, key_prefix, status, last_used_at, expires_at, created_at, revoked_at
       FROM agent_credentials
       WHERE agent_id = $1 AND organization_id = $2
       ORDER BY created_at DESC`,
      [id, ctx.organizationId]
    );

    return reply.send({ data: rows });
  });

  // POST /v1/agents/:id/credentials/:credId/revoke
  app.post('/:id/credentials/:credId/revoke', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { id, credId } = request.params as { id: string; credId: string };

    const { rows } = await db.query(
      `UPDATE agent_credentials SET status = 'revoked', revoked_at = NOW(), revoked_by = $1
       WHERE id = $2 AND agent_id = $3 AND organization_id = $4 AND status = 'active'
       RETURNING *`,
      [ctx.userId || null, credId, id, ctx.organizationId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Credential not found or already revoked.' } });
    }

    await createAuditEvent({
      organizationId: ctx.organizationId,
      actorType: 'user',
      actorId: ctx.userId,
      action: 'agent.credential_revoked',
      resourceType: 'agent',
      resourceId: id,
    });

    return reply.send({ data: rows[0] });
  });
}
