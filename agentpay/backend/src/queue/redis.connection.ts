// Dedicated Redis connection configuration for BullMQ
// BullMQ requires maxRetriesPerRequest to be null for blocking operations and pub/sub.

import Redis from 'ioredis';
import { config } from '../config';

export function createBullMQRedisConnection(): Redis {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  client.on('error', (err) => {
    // Suppress unhandled crash in test environments if Redis reconnects
    if (config.isDev) {
      console.warn('BullMQ Redis client warning/error:', err.message);
    }
  });

  return client;
}
