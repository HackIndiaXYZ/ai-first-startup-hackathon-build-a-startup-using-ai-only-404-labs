// Ledger Service
// Implements tamper-evident double-entry financial ledger recording with SHA-256 hash chaining.

import * as crypto from 'crypto';
import { ulid } from 'ulid';
import { db } from '../../../db';

export interface RecordLedgerEntryParams {
  organizationId: string;
  agentId?: string | null;
  paymentIntentId: string;
  paymentId: string;
  entryType: 'DEBIT' | 'CREDIT' | 'HOLD' | 'RELEASE' | 'REFUND' | 'FEE';
  amountPaise: number;
  currency?: string;
  providerReference?: string | null;
  description?: string | null;
}

export class LedgerService {
  /**
   * Appends an immutable financial entry to the organization's ledger chain.
   * Every entry links to the previous entry's hash to ensure tamper evidence.
   */
  static async recordEntry(params: RecordLedgerEntryParams): Promise<{ id: string; entryHash: string }> {
    const amountPaise = parseInt(String(params.amountPaise), 10);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error(`Ledger amount must be a positive integer in paise, received: ${params.amountPaise}`);
    }

    const currency = (params.currency || 'INR').toUpperCase();
    const entryId = ulid();

    // 1. Idempotency Check: A payment cannot have duplicate entries of the same type (e.g. duplicate DEBIT)
    const { rows: existing } = await db.query(
      `SELECT id, entry_hash FROM ledger_entries
       WHERE payment_id = $1 AND entry_type = $2
       LIMIT 1`,
      [params.paymentId, params.entryType]
    );

    if (existing.length > 0) {
      return { id: existing[0].id, entryHash: existing[0].entry_hash };
    }

    // 2. Fetch the previous hash in this organization's chain with lock
    const { rows: prevRows } = await db.query(
      `SELECT entry_hash FROM ledger_entries
       WHERE organization_id = $1
       ORDER BY recorded_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [params.organizationId]
    );

    const previousHash = prevRows.length > 0 ? prevRows[0].entry_hash : 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';

    const canonicalData = JSON.stringify({
      amount_paise: params.amountPaise,
      currency,
      entry_id: entryId,
      entry_type: params.entryType,
      organization_id: params.organizationId,
      payment_id: params.paymentId,
      payment_intent_id: params.paymentIntentId,
      provider_reference: params.providerReference || null,
    });

    const entryHash = crypto.createHash('sha256').update(previousHash + canonicalData).digest('hex');

    const { rows: insertRows } = await db.query(
      `INSERT INTO ledger_entries (
        id, organization_id, agent_id, payment_intent_id, payment_id,
        entry_type, amount_paise, currency, provider_reference, description,
        previous_hash, entry_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (payment_id, entry_type) DO NOTHING
      RETURNING id, entry_hash`,
      [
        entryId,
        params.organizationId,
        params.agentId || null,
        params.paymentIntentId,
        params.paymentId,
        params.entryType,
        params.amountPaise,
        currency,
        params.providerReference || null,
        params.description || `Ledger entry for payment ${params.paymentId}`,
        previousHash,
        entryHash,
      ]
    );

    if (insertRows.length === 0) {
      // Conflict occurred under concurrency; return the existing row
      const { rows: confRows } = await db.query(
        `SELECT id, entry_hash FROM ledger_entries WHERE payment_id = $1 AND entry_type = $2 LIMIT 1`,
        [params.paymentId, params.entryType]
      );
      return { id: confRows[0].id, entryHash: confRows[0].entry_hash };
    }

    return { id: entryId, entryHash };
  }
}
