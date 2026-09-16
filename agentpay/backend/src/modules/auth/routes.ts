import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { db } from '../../db';
import { config } from '../../config';
import { createAuditEvent } from '../../lib/audit';
import { JwtPayload, UserRole } from '../../types';
import { requireUserAuth } from '../../middleware/auth';

const RegisterSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8),
  organization_name: z.string().min(2).max(255),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/auth/register
  app.post('/register', async (request, reply) => {
    const body = RegisterSchema.parse(request.body);

    // Check if email exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({
        error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' }
      });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const orgId = ulid();
    const userId = ulid();
    const slug = body.organization_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '-' + orgId.slice(-6).toLowerCase();

    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO organizations (id, name, slug, frame_env) VALUES ($1, $2, $3, $4)`,
        [orgId, body.organization_name, slug, config.frameEnv]
      );
      await db.query(
        `INSERT INTO users (id, organization_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, 'owner')`,
        [userId, orgId, body.email.toLowerCase(), body.name, passwordHash]
      );
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    await createAuditEvent({
      organizationId: orgId,
      actorType: 'user',
      actorId: userId,
      action: 'organization.created',
      resourceType: 'organization',
      resourceId: orgId,
    });

    const token = app.jwt.sign(
      { sub: userId, org: orgId, role: 'owner', env: config.frameEnv } as JwtPayload,
      { expiresIn: '7d' }
    );

    return reply.code(201).send({
      data: {
        token,
        user: { id: userId, email: body.email, name: body.name, role: 'owner' },
        organization: { id: orgId, name: body.organization_name, slug, frame_env: config.frameEnv },
      }
    });
  });

  // POST /v1/auth/login
  app.post('/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body);

    const { rows } = await db.query(
      `SELECT u.*, o.name as org_name, o.slug as org_slug, o.frame_env
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1 AND u.status = 'active'`,
      [body.email.toLowerCase()]
    );

    if (rows.length === 0) {
      return reply.code(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = app.jwt.sign(
      { sub: user.id, org: user.organization_id, role: user.role as UserRole, env: user.frame_env } as JwtPayload,
      { expiresIn: '7d' }
    );

    await createAuditEvent({
      organizationId: user.organization_id,
      actorType: 'user',
      actorId: user.id,
      action: 'user.login',
    });

    return reply.send({
      data: {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        organization: { id: user.organization_id, name: user.org_name, slug: user.org_slug, frame_env: user.frame_env },
      }
    });
  });

  // GET /v1/auth/me
  app.get('/me', { preHandler: requireUserAuth }, async (request, reply) => {
    const ctx = request.authContext!;
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at,
              o.id as org_id, o.name as org_name, o.slug, o.frame_env
       FROM users u JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1`,
      [ctx.userId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }
    const u = rows[0];
    return reply.send({
      data: {
        user: { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status },
        organization: { id: u.org_id, name: u.org_name, slug: u.slug, frame_env: u.frame_env },
      }
    });
  });
}
