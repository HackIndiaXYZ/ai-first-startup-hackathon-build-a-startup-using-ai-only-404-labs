import fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ShoppingAgent } from '../core/agent';
import { defaultExecutionStore } from '../state/execution-store';
import { ulid } from 'ulid';

export interface AgentServerConfig {
  port?: number;
  host?: string;
  agent?: ShoppingAgent;
}

export async function createAgentServer(config: AgentServerConfig = {}) {
  const app = fastify({ logger: false });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const agent = config.agent || new ShoppingAgent();
  const store = defaultExecutionStore;

  // Rate-limiting map (simple IP/token based)
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  const rateLimitHook = async (req: FastifyRequest, reply: FastifyReply) => {
    const key = (req.headers['x-forwarded-for'] as string) || req.ip || 'global';
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;

    let bucket = rateLimitMap.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs };
      rateLimitMap.set(key, bucket);
    } else {
      bucket.count++;
      if (bucket.count > maxRequests) {
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please slow down.',
          },
        });
      }
    }
  };

  app.addHook('preHandler', rateLimitHook);

  // Helper to extract agent API key
  const getAgentApiKey = (req: FastifyRequest): string | undefined => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    const body = (req.body as any) || {};
    return body.agentApiKey || body.agent_api_key || (req.headers['x-agent-api-key'] as string);
  };

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    service: 'frame-autonomous-shopping-agent',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  // 1. Start Agent Run: POST /agent/runs
  app.post('/agent/runs', async (req, reply) => {
    const body = (req.body as any) || {};
    const instruction = body.instruction || body.prompt;

    if (!instruction || typeof instruction !== 'string' || instruction.trim().length === 0) {
      return reply.status(400).send({
        error: { code: 'INVALID_INSTRUCTION', message: 'Field "instruction" is required and must be a non-empty string.' },
      });
    }

    const agentApiKey = getAgentApiKey(req);
    const runId = body.runId || `run_${ulid()}`;

    // Launch run
    const runPromise = agent.execute(instruction.trim(), { runId, agentApiKey });

    if (body.sync === true) {
      const state = await runPromise;
      return reply.status(200).send({ data: state });
    }

    // Async execution
    runPromise.catch((err) => {
      console.error(`[Agent Server] Background run ${runId} failed:`, err);
    });

    return reply.status(202).send({
      message: 'Agent execution initiated',
      runId,
      status: 'RUNNING',
    });
  });

  // 2. List Runs: GET /agent/runs
  app.get('/agent/runs', async () => {
    return { data: store.listRuns() };
  });

  // 3. Get Run by ID: GET /agent/runs/:id
  app.get('/agent/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = store.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Run ${id} not found.` } });
    }
    return { data: run };
  });

  // 4. Get Events for Run: GET /agent/runs/:id/events
  app.get('/agent/runs/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const events = store.getEvents(id);
    return { data: events };
  });

  // 5. Resume Paused Run: POST /agent/runs/:id/resume
  app.post('/agent/runs/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = store.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Run ${id} not found.` } });
    }

    try {
      const updated = await agent.resumeRun(id);
      return reply.status(200).send({ data: updated });
    } catch (err: any) {
      return reply.status(500).send({
        error: { code: 'RESUME_FAILED', message: err.message },
      });
    }
  });

  // 6. Cancel Run: POST /agent/runs/:id/cancel
  app.post('/agent/runs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const reason = body.reason || 'Cancelled by operator';

    try {
      const updated = await agent.cancelRun(id, reason);
      return reply.status(200).send({ data: updated });
    } catch (err: any) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
    }
  });

  // 7. Human Intervention Response: POST /agent/runs/:id/intervention
  app.post('/agent/runs/:id/intervention', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = store.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Run ${id} not found.` } });
    }

    const body = (req.body as any) || {};
    if (body.approved) {
      const updated = await agent.resumeRun(id);
      return reply.status(200).send({ data: updated });
    } else {
      const updated = await agent.cancelRun(id, body.reason || 'Human principal rejected intervention');
      return reply.status(200).send({ data: updated });
    }
  });

  // 8. Order Confirmation Webhook/Callback: POST /agent/runs/:id/confirm
  app.post('/agent/runs/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = store.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Run ${id} not found.` } });
    }

    if (run.canonicalCheckout && run.framePaymentIntent) {
      const merchantConfirmed = await (agent as any).merchant.confirmPayment(
        run.canonicalCheckout.order_id,
        run.framePaymentIntent.payment_intent_id
      );
      if (merchantConfirmed) {
        run.status = 'SUCCEEDED';
        store.saveRun(run);
        return reply.status(200).send({ data: run, message: 'Order confirmed successfully' });
      }
    }

    return reply.status(400).send({ error: { code: 'CONFIRMATION_FAILED', message: 'Unable to confirm order' } });
  });

  return app;
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3005', 10);
  createAgentServer({ port }).then((app) => {
    app.listen({ port, host: '0.0.0.0' }, (err, address) => {
      if (err) {
        console.error('Failed to start agent server:', err);
        process.exit(1);
      }
      console.log(`🤖 Frame Autonomous Shopping Agent API running at ${address}`);
    });
  });
}
