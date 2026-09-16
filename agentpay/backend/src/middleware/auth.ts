import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { JwtPayload, AgentApiKeyPayload } from '../types';
import * as bcrypt from 'bcryptjs';

// Extend FastifyRequest to include auth context
declare module 'fastify' {
  interface FastifyRequest {
    authContext?: {
      type: 'user' | 'agent';
      userId?: string;
      agentId?: string;
      organizationId: string;
      role?: string;
      credentialId?: string;
    };
  }
}

// ── User JWT Auth ────────────────────────────────

export async function requireUserAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (reply.sent) return;
  try {
    const payload = await request.jwtVerify<JwtPayload>();
    request.authContext = {
      type: 'user',
      userId: payload.sub,
      organizationId: payload.org,
      role: payload.role,
    };
  } catch {
    reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing authentication token.' }
    });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ctx = request.authContext;
    if (!ctx || ctx.type !== 'user' || !roles.includes(ctx.role || '')) {
      reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' }
      });
    }
  };
}

// ── Agent API Key Auth ───────────────────────────

export async function requireAgentAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  let apiKey = '';
  const xApiKey = request.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.length > 10) {
    apiKey = xApiKey;
  } else {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7);
    }
  }

  if (!apiKey || apiKey.length < 10) {
    reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Agent API key required via Authorization or X-API-Key header.' }
    });
    return;
  }

  // API key format: frm_live_XXXX... or frm_test_XXXX...
  // First 8 chars are the prefix for lookup
  const keyPrefix = apiKey.slice(0, 12);

  try {
    const { rows } = await db.query(
      `SELECT ac.*, a.status as agent_status, a.organization_id
       FROM agent_credentials ac
       JOIN agents a ON a.id = ac.agent_id
       WHERE ac.key_prefix = $1
         AND ac.status = 'active'
         AND (ac.expires_at IS NULL OR ac.expires_at > NOW())`,
      [keyPrefix]
    );

    let validCredential = null;
    for (const row of rows) {
      const matches = await bcrypt.compare(apiKey, row.key_hash);
      if (matches) {
        validCredential = row;
        break;
      }
    }

    if (!validCredential) {
      reply.code(401).send({
        error: { code: 'INVALID_API_KEY', message: 'Invalid API key.' }
      });
      return;
    }

    if (validCredential.agent_status !== 'active') {
      reply.code(403).send({
        error: { code: 'AGENT_DISABLED', message: 'This agent is disabled or revoked.' }
      });
      return;
    }

    // Update last used on credential and agent entity
    await db.query(
      'UPDATE agent_credentials SET last_used_at = NOW() WHERE id = $1',
      [validCredential.id]
    );
    await db.query(
      'UPDATE agents SET last_used_at = NOW() WHERE id = $1',
      [validCredential.agent_id]
    );

    request.authContext = {
      type: 'agent',
      agentId: validCredential.agent_id,
      organizationId: validCredential.organization_id,
      credentialId: validCredential.id,
    };
  } catch (err) {
    request.log.error(err, 'Agent auth error');
    reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Authentication error.' }
    });
  }
}

// ── Either auth (user or agent) ──────────────────

export async function requireAnyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const xApiKey = request.headers['x-api-key'];
  if (xApiKey || authHeader?.startsWith('Bearer frm_')) {
    return requireAgentAuth(request, reply);
  }
  return requireUserAuth(request, reply);
}
