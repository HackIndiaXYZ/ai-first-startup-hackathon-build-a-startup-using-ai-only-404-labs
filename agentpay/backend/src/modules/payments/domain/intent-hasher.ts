// Canonical Intent Hasher
// Computes and verifies tamper-evident cryptographic hashes of payment intents.

import * as crypto from 'crypto';

export interface CanonicalIntentFields {
  organization_id: string;
  agent_id: string;
  amount_paise: number;
  currency: string;
  merchant: string;
  merchant_reference?: string | null;
  purpose: string;
  task_reference?: string | null;
  policy_version_id?: string | null;
  idempotency_key: string;
  expires_at?: Date | string | null;
}

/**
 * Computes a deterministic SHA-256 hash of all security-critical financial intent fields.
 * Canonical serialization guarantees identical keys in sorted order regardless of property ordering.
 */
export function computeCanonicalIntentHash(fields: CanonicalIntentFields): string {
  // Normalize timestamp to ISO string if present
  let normalizedExpiry: number | null = null;
  if (fields.expires_at) {
    normalizedExpiry = Math.floor(new Date(fields.expires_at).getTime() / 1000);
  }

  const canonicalPayload = {
    agent_id: fields.agent_id,
    amount_paise: parseInt(String(fields.amount_paise), 10),
    currency: fields.currency.toUpperCase(),
    expires_at: normalizedExpiry,
    idempotency_key: fields.idempotency_key,
    merchant: fields.merchant.trim(),
    merchant_reference: fields.merchant_reference ? fields.merchant_reference.trim() : null,
    organization_id: fields.organization_id,
    policy_version_id: fields.policy_version_id || null,
    purpose: fields.purpose.trim(),
    task_reference: fields.task_reference ? fields.task_reference.trim() : null,
  };

  // Deterministic JSON string with lexicographically sorted keys
  const serialized = JSON.stringify(canonicalPayload, Object.keys(canonicalPayload).sort());
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Asserts that the stored intent_hash matches the recalculated hash of the intent's current state.
 * If any financial or policy field was tampered with, this returns false.
 */
export function verifyIntentIntegrity(intent: CanonicalIntentFields & { intent_hash: string }): boolean {
  const recalculated = computeCanonicalIntentHash(intent);
  return crypto.timingSafeEqual(
    Buffer.from(intent.intent_hash, 'hex'),
    Buffer.from(recalculated, 'hex')
  );
}
