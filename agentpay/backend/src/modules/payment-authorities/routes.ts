// Payment Authorities API Routes
// Exposes endpoints for managing delegated authority.
// Invariant: Agents MUST NOT be able to create, modify, suspend, or revoke authority.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireUserAuth, requireAnyAuth } from '../../middleware/auth';
import { AuthorityService } from './authority.service';
import { AuthorityStatus } from './authority.entity';

export async function paymentAuthorityRoutes(fastify: FastifyInstance): Promise<void> {
  // Pre-handler to check if an agent tries to call these routes with an agent key
  const forbidAgents = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization || '';
    const xApiKey = request.headers['x-api-key'] || '';
    if (typeof xApiKey === 'string' && xApiKey.startsWith('frm_')) {
      return reply.code(403).send({
        error: {
          code: 'AGENT_AUTHORITY_MUTATION_FORBIDDEN',
          message: 'AI agents are strictly prohibited from creating or modifying payment authorities.',
        },
      });
    }
    if (authHeader.startsWith('Bearer frm_')) {
      return reply.code(403).send({
        error: {
          code: 'AGENT_AUTHORITY_MUTATION_FORBIDDEN',
          message: 'AI agents are strictly prohibited from creating or modifying payment authorities.',
        },
      });
    }
  };

  // POST /v1/payment-authorities - Grant new delegated authority to an agent (User/Admin only)
  fastify.post(
    '/',
    { preHandler: [forbidAgents, requireUserAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext!;
      const body = request.body as any;

      const agentId = body.agentId || body.agent_id;
      const maxTransactionAmountPaise = body.maxTransactionAmountPaise ?? body.max_amount_per_tx_paise ?? body.max_transaction_amount_paise;
      const dailyLimitPaise = body.dailyLimitPaise ?? body.max_daily_paise ?? body.daily_limit_paise;
      const monthlyLimitPaise = body.monthlyLimitPaise ?? body.max_monthly_paise ?? body.monthly_limit_paise;
      const validUntil = body.validUntil || body.valid_until || body.expires_at;
      const validFrom = body.validFrom || body.valid_from;
      const requiresApprovalAbovePaise = body.requiresApprovalAbovePaise ?? body.approval_threshold_paise ?? body.requires_approval_above_paise;
      const allowedCategories = body.allowedCategories || body.allowed_categories;
      const blockedCategories = body.blockedCategories || body.blocked_categories || body.disallowed_categories;
      const allowedMerchants = body.allowedMerchants || body.allowed_merchants;
      const blockedMerchants = body.blockedMerchants || body.blocked_merchants || body.disallowed_merchants;
      const purpose = body.purpose || body.name;

      if (!agentId || maxTransactionAmountPaise === undefined || dailyLimitPaise === undefined || monthlyLimitPaise === undefined || !validUntil) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: agentId, maxTransactionAmountPaise, dailyLimitPaise, monthlyLimitPaise, validUntil.',
          },
        });
      }

      try {
        const authority = await AuthorityService.createAuthority({
          organizationId: ctx.organizationId,
          userId: ctx.userId!,
          agentId,
          provider: body.provider,
          rail: body.rail,
          currency: body.currency,
          maxTransactionAmountPaise: Number(maxTransactionAmountPaise),
          dailyLimitPaise: Number(dailyLimitPaise),
          monthlyLimitPaise: Number(monthlyLimitPaise),
          allowedCategories,
          blockedCategories,
          allowedMerchants,
          blockedMerchants,
          purpose,
          validFrom,
          validUntil,
          requiresApprovalAbovePaise: requiresApprovalAbovePaise !== undefined ? Number(requiresApprovalAbovePaise) : undefined,
          providerReference: body.providerReference || body.provider_reference,
        });

        return reply.code(201).send({ data: authority });
      } catch (err: any) {
        return reply.code(err.statusCode || 400).send({
          error: { code: err.code || 'AUTHORITY_CREATION_FAILED', message: err.message },
        });
      }
    }
  );

  // GET /v1/payment-authorities - List authorities (User sees all in org; Agent sees only its own)
  fastify.get(
    '/',
    { preHandler: [requireAnyAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext!;
      const query = request.query as { agentId?: string; status?: AuthorityStatus };

      const targetAgentId = ctx.type === 'agent' ? ctx.agentId : query.agentId;

      const authorities = await AuthorityService.listAuthorities(ctx.organizationId, {
        agentId: targetAgentId,
        status: query.status,
      });

      return reply.send({ data: authorities });
    }
  );

  // GET /v1/payment-authorities/:id - Get specific authority
  fastify.get(
    '/:id',
    { preHandler: [requireAnyAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext!;
      const { id } = request.params as { id: string };
      const authority = await AuthorityService.getAuthority(id, ctx.organizationId);

      if (!authority) {
        return reply.code(404).send({
          error: { code: 'AUTHORITY_NOT_FOUND', message: 'Payment authority not found.' },
        });
      }

      // If called by an agent, verify this authority belongs to this specific agent
      if (ctx.type === 'agent' && authority.agent_id !== ctx.agentId) {
        return reply.code(404).send({
          error: { code: 'AUTHORITY_NOT_FOUND', message: 'Payment authority not found.' },
        });
      }

      return reply.send({ data: authority });
    }
  );

  // POST /v1/payment-authorities/:id/revoke - Revoke authority
  fastify.post(
    '/:id/revoke',
    { preHandler: [forbidAgents, requireUserAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as any;

      try {
        const revoked = await AuthorityService.revokeAuthority(
          id,
          ctx.organizationId,
          ctx.userId!,
          body.reason || 'Revoked by user/admin'
        );
        return reply.send({ data: revoked });
      } catch (err: any) {
        return reply.code(err.statusCode || 400).send({
          error: { code: err.code || 'REVOCATION_FAILED', message: err.message },
        });
      }
    }
  );

  // POST /v1/payment-authorities/:id/suspend - Suspend authority
  fastify.post(
    '/:id/suspend',
    { preHandler: [forbidAgents, requireUserAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as any;

      try {
        const suspended = await AuthorityService.suspendAuthority(
          id,
          ctx.organizationId,
          ctx.userId!,
          body.reason || 'Suspended by user/admin'
        );
        return reply.send({ data: suspended });
      } catch (err: any) {
        return reply.code(err.statusCode || 400).send({
          error: { code: err.code || 'SUSPEND_FAILED', message: err.message },
        });
      }
    }
  );

  // POST /v1/payment-authorities/:id/resume - Resume suspended authority
  fastify.post(
    '/:id/resume',
    { preHandler: [forbidAgents, requireUserAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext!;
      const { id } = request.params as { id: string };

      try {
        const resumed = await AuthorityService.resumeAuthority(
          id,
          ctx.organizationId,
          ctx.userId!
        );
        return reply.send({ data: resumed });
      } catch (err: any) {
        return reply.code(err.statusCode || 400).send({
          error: { code: err.code || 'RESUME_FAILED', message: err.message },
        });
      }
    }
  );
}
