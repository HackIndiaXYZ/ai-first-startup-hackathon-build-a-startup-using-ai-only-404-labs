import { buildApp } from './app';
import { config } from './config';
import { testDbConnection } from './db';
import { testRedisConnection } from './redis';

import { startPaymentExecutionWorker, stopPaymentExecutionWorker } from './queue/payment-execution.worker';

async function main(): Promise<void> {
  config.validateEnvironment();
  const app = await buildApp();

  try {
    await testDbConnection();
    app.log.info('✅ PostgreSQL connected');
  } catch (err) {
    app.log.error({ err }, '❌ PostgreSQL connection failed');
    process.exit(1);
  }

  try {
    await testRedisConnection();
    app.log.info('✅ Redis connected');
    // Start background worker for asynchronous durable payment processing
    startPaymentExecutionWorker();
    app.log.info('✅ Payment Execution Worker active');
  } catch (err) {
    app.log.warn({ err }, '⚠️  Redis connection failed (non-fatal in dev)');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await stopPaymentExecutionWorker();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`🚀 Frame API running on http://localhost:${config.port}`);
  console.log(`   Environment: ${config.frameEnv}`);
  console.log(`   Health: http://localhost:${config.port}/health`);
}

main().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
