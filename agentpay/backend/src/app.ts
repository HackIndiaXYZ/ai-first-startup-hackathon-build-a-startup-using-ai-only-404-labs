import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/error';
import { authRoutes } from './modules/auth/routes';
import { agentRoutes } from './modules/agents/routes';
import { policyRoutes } from './modules/policies/routes';
import { paymentIntentRoutes } from './modules/payment-intents/routes';
import { approvalRoutes } from './modules/approvals/routes';
import { transactionRoutes, auditRoutes, ledgerRoutes, overviewRoutes } from './modules/transactions/routes';
import { paymentInfrastructureRoutes } from './modules/payments/routes';
import { paymentAuthorityRoutes } from './modules/payment-authorities/routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn',
      transport: config.isDev ? { target: 'pino-pretty' } : undefined,
    },
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  });

  // Support empty JSON bodies gracefully (e.g. POST requests without payload)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string | Buffer, done) => {
    try {
      const str = typeof body === 'string' ? body : (body ? body.toString('utf8') : '');
      if (!str || str.trim() === '') {
        done(null, {});
        return;
      }
      const json = JSON.parse(str);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // ── Plugins ──────────────────────────────────────────
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, curl)
      if (!origin) {
        cb(null, true);
        return;
      }
      // Allow all in dev, wildcard, onrender.com subdomains, localhost, or configured origin
      if (
        config.isDev ||
        config.corsOrigin === '*' ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.endsWith('.onrender.com') ||
        origin === 'https://frame.app' ||
        origin === config.corsOrigin
      ) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });

  await app.register(jwt, {
    secret: config.jwtSecret,
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
      }
    }),
  });

  // ── Error handler ─────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── Health check ──────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'frame-api',
    version: '1.0.0',
    env: config.frameEnv,
    timestamp: new Date().toISOString(),
  }));

  // ── API Routes ────────────────────────────────────────
  await app.register(async (v1) => {
    await v1.register(authRoutes, { prefix: '/auth' });
    await v1.register(agentRoutes, { prefix: '/agents' });
    await v1.register(policyRoutes, { prefix: '/policies' });
    await v1.register(paymentIntentRoutes, { prefix: '/payment-intents' });
    await v1.register(approvalRoutes, { prefix: '/approvals' });
    await v1.register(transactionRoutes, { prefix: '/transactions' });
    await v1.register(auditRoutes, { prefix: '/audit-events' });
    await v1.register(ledgerRoutes, { prefix: '/ledger' });
    await v1.register(overviewRoutes, { prefix: '/overview' });
    await v1.register(paymentAuthorityRoutes, { prefix: '/payment-authorities' });
    await v1.register(paymentInfrastructureRoutes);
  }, { prefix: '/v1' });

  return app;
}
