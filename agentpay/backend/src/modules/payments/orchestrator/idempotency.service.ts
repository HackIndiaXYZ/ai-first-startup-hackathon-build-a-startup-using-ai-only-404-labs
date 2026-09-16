// Enterprise Idempotency & Concurrency Service
// Guarantees exact-once financial execution across concurrent duplicate requests.

import * as crypto from 'crypto';
import { ulid } from 'ulid';
import { db } from '../../../db';

export class IdempotencyConflictError extends Error {
  constructor(message: string, public readonly code: string = 'IDEMPOTENCY_CONFLICT') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export interface IdempotencyLockResult<T> {
  isCached: boolean;
  cachedResponse?: {
    statusCode: number;
    body: T;
  };
  unlock: (statusCode: number, responseBody: unknown) => Promise<void>;
}

export class IdempotencyService {
  /**
   * Computes a deterministic hash of the request payload.
   */
  static hashPayload(payload: unknown): string {
    const serialized = JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Attempts to acquire an atomic lock for an organization and idempotency key.
   * If an identical request was already completed, returns the cached response.
   * If a concurrent request is currently in flight, blocks or rejects safely.
   * If the same key is reused with a DIFFERENT payload, throws IdempotencyConflictError.
   */
  static async acquireLock<T>(
    organizationId: string,
    key: string,
    requestPath: string,
    requestPayload: unknown
  ): Promise<IdempotencyLockResult<T>> {
    const requestHash = this.hashPayload(requestPayload);

    for (let attempt = 0; attempt < 3; attempt++) {
      // Check existing record
      const { rows } = await db.query(
        `SELECT * FROM idempotency_keys
         WHERE organization_id = $1 AND key_value = $2
         FOR UPDATE`,
        [organizationId, key]
      );

      if (rows.length > 0) {
        const existing = rows[0];

        // Mismatch detection: Same key, different request content
        if (existing.request_hash && existing.request_hash !== requestHash) {
          throw new IdempotencyConflictError(
            `Idempotency key "${key}" was previously used with a different request payload.`,
            'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PARAMS'
          );
        }

        // If already completed, return cached response
        if (existing.completed_at && existing.response_body) {
          return {
            isCached: true,
            cachedResponse: {
              statusCode: existing.response_status || 200,
              body: existing.response_body as T,
            },
            unlock: async () => {}, // No-op for cached
          };
        }

        // If locked but not completed, wait up to 4500ms for in-flight execution to complete
        const waitStart = Date.now();
        while (Date.now() - waitStart < 4500) {
          await new Promise(r => setTimeout(r, 80));
          const { rows: pollRows } = await db.query(
            `SELECT * FROM idempotency_keys WHERE id = $1`,
            [existing.id]
          );
          if (pollRows.length > 0 && pollRows[0].completed_at && pollRows[0].response_body) {
            return {
              isCached: true,
              cachedResponse: {
                statusCode: pollRows[0].response_status || 200,
                body: pollRows[0].response_body as T,
              },
              unlock: async () => {},
            };
          }
        }

        // If still not completed after waiting, throw conflict
        throw new IdempotencyConflictError(
          `A concurrent request with idempotency key "${key}" is currently being processed. Please retry.`,
          'CONCURRENT_REQUEST_IN_PROGRESS'
        );
      }

      // Fresh key: Insert new lock row
      const lockId = ulid();
      try {
        await db.query(
          `INSERT INTO idempotency_keys (
            id, organization_id, key_value, request_path, request_hash, locked_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [lockId, organizationId, key, requestPath, requestHash]
        );

        return {
          isCached: false,
          unlock: async (statusCode: number, responseBody: unknown) => {
            await db.query(
              `UPDATE idempotency_keys
               SET response_status = $1, response_body = $2, completed_at = NOW()
               WHERE id = $3`,
              [statusCode, JSON.stringify(responseBody), lockId]
            );
          },
        };
      } catch (err: any) {
        if (err?.code === '23505') {
          // Another concurrent request inserted the key between SELECT and INSERT; retry loop
          continue;
        }
        throw err;
      }
    }

    throw new IdempotencyConflictError(
      `Could not acquire idempotency lock for key "${key}". Please retry.`,
      'CONCURRENT_LOCK_ACQUISITION_FAILED'
    );
  }
}
