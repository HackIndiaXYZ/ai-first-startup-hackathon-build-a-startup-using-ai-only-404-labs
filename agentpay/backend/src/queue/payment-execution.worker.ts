// Payment Execution Worker
// Consumes durable BullMQ payment jobs and dispatches them through PaymentOrchestrator
// Guarantees:
// 1. Exactly-once provider execution via PostgreSQL row locks
// 2. Safe handling of duplicate job deliveries
// 3. Crash safety (never blindly retries in-flight payments)
// 4. Webhook race safety (never overwrites confirmed terminal states)

import { Worker, Job } from 'bullmq';
import { createBullMQRedisConnection } from './redis.connection';
import { PAYMENT_EXECUTION_QUEUE_NAME, PaymentExecutionJobData } from './payment-execution.queue';
import { PaymentOrchestrator } from '../modules/payments/orchestrator/payment-orchestrator';

let workerInstance: Worker<PaymentExecutionJobData> | null = null;

export function startPaymentExecutionWorker(concurrency: number = 5): Worker<PaymentExecutionJobData> {
  if (workerInstance) {
    return workerInstance;
  }

  // Crash recovery: Sweep any abandoned in-flight executions left by previous worker process
  PaymentOrchestrator.recoverStaleExecutions().catch((err) => {
    console.error('[Worker] Error during startup crash recovery sweep:', err.message);
  });

  const connection = createBullMQRedisConnection();

  workerInstance = new Worker<PaymentExecutionJobData>(
    PAYMENT_EXECUTION_QUEUE_NAME,
    async (job: Job<PaymentExecutionJobData>) => {
      const { paymentId, organizationId, paymentIntentId } = job.data;
      
      const startTime = Date.now();
      console.log(`[Worker] Started processing payment job: ${job.id} (paymentId: ${paymentId})`);

      try {
        const result = await PaymentOrchestrator.dispatchProviderExecution(
          paymentId,
          organizationId
        );

        const duration = Date.now() - startTime;
        console.log(
          `[Worker] Completed payment job: ${job.id} -> Status: ${result.payment.status} (${duration}ms)`
        );

        return {
          paymentId: result.payment.id,
          status: result.payment.status,
          providerPaymentId: result.payment.provider_payment_id,
          durationMs: duration,
        };
      } catch (err: any) {
        console.error(`[Worker] Failed payment job: ${job.id}:`, err.message);
        throw err;
      }
    },
    {
      connection,
      concurrency,
    }
  );

  workerInstance.on('error', (err) => {
    console.error('[Worker] BullMQ Worker Error:', err.message);
  });

  workerInstance.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} permanently failed:`, err.message);
  });

  return workerInstance;
}

export async function stopPaymentExecutionWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
}
