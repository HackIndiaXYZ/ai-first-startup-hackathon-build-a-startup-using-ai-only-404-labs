import fastify from 'fastify';
import cors from '@fastify/cors';
import { ShoppingAgent } from '../core/agent';
import { defaultExecutionStore } from '../state/execution-store';

export async function createAgentServer(port = 3005) {
  const app = fastify({ logger: false });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const agent = new ShoppingAgent();
  const store = defaultExecutionStore;

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    service: 'frame-autonomous-shopping-agent',
    timestamp: new Date().toISOString(),
  }));

  // Start Agent Run
  app.post('/agent/runs', async (req, reply) => {
    const body = (req.body as any) || {};
    const instruction = body.instruction || body.prompt;

    if (!instruction || typeof instruction !== 'string') {
      return reply.status(400).send({ error: { code: 'INVALID_INSTRUCTION', message: 'Field "instruction" is required.' } });
    }

    const agentApiKey = body.agentApiKey || body.agent_api_key;

    // Start execution asynchronously in background so client gets runId immediately or await execution
    const runPromise = agent.execute(instruction, { agentApiKey });

    // If sync mode requested:
    if (body.sync) {
      const state = await runPromise;
      return reply.status(200).send({ data: state });
    }

    // Otherwise return run immediately and run in background
    return reply.status(202).send({
      message: 'Agent execution initiated',
      status: 'RUNNING',
    });
  });

  // List Runs
  app.get('/agent/runs', async () => {
    return { data: store.listRuns() };
  });

  // Get Run by ID
  app.get('/agent/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = store.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Run ${id} not found.` } });
    }
    return { data: run };
  });

  // Get Events for Run
  app.get('/agent/runs/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const events = store.getEvents(id);
    return { data: events };
  });

  return app;
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3005', 10);
  createAgentServer(port).then((app) => {
    app.listen({ port, host: '0.0.0.0' }, (err, address) => {
      if (err) {
        console.error('Failed to start agent server:', err);
        process.exit(1);
      }
      console.log(`🤖 Autonomous Shopping Agent API running at ${address}`);
    });
  });
}
