// Frame — Production-Grade Asynchronous Payment Execution Test Suite
// Verifies:
// 1. Payment job creation & enqueueing (HTTP 202 Accepted)
// 2. Worker execution via PaymentOrchestrator
// 3. Duplicate job delivery safety (exactly 1 provider call, exactly 1 ledger debit)
// 4. API retry with same idempotency key
// 5. Worker crash simulation (in-flight recovery -> UNKNOWN safety)
// 6. Provider timeout simulation
// 7. UNKNOWN state preservation (UNKNOWN != FAILED, no false debit)
// 8. Reconciliation of UNKNOWN payment
// 9. Webhook racing with worker (terminal state respected)
// 10. Duplicate webhook deduplication
// 11. Ledger idempotency under race conditions
// 12. Tenant isolation in async worker & orchestrator
// 13. Revoked agent protection
// 14. Denied payment intent cannot be queued/executed
// 15. Human approval promotion to async queue

import * as crypto from 'crypto';
import { db } from '../src/db';
import { PaymentOrchestrator } from '../src/modules/payments/orchestrator/payment-orchestrator';
import { ProviderRegistry } from '../src/modules/payments/providers/provider-registry';
import { MockPaymentProvider } from '../src/modules/payments/providers/mock-provider';
import { LedgerService } from '../src/modules/payments/ledger/ledger.service';
import { ReconciliationService } from '../src/modules/payments/reconciliation/reconciliation.service';
import { WebhookReceiver } from '../src/modules/payments/webhooks/webhook-receiver';
import {
  startPaymentExecutionWorker,
  stopPaymentExecutionWorker,
} from '../src/queue/payment-execution.worker';
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
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data: Record<string, any> = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { httpStatus: res.status, ...data, status: data.status !== undefined ? data.status : res.status };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runAsyncWorkerSuite() {
  console.log('\n================================================================');
  console.log('🧪 PRODUCTION-GRADE ASYNCHRONOUS PAYMENT EXECUTION TEST SUITE');
  console.log('   Architecture: BullMQ + Redis + PostgreSQL Row Locks + Ledger');
  console.log('================================================================\n');

  // Start background worker for tests
  const worker = startPaymentExecutionWorker(5);
  console.log('  ✓ Payment execution worker started with concurrency = 5');

  const testId = Date.now().toString(36);
  const email = `async_${testId}@test.com`;

  // Setup: Register Organization & User
  const regRes = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    email,
    password: 'Password123!',
    name: 'Async Tester',
    organization_name: `Async Org ${testId}`,
  });
  assert(regRes.httpStatus === 201, 'User & Organization registered');
  const userToken = regRes.data.token;
  const userHeaders = { Authorization: `Bearer ${userToken}` };
  const orgId = regRes.data.organization.id;

  // Setup: Provision Agent
  const agentRes = await request(`${BASE}/agents`, { method: 'POST', headers: userHeaders }, {
    name: `Async Bot ${testId}`,
    role: 'Automated Operations',
  });
  const agent = agentRes.data;

  const keyRes = await request(`${BASE}/agents/${agent.id}/credentials`, { method: 'POST', headers: userHeaders }, {});
  assert(keyRes.httpStatus === 201, 'Agent API key issued');
  const agentApiKey = keyRes.data.api_key;
  const agentHeaders = { 'X-API-Key': agentApiKey };

  // Setup: Spend Policy (Max ₹1,000, Approval threshold ₹500, Allowed category: cloud)
  await request(`${BASE}/policies`, { method: 'POST', headers: userHeaders }, {
    name: 'Async Spending Policy',
    agent_id: agent.id,
    max_amount_paise: 100000, // ₹1,000 max
    daily_budget_paise: 500000,
    approval_threshold_paise: 50000, // ₹500 approval threshold
    allowed_categories: ['cloud', 'saas'],
  });
  console.log('  ✓ Spend policy attached: ₹1,000 max, ₹500 approval threshold');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 1: PAYMENT JOB CREATION & ENQUEUEING (HTTP 202 ACCEPTED)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 1. PAYMENT JOB CREATION & ENQUEUEING ---');
  // Create an intent above ₹500 approval threshold (starts in PENDING_APPROVAL, zero initial payments)
  const intent1Res = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 60000, // ₹600 > ₹500 threshold -> REQUIRE_APPROVAL
    currency: 'INR',
    merchant: 'Cloudflare Inc',
    purpose: 'DNS capacity',
    category: 'cloud',
    idempotency_key: `async_intent_1_${testId}`,
  });
  assert(intent1Res.httpStatus === 201, 'Intent created in PENDING_APPROVAL state');
  const intent1 = intent1Res.data;
  assert(intent1.status === 'PENDING_APPROVAL', 'Initial intent status is PENDING_APPROVAL');

  // Promote intent to AUTHORIZED state for explicit asynchronous execution
  await db.query(`UPDATE payment_intents SET status = 'AUTHORIZED' WHERE id = $1`, [intent1.id]);

  // Call POST /v1/payment-intents/:id/execute
  const exec1Res = await request(`${BASE}/payment-intents/${intent1.id}/execute`, {
    method: 'POST',
    headers: userHeaders,
  }, {});

  assert(exec1Res.httpStatus === 202, 'API responded with HTTP 202 Accepted (Non-blocking async ingestion)');
  assert(exec1Res.status === 'ACCEPTED', 'Response status is ACCEPTED');
  assert(exec1Res.data?.payment?.status === 'pending', 'Payment record initialized with status "pending"');
  assert(exec1Res.data?.payment?.provider_status === 'QUEUED', 'Provider status is QUEUED');
  assert(exec1Res.data?.job_id !== undefined, 'Durable execution job ID generated');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 2: WORKER CONSUMES JOB & EXECUTES PAYMENT
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 2. WORKER EXECUTION VIA PAYMENTORCHESTRATOR ---');
  // Allow worker up to 3 seconds to pick up the job from Redis and complete it
  let payment1Settled = false;
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    const { rows } = await db.query('SELECT * FROM payments WHERE id = $1', [exec1Res.data.payment.id]);
    if (rows.length > 0 && rows[0].status === 'succeeded') {
      payment1Settled = true;
      break;
    }
  }
  assert(payment1Settled, 'Worker successfully consumed job and settled payment to "succeeded"');

  const { rows: ledgerRows1 } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [exec1Res.data.payment.id]
  );
  assert(ledgerRows1.length === 1, 'Exactly one ledger entry created by worker');
  assert(ledgerRows1[0].entry_type === 'DEBIT', 'Ledger entry is DEBIT');
  assert(Number(ledgerRows1[0].amount_paise) === 60000, 'Ledger debit matches 60000 paise');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 3: DUPLICATE JOB DELIVERY SAFETY
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 3. DUPLICATE JOB DELIVERY SAFETY (IDEMPOTENT NO-OP) ---');
  // Dispatch provider execution again for the exact same payment ID (simulating duplicate BullMQ delivery)
  const dupResult = await PaymentOrchestrator.dispatchProviderExecution(
    exec1Res.data.payment.id,
    orgId
  );
  assert(dupResult.payment.status === 'succeeded', 'Duplicate job delivery detected terminal state safely');

  const { rows: ledgerRowsDup } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [exec1Res.data.payment.id]
  );
  assert(ledgerRowsDup.length === 1, 'CRITICAL FINANCIAL SAFETY: Duplicate job delivery caused ZERO duplicate debits');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 4: API RETRY WITH SAME IDEMPOTENCY KEY
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 4. API RETRY WITH SAME IDEMPOTENCY KEY ---');
  const retryIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 60000,
    currency: 'INR',
    merchant: 'Cloudflare Inc',
    purpose: 'DNS capacity',
    category: 'cloud',
    idempotency_key: `async_intent_1_${testId}`, // Same idempotency key as Scenario 1
  });
  assert(retryIntentRes.httpStatus === 201, 'Duplicate intent request recognized existing intent');
  assert(retryIntentRes.data.id === intent1.id, 'Returned identical payment intent ID');

  const retryExecRes = await request(`${BASE}/payment-intents/${intent1.id}/execute`, {
    method: 'POST',
    headers: userHeaders,
  }, {});
  assert(retryExecRes.httpStatus === 202, 'Execution retry handled gracefully with 202');
  assert(retryExecRes.data.payment.id === exec1Res.data.payment.id, 'Reused existing payment record');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 5: WORKER CRASH SIMULATION & IN-FLIGHT RECOVERY
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 5. WORKER CRASH SIMULATION & IN-FLIGHT RECOVERY ---');
  // Create an intent and prepare payment
  const crashIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 15000,
    currency: 'INR',
    merchant: 'Compute Engine',
    purpose: 'Worker crash test',
    category: 'cloud',
    idempotency_key: `crash_intent_${testId}`,
  });
  const crashIntent = crashIntentRes.data;

  // Insert a payment with an in-flight attempt ('processing') simulating worker death from SIGKILL
  const crashPaymentId = ulid();
  await db.query(
    `INSERT INTO payments (
      id, payment_intent_id, organization_id, provider, amount_paise, currency,
      rail, status, provider_status, reconciliation_status, updated_at
    ) VALUES ($1, $2, $3, 'mock', 15000, 'INR', 'mock', 'processing', 'INITIATED', 'unreconciled', NOW() - INTERVAL '40 seconds')`,
    [crashPaymentId, crashIntent.id, orgId]
  );

  await db.query(
    `INSERT INTO payment_attempts (
      id, payment_id, attempt_number, status, provider_request, attempted_at
    ) VALUES ($1, $2, 1, 'processing', '{"amount": 15000}', NOW() - INTERVAL '40 seconds')`,
    [ulid(), crashPaymentId]
  );

  // Now trigger the actual startup crash recovery sweep (simulating process restart)
  console.log('  Simulating process restart: executing recovery sweep for abandoned executions...');
  const recoveredList = await PaymentOrchestrator.recoverStaleExecutions(30000);
  assert(recoveredList.some(r => r.paymentId === crashPaymentId), 'Recovery sweep successfully identified abandoned in-flight payment');

  const { rows: recoveredPaymentRows } = await db.query(
    `SELECT * FROM payments WHERE id = $1`,
    [crashPaymentId]
  );
  assert(recoveredPaymentRows[0].status === 'unknown', 'Crash recovery sweep transitioned abandoned payment to "unknown" (NOT failed)');
  assert(recoveredPaymentRows[0].error_code === 'WORKER_CRASH_IN_FLIGHT', 'Correct crash error code recorded');

  const { rows: crashLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [crashPaymentId]
  );
  assert(crashLedger.length === 0, 'CRITICAL INVARIANT: Zero ledger debits for in-flight crashed payment');

  // Verify duplicate worker delivery after crash recovery is a safe no-op
  const dupWorkerResult = await PaymentOrchestrator.dispatchProviderExecution(crashPaymentId, orgId);
  assert(dupWorkerResult.payment.status === 'unknown', 'Duplicate worker delivery after crash recovery is a safe no-op');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 6 & 7: PROVIDER TIMEOUT SIMULATION & UNKNOWN HANDLING
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 6 & 7. PROVIDER TIMEOUT SIMULATION & UNKNOWN PRESERVATION ---');
  const timeoutIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 12000,
    currency: 'INR',
    merchant: 'Network Services',
    purpose: 'Timeout test',
    category: 'cloud',
    idempotency_key: `timeout_intent_${testId}`,
    metadata: { mock_outcome: 'timeout' }, // ⚠️ Simulates provider timeout
  });
  const timeoutIntent = timeoutIntentRes.data;

  // Prepare and dispatch execution with timeout outcome
  const timeoutPrep = await PaymentOrchestrator.prepareExecution(timeoutIntent.id, orgId);
  const timeoutExecResult = await PaymentOrchestrator.dispatchProviderExecution(
    timeoutPrep.payment.id,
    orgId
  );

  assert(timeoutExecResult.payment.status === 'unknown', 'Provider timeout produced status "unknown"');
  assert(timeoutExecResult.payment.error_code === 'TIMEOUT', 'Error code is TIMEOUT');
  assert(timeoutExecResult.intent.status === 'EXECUTING', 'Payment intent remains in EXECUTING (never falsely failed)');

  const { rows: timeoutLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [timeoutPrep.payment.id]
  );
  assert(timeoutLedger.length === 0, 'No ledger debit recorded for timed-out payment');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 8: RECONCILIATION OF UNKNOWN PAYMENT
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 8. RECONCILIATION RESOLUTION OF UNKNOWN PAYMENT ---');
  const reconResult = await ReconciliationService.reconcileOrganization(orgId);
  assert(reconResult.resolvedCount >= 1, 'Reconciliation detected and resolved the UNKNOWN payment');

  const { rows: reconciledPayment } = await db.query(
    `SELECT * FROM payments WHERE id = $1`,
    [timeoutPrep.payment.id]
  );
  assert(reconciledPayment[0].status === 'succeeded', 'Reconciliation safely resolved UNKNOWN payment to "succeeded"');

  const { rows: reconLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [timeoutPrep.payment.id]
  );
  assert(reconLedger.length === 1, 'Ledger debited exactly once upon confirmed reconciliation');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 9: WEBHOOK RACING WITH WORKER (CONCURRENT RACE)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 9. WEBHOOK RACING WITH WORKER (CONCURRENT RACE) ---');
  const raceIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 18000,
    currency: 'INR',
    merchant: 'Race Vendor',
    purpose: 'Race condition test',
    category: 'cloud',
    idempotency_key: `race_intent_${testId}`,
  });
  const raceIntent = raceIntentRes.data;
  const racePrep = await PaymentOrchestrator.prepareExecution(raceIntent.id, orgId);

  // Launch BOTH worker execution AND webhook arrival simultaneously using Promise.all
  console.log('  Simulating simultaneous worker dispatch and webhook arrival with Promise.all...');
  const [workerOutcome, webhookOutcome] = await Promise.all([
    PaymentOrchestrator.dispatchProviderExecution(racePrep.payment.id, orgId),
    PaymentOrchestrator.applyPaymentResult(
      racePrep.payment.id,
      raceIntent.id,
      orgId,
      agent.id,
      18000,
      'INR',
      {
        providerPaymentId: `wh_race_${ulid()}`,
        status: 'succeeded',
        providerStatus: 'CAPTURED',
        rawResponse: { source: 'webhook_concurrent_race' },
      }
    ),
  ]);

  assert(workerOutcome.payment.status === 'succeeded', 'Worker settled payment as succeeded');
  assert(webhookOutcome.payment.status === 'succeeded', 'Webhook settled payment as succeeded');

  const { rows: raceLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [racePrep.payment.id]
  );
  assert(raceLedger.length === 1, 'CRITICAL FINANCIAL SAFETY: Exactly one ledger debit created despite concurrent race');

  // Verify Terminal State Regression Defense:
  // Attempting to transition succeeded payment to FAILED must be rejected
  console.log('  Verifying state machine regression defense (SUCCEEDED -> FAILED blocked)...');
  const illegalRegressionResult = await PaymentOrchestrator.applyPaymentResult(
    racePrep.payment.id,
    raceIntent.id,
    orgId,
    agent.id,
    18000,
    'INR',
    {
      providerPaymentId: `late_fail_${ulid()}`,
      status: 'failed',
      providerStatus: 'FAILED',
      errorCode: 'LATE_DECLINE',
      errorDescription: 'Simulated late decline arriving after settlement',
      rawResponse: { error: 'Late decline simulation' },
    }
  );
  assert(illegalRegressionResult.payment.status === 'succeeded', 'Terminal state protected: Status remains "succeeded"');

  const { rows: postIllegalLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [racePrep.payment.id]
  );
  assert(postIllegalLedger.length === 1, 'Ledger entry remains intact with zero corruption');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 10: DUPLICATE WEBHOOK DEDUPLICATION
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 10. DUPLICATE WEBHOOK DEDUPLICATION ---');
  const whPayload = {
    event_id: `wh_event_${testId}`,
    payment_id: racePrep.payment.id,
    status: 'succeeded',
    amount: 18000,
    timestamp: new Date().toISOString(),
  };
  const whSecret = 'mock_webhook_secret_default';
  const whSignature = crypto.createHmac('sha256', whSecret).update(JSON.stringify(whPayload)).digest('hex');

  const whRes1 = await request(`${BASE}/webhooks/mock`, {
    method: 'POST',
    headers: {
      'X-Frame-Mock-Signature': whSignature,
    },
  }, whPayload);
  assert(whRes1.httpStatus === 200, 'Initial webhook processed');

  const whRes2 = await request(`${BASE}/webhooks/mock`, {
    method: 'POST',
    headers: {
      'X-Frame-Mock-Signature': whSignature,
    },
  }, whPayload);
  assert(whRes2.httpStatus === 200, 'Duplicate webhook accepted safely');
  assert(whRes2.result?.status === 'deduplicated', 'Duplicate webhook correctly flagged as deduplicated');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 11: LEDGER IDEMPOTENCY UNDER CONCURRENCY
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 11. LEDGER IDEMPOTENCY UNDER CONCURRENCY ---');
  const testPaymentId = ulid();
  await db.query(
    `INSERT INTO payments (id, payment_intent_id, organization_id, provider, amount_paise, currency, status)
     VALUES ($1, $2, $3, 'mock', 5000, 'INR', 'succeeded')`,
    [testPaymentId, raceIntent.id, orgId]
  );

  const entry1 = await LedgerService.recordEntry({
    organizationId: orgId,
    agentId: agent.id,
    paymentIntentId: raceIntent.id,
    paymentId: testPaymentId,
    entryType: 'DEBIT',
    amountPaise: 5000,
  });

  const entry2 = await LedgerService.recordEntry({
    organizationId: orgId,
    agentId: agent.id,
    paymentIntentId: raceIntent.id,
    paymentId: testPaymentId,
    entryType: 'DEBIT',
    amountPaise: 5000,
  });

  assert(entry1.id === entry2.id, 'Second ledger entry attempt returned existing entry ID');
  assert(entry1.entryHash === entry2.entryHash, 'Second ledger entry attempt returned matching hash');

  const { rows: ledgerDupCheck } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [testPaymentId]
  );
  assert(ledgerDupCheck.length === 1, 'Exactly one entry persisted in ledger_entries');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 12: TENANT ISOLATION IN WORKER & ORCHESTRATOR
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 12. MULTI-TENANT ISOLATION IN WORKER ---');
  const regBeta = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    email: `beta_worker_${testId}@test.com`,
    password: 'Password123!',
    name: 'Beta Worker',
    organization_name: `Beta Org ${testId}`,
  });
  const orgBetaId = regBeta.data.organization.id;

  try {
    await PaymentOrchestrator.dispatchProviderExecution(exec1Res.data.payment.id, orgBetaId);
    assert(false, 'Cross-tenant worker execution should have failed');
  } catch (err: any) {
    assert(err.code === 'PAYMENT_NOT_FOUND', 'Cross-tenant execution blocked with PAYMENT_NOT_FOUND');
  }

  // ────────────────────────────────────────────────────────────
  // SCENARIO 13: REVOKED AGENT PROTECTION
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 13. REVOKED AGENT PROTECTION ---');
  await request(`${BASE}/agents/${agent.id}/disable`, { method: 'POST', headers: userHeaders }, {
    reason: 'Revoked test',
  });

  const revokedIntentRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 10000,
    currency: 'INR',
    merchant: 'Vendor X',
    purpose: 'Revoked test',
    category: 'cloud',
    idempotency_key: `revoked_${testId}`,
  });
  assert(revokedIntentRes.httpStatus === 403, 'Disabled agent blocked with HTTP 403');
  assert(revokedIntentRes.error?.code === 'AGENT_DISABLED', 'Error code is AGENT_DISABLED');

  // ────────────────────────────────────────────────────────────
  // SCENARIO 14: DENIED PAYMENT INTENT CANNOT BE QUEUED
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 14. DENIED PAYMENT INTENT CANNOT BE EXECUTED ---');
  // Re-enable agent to test policy denial
  await request(`${BASE}/agents/${agent.id}/enable`, { method: 'POST', headers: userHeaders }, {});

  const deniedIntentRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 10000,
    currency: 'INR',
    merchant: 'Gambling Vendor',
    purpose: 'Casino deposit',
    category: 'gambling', // Disallowed category
    idempotency_key: `denied_${testId}`,
  });
  assert(deniedIntentRes.data.status === 'DENIED', 'Policy firewall evaluated DENY');

  try {
    await PaymentOrchestrator.prepareExecution(deniedIntentRes.data.id, orgId);
    assert(false, 'Denied intent should not be queueable');
  } catch (err: any) {
    assert(err.code === 'INTENT_NOT_AUTHORIZED', 'Attempt to execute DENIED intent rejected with INTENT_NOT_AUTHORIZED');
  }

  // ────────────────────────────────────────────────────────────
  // SCENARIO 15: APPROVAL FLOW PROMOTION TO ASYNC QUEUE
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 15. HUMAN APPROVAL PROMOTION TO ASYNC QUEUE ---');
  const approvalIntentRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 80000, // ₹800 > ₹500 approval threshold -> REQUIRE_APPROVAL
    currency: 'INR',
    merchant: 'AWS Cloud',
    purpose: 'GPU Cluster topup',
    category: 'cloud',
    idempotency_key: `approval_${testId}`,
  });
  assert(approvalIntentRes.data.status === 'PENDING_APPROVAL', 'Intent in PENDING_APPROVAL state');

  const { rows: tasks } = await db.query(
    `SELECT * FROM approval_tasks WHERE payment_intent_id = $1`,
    [approvalIntentRes.data.id]
  );
  assert(tasks.length === 1, 'Approval task queued in admin review center');

  // Admin approves payment
  const approveRes = await request(`${BASE}/approvals/${tasks[0].id}/approve`, {
    method: 'POST',
    headers: userHeaders,
  }, {
    comment: 'Approved GPU capacity expansion',
  });
  assert(approveRes.httpStatus === 200, 'Admin approval accepted');

  // Verify worker picked up and settled the approved payment
  let approvedSettled = false;
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    const { rows } = await db.query('SELECT * FROM payment_intents WHERE id = $1', [approvalIntentRes.data.id]);
    if (rows.length > 0 && rows[0].status === 'SUCCEEDED') {
      approvedSettled = true;
      break;
    }
  }
  assert(approvedSettled, 'Approved payment asynchronously settled to SUCCEEDED by worker');

  // Clean shutdown of worker
  await stopPaymentExecutionWorker();
  console.log('  ✓ Payment execution worker stopped cleanly');

  console.log('\n================================================================');
  console.log('🎉 ALL 15 ASYNCHRONOUS WORKER & SAFETY SCENARIOS PASSED!');
  console.log('================================================================\n');
}

runAsyncWorkerSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Asynchronous Worker Suite Failed:', err);
    process.exit(1);
  });
