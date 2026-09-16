// Durable Payment Execution Queue using BullMQ
// Redis carries work notification metadata ONLY; PostgreSQL is the financial source of truth.

import { Queue, JobsOptions } from 'bullmq';
import { createBullMQRedisConnection } from './redis.connection';

export const PAYMENT_EXECUTION_QUEUE_NAME = 'payment-execution';

export interface PaymentExecutionJobData {
  organizationId: string;
  paymentId: string;
  paymentIntentId: string;
  idempotencyKey: string;
  createdAt: string;
  attemptCount?: number;
}

// Lazy-initialized queue instance
let paymentExecutionQueue: Queue<PaymentExecutionJobData> | null = null;

export function getPaymentExecutionQueue(): Queue<PaymentExecutionJobData> {
  if (!paymentExecutionQueue) {
    const connection = createBullMQRedisConnection();
    paymentExecutionQueue = new Queue<PaymentExecutionJobData>(PAYMENT_EXECUTION_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 1, // Financial safety: Do NOT automatically retry at queue level without DB checks
      },
    });
  }
  return paymentExecutionQueue;
}

export async function enqueuePaymentExecution(
  data: PaymentExecutionJobData,
  options?: JobsOptions
): Promise<string> {
  const queue = getPaymentExecutionQueue();

  // Deterministic Job ID based on paymentId to prevent duplicate queue entries
  const jobId = `pay_job_${data.paymentId}`;

  const job = await queue.add('execute-payment', data, {
    jobId,
    ...options,
  });

  return job.id || jobId;
}
