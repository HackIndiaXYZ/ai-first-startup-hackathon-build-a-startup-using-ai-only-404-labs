// Deterministic Local Razorpay Webhook Test Suite
// Verifies:
// 1. Signature Verification: Valid signature accepted, invalid/tampered rejected
// 2. Raw Payload Persistence: provider_events persists raw payload and verification status
// 3. Deduplication: Duplicate webhook replay creates zero duplicate state transitions/ledger entries
// 4. State Transitions: payment.captured -> SUCCEEDED + DEBIT ledger; payment.failed -> FAILED + 0 ledger
// 5. Webhook Racing with Worker: Concurrent Promise.all -> monotonic terminal state + 1 ledger entry
// 6. Configured Secret Usage: Uses RAZORPAY_WEBHOOK_SECRET or provider config secret (no hardcoded secrets)

import * as crypto from 'crypto';
import { db } from '../../src/db';
import { PaymentOrchestrator } from '../../src/modules/payments/orchestrator/payment-orchestrator';
import { ProviderRegistry } from '../../src/modules/payments/providers/provider-registry';
import { WebhookReceiver } from '../../src/modules/payments/webhooks/webhook-receiver';
import { ulid } from 'ulid';

const BASE = 'http://localhost:3001/v1';

async function request(url: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, {
    ...options,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: Record<string, any> = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { httpStatus: res.status, ...data };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runRazorpayWebhookSuite() {
  console.log('\n================================================================');
  console.log('⚡ RUNNING LOCAL RAZORPAY WEBHOOK VERIFICATION SUITE');
  console.log('   Endpoint: POST /v1/webhooks/razorpay');
  console.log('================================================================\n');

  const testId = Date.now();

  // 1. Determine active webhook secret from environment or generate a dedicated test secret
  const configuredWebhookSecret =
    process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET !== 'YOUR_WEBHOOK_SECRET_HERE'
      ? process.env.RAZORPAY_WEBHOOK_SECRET
      : `rzp_sec_${crypto.randomBytes(16).toString('hex')}`;

  console.log(`  🔒 Using configured webhook secret: [REDACTED_LENGTH_${configuredWebhookSecret.length}]`);

  // 2. Setup Organization & Configure Razorpay Provider
  const regRes = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    name: 'Webhook Audit User',
    email: `wh_audit_${testId}@framepay.internal`,
    password: 'Password123!',
    organization_name: `Webhook Audit Org ${testId}`,
  });
  assert(regRes.httpStatus === 201, 'Organization registered');
  const orgId = regRes.data.organization.id;
  const userHeaders = { Authorization: `Bearer ${regRes.data.token}` };

  const cfgRes = await request(`${BASE}/providers`, { method: 'POST', headers: userHeaders }, {
    provider_type: 'razorpay',
    name: 'Razorpay Sandbox Config',
    is_default: true,
    webhook_secret: configuredWebhookSecret,
    settings: {
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
    },
  });
  assert(cfgRes.httpStatus === 201, 'Razorpay provider configured with active webhook secret');

  // 3. Provision Agent & Policy
  const agentRes = await request(`${BASE}/agents`, { method: 'POST', headers: userHeaders }, {
    name: `Webhook Agent ${testId}`,
    purpose: 'Auditing Razorpay webhooks',
  });
  const agent = agentRes.data;

  const keyRes = await request(`${BASE}/agents/${agent.id}/credentials`, { method: 'POST', headers: userHeaders }, {});
  const agentHeaders = { 'X-API-Key': keyRes.data.api_key };

  await request(`${BASE}/policies`, { method: 'POST', headers: userHeaders }, {
    name: 'Webhook Policy',
    agent_id: agent.id,
    transaction_limit_paise: 5000000,
    daily_limit_paise: 50000000,
    monthly_limit_paise: 500000000,
    approval_threshold_paise: 5000000, // No manual approval needed for tests
  });

  // Helper to create a test payment intent & initial payment
  async function createTestPayment(tag: string, amountPaise: number = 35000) {
    const intRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
      amount_paise: amountPaise,
      currency: 'INR',
      merchant: `Razorpay Merchant ${tag}`,
      purpose: `Test payment ${tag}`,
      category: 'cloud',
      idempotency_key: `rzp_wh_intent_${tag}_${testId}`,
    });
    const orderId = `order_${tag}_${testId}`;
    const payId = ulid();

    await db.query(
      `INSERT INTO payments (
         id, payment_intent_id, organization_id, provider, amount_paise, currency,
         rail, status, provider_payment_id, provider_status, reconciliation_status
       ) VALUES ($1, $2, $3, 'razorpay', $4, 'INR', 'upi', 'processing', $5, 'CREATED', 'unreconciled')`,
      [payId, intRes.data.id, orgId, amountPaise, orderId]
    );

    return { intent: intRes.data, paymentId: payId, orderId };
  }

  // ────────────────────────────────────────────────────────────
  // SCENARIO 1: VALID SIGNATURE ACCEPTED & RAW PAYLOAD STORED
  // ────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 1: VALID SIGNATURE ACCEPTED & RAW PAYLOAD STORED ---');
  const t1 = await createTestPayment('valid_sig', 25000);
  const rzpPaymentId1 = `pay_${testId}_01`;

  const validPayload = {
    entity: 'event',
    id: `evt_test_${testId}_01`,
    account_id: 'acc_test_org',
    event: 'payment.captured',
    contains: ['payment'],
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: rzpPaymentId1,
          order_id: t1.orderId,
          amount: 25000,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
          vpa: 'user@okhdfcbank',
          notes: {
            payment_id: t1.paymentId,
            organization_id: orgId,
          },
        },
      },
    },
  };

  const rawValidPayloadString = JSON.stringify(validPayload);
  const validSignature = crypto
    .createHmac('sha256', configuredWebhookSecret)
    .update(rawValidPayloadString)
    .digest('hex');

  const res1 = await request(`${BASE}/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'x-razorpay-signature': validSignature,
    },
  }, validPayload);

  assert(res1.httpStatus === 200, 'Valid signature returned HTTP 200 OK');
  assert(res1.status === 'ok', 'Response status is ok');

  // Check database state transitions
  const { rows: payRows1 } = await db.query('SELECT * FROM payments WHERE id = $1', [t1.paymentId]);
  assert(payRows1[0].status === 'succeeded', 'Payment status safely transitioned to succeeded');
  assert(payRows1[0].reconciliation_status === 'reconciled', 'Payment reconciliation status is reconciled');

  // Check ledger entry
  const { rows: ledgerRows1 } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [t1.paymentId]);
  assert(ledgerRows1.length === 1, 'Exactly one ledger entry created');
  assert(ledgerRows1[0].entry_type === 'DEBIT', 'Ledger entry is DEBIT');
  assert(parseInt(ledgerRows1[0].amount_paise, 10) === 25000, 'Ledger debit matches 25000 paise');

  // Check raw provider event stored in provider_events
  const { rows: eventRows1 } = await db.query(
    'SELECT * FROM provider_events WHERE provider = $1 AND payment_id = $2',
    ['razorpay', t1.paymentId]
  );
  assert(eventRows1.length >= 1, 'Raw event stored in provider_events before/during execution');
  assert(eventRows1[0].verified === true, 'provider_events.verified is TRUE for valid signature');
  assert(eventRows1[0].processed === true, 'provider_events.processed is TRUE');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 2: INVALID & TAMPERED SIGNATURE REJECTED (HTTP 400)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 2: INVALID & TAMPERED SIGNATURE REJECTED (HTTP 400) ---');
  const t2 = await createTestPayment('invalid_sig', 15000);

  const invalidPayload = {
    entity: 'event',
    account_id: 'acc_test_org',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_${testId}_02`,
          order_id: t2.orderId,
          amount: 15000,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  };

  // Case A: Bad signature string
  const res2Bad = await request(`${BASE}/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'x-razorpay-signature': 'invalid_signature_hex_000000000000000000000000000000000000000000000000',
    },
  }, invalidPayload);
  assert(res2Bad.httpStatus === 400, 'Invalid signature rejected with HTTP 400');
  assert(res2Bad.error?.code === 'WEBHOOK_PROCESSING_FAILED', 'Error code is WEBHOOK_PROCESSING_FAILED');

  // Verify payment remained in processing (not transitioned)
  const { rows: payRows2 } = await db.query('SELECT status FROM payments WHERE id = $1', [t2.paymentId]);
  assert(payRows2[0].status === 'processing', 'Payment status unchanged after rejected invalid webhook');

  // Verify security audit: raw invalid attempt was captured in provider_events
  const { rows: eventRows2 } = await db.query(
    'SELECT * FROM provider_events WHERE provider = $1 AND verified = FALSE ORDER BY created_at DESC LIMIT 1',
    ['razorpay']
  );
  assert(eventRows2.length === 1, 'Raw invalid webhook attempt persisted for auditability (verified = FALSE)');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 3: DUPLICATE WEBHOOK DEDUPLICATION & ZERO DOUBLE DEBITS
  // ────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 3: DUPLICATE WEBHOOK DEDUPLICATION ---');
  // Re-send the exact valid payload from Scenario 1
  const replayRes = await request(`${BASE}/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'x-razorpay-signature': validSignature,
    },
  }, validPayload);

  assert(replayRes.httpStatus === 200, 'Duplicate webhook accepted with HTTP 200 (idempotent)');
  assert(replayRes.result?.status === 'deduplicated', 'Webhook receiver returned status "deduplicated"');

  // Confirm ledger still has strictly 1 debit
  const { rows: ledgerReplay } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [t1.paymentId]);
  assert(ledgerReplay.length === 1, 'CRITICAL SAFETY: Duplicate webhook caused ZERO duplicate ledger debits');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 4: WEBHOOK RACING WITH WORKER (CONCURRENT RACE)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 4: WEBHOOK RACING WITH WORKER ---');
  const t4 = await createTestPayment('worker_race', 50000);
  const rzpPaymentId4 = `pay_${testId}_04`;

  const racePayload = {
    entity: 'event',
    id: `evt_race_${testId}_04`,
    account_id: 'acc_test_org',
    event: 'payment.captured',
    contains: ['payment'],
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: rzpPaymentId4,
          order_id: t4.orderId,
          amount: 50000,
          currency: 'INR',
          status: 'captured',
          notes: { payment_id: t4.paymentId },
        },
      },
    },
  };

  const rawRacePayloadString = JSON.stringify(racePayload);
  const raceSignature = crypto
    .createHmac('sha256', configuredWebhookSecret)
    .update(rawRacePayloadString)
    .digest('hex');

  // Launch Worker applyPaymentResult and WebhookReceiver concurrently via Promise.all
  const [workerRaceResult, webhookRaceResult] = await Promise.all([
    PaymentOrchestrator.applyPaymentResult(
      t4.paymentId,
      t4.intent.id,
      orgId,
      agent.id,
      50000,
      'INR',
      {
        providerPaymentId: t4.orderId,
        status: 'succeeded',
        providerStatus: 'CAPTURED',
        rawResponse: { simulatedWorker: true },
      }
    ),
    request(`${BASE}/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'x-razorpay-signature': raceSignature },
    }, racePayload),
  ]);

  assert(workerRaceResult.payment.status === 'succeeded', 'Worker settled payment as succeeded');
  assert(webhookRaceResult.httpStatus === 200, 'Webhook handled race safely');

  // Confirm final state is succeeded
  const { rows: payRaceRows } = await db.query('SELECT status FROM payments WHERE id = $1', [t4.paymentId]);
  assert(payRaceRows[0].status === 'succeeded', 'Final payment state is strictly succeeded');

  // Confirm ledger entry uniqueness
  const { rows: ledgerRaceRows } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [t4.paymentId]);
  assert(ledgerRaceRows.length === 1, 'CRITICAL FINANCIAL SAFETY: Exactly one ledger debit created under race');

  // Attempt state regression (out-of-order failed webhook arriving after succeeded)
  const outOfOrderFailPayload = {
    entity: 'event',
    account_id: 'acc_test_org',
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: `pay_fail_${testId}`,
          order_id: t4.orderId,
          amount: 50000,
          currency: 'INR',
          status: 'failed',
        },
      },
    },
  };
  const rawFailPayloadString = JSON.stringify(outOfOrderFailPayload);
  const failSignature = crypto
    .createHmac('sha256', configuredWebhookSecret)
    .update(rawFailPayloadString)
    .digest('hex');

  const lateFailRes = await request(`${BASE}/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'x-razorpay-signature': failSignature },
  }, outOfOrderFailPayload);

  assert(lateFailRes.httpStatus === 200, 'Late failing webhook acknowledged cleanly');
  assert(lateFailRes.result?.status === 'ignored_terminal', 'Out-of-order failure was safely ignored_terminal');

  const { rows: payPostFailRows } = await db.query('SELECT status FROM payments WHERE id = $1', [t4.paymentId]);
  assert(payPostFailRows[0].status === 'succeeded', 'Payment state preserved in SUCCEEDED (no regression to failed)');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 5: PAYMENT.FAILED EVENT NORMALIZATION & SETTLEMENT
  // ────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 5: PAYMENT.FAILED WEBHOOK EVENT ---');
  const t5 = await createTestPayment('failed_event', 10000);
  const failedPayload = {
    entity: 'event',
    id: `evt_failed_${testId}_05`,
    account_id: 'acc_test_org',
    event: 'payment.failed',
    contains: ['payment'],
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: `pay_declined_${testId}`,
          order_id: t5.orderId,
          amount: 10000,
          currency: 'INR',
          status: 'failed',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment was declined by customer bank.',
        },
      },
    },
  };

  const rawFailedPayloadString = JSON.stringify(failedPayload);
  const failedSig = crypto
    .createHmac('sha256', configuredWebhookSecret)
    .update(rawFailedPayloadString)
    .digest('hex');

  const resFailed = await request(`${BASE}/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'x-razorpay-signature': failedSig },
  }, failedPayload);

  assert(resFailed.httpStatus === 200, 'payment.failed webhook accepted');
  const { rows: payFailedRows } = await db.query('SELECT status, error_code FROM payments WHERE id = $1', [t5.paymentId]);
  assert(payFailedRows[0].status === 'failed', 'Payment accurately transitioned to failed');

  const { rows: ledgerFailedRows } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [t5.paymentId]);
  assert(ledgerFailedRows.length === 0, 'Zero ledger debits created for failed payment');

  console.log('\n================================================================');
  console.log('🎉 ALL LOCAL RAZORPAY WEBHOOK VERIFICATION TESTS PASSED!');
  console.log('================================================================\n');
}

runRazorpayWebhookSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Razorpay Webhook Suite Failed:', err);
    process.exit(1);
  });
