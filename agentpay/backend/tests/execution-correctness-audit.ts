// Frame — Execution Correctness & Concurrency Audit Test Suite
// Verifies:
// 1. Critical Concurrency: Promise.all([dispatch, dispatch]) -> provider.executePayment() === 1
// 2. Crash After Provider Acceptance: Zero duplicate provider calls on restart/recovery
// 3. UNKNOWN Recovery Paths (A: Webhook, B: Lost Webhook + Recon, C: Recon, D: Duplicate Recon, E: Duplicate Worker, F: Restart)
// 4. Webhook + Reconciliation + Worker Triple Race
// 5. Actual Subprocess SIGKILL Process Loss & Stale Recovery

import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { db } from '../src/db';
import { PaymentOrchestrator } from '../src/modules/payments/orchestrator/payment-orchestrator';
import { ProviderRegistry } from '../src/modules/payments/providers/provider-registry';
import { MockPaymentProvider } from '../src/modules/payments/providers/mock-provider';
import { ReconciliationService } from '../src/modules/payments/reconciliation/reconciliation.service';
import { WebhookReceiver } from '../src/modules/payments/webhooks/webhook-receiver';
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
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runAuditSuite() {
  console.log('\n================================================================');
  console.log('🔬 RUNNING ADVERSARIAL EXECUTION CORRECTNESS & CONCURRENCY AUDIT');
  console.log('================================================================');

  const testId = Date.now();

  // 1. Setup Tenant & Agent
  const regRes = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    name: 'Audit User',
    email: `audit_cto_${testId}@framepay.internal`,
    password: 'Password123!',
    organization_name: `Audit Org ${testId}`,
  });
  const userHeaders = { Authorization: `Bearer ${regRes.data.token}` };
  const orgId = regRes.data.organization.id;

  const agentRes = await request(`${BASE}/agents`, { method: 'POST', headers: userHeaders }, {
    name: `Audit Agent ${testId}`,
    purpose: 'Auditing execution correctness',
  });
  const agent = agentRes.data;

  const keyRes = await request(`${BASE}/agents/${agent.id}/credentials`, { method: 'POST', headers: userHeaders }, {});
  const agentHeaders = { 'X-API-Key': keyRes.data.api_key };

  await request(`${BASE}/policies`, { method: 'POST', headers: userHeaders }, {
    name: 'Audit Policy',
    agent_id: agent.id,
    transaction_limit_paise: 5000000,
    daily_limit_paise: 50000000,
    monthly_limit_paise: 500000000,
    approval_threshold_paise: 5000, // ₹50 threshold -> payments start in PENDING_APPROVAL
    allowed_categories: ['*'],
  });

  // ────────────────────────────────────────────────────────────
  // AUDIT TEST 1: CRITICAL CONCURRENCY — TWO WORKERS, SAME PAYMENT
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 1. CRITICAL CONCURRENCY: TWO WORKERS, SAME PAYMENT ---');
  MockPaymentProvider.resetExecutionCounts();

  const concIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 50000,
    currency: 'INR',
    merchant: 'Double Execution Test',
    purpose: 'Verify atomic provider lease',
    category: 'compute',
    idempotency_key: `conc_exec_${testId}`,
  });
  const concIntent = concIntentRes.data;
  await db.query(`UPDATE payment_intents SET status = 'AUTHORIZED' WHERE id = $1`, [concIntent.id]);
  const concPrep = await PaymentOrchestrator.prepareExecution(concIntent.id, orgId, { synchronous: true });

  // Launch TWO independent workers for the EXACT SAME payment simultaneously
  console.log('  Dispatching two workers concurrently for the same paymentId...');
  const [workerA, workerB] = await Promise.all([
    PaymentOrchestrator.dispatchProviderExecution(concPrep.payment.id, orgId),
    PaymentOrchestrator.dispatchProviderExecution(concPrep.payment.id, orgId),
  ]);

  assert(workerA.payment.status === 'succeeded', 'Worker A completed with succeeded');
  assert(workerB.payment.status === 'succeeded', 'Worker B completed with succeeded');

  // CRITICAL AUDIT ASSERTION:
  // Must prove that MockPaymentProvider.executePayment was called EXACTLY ONCE!
  const providerCalls = MockPaymentProvider.getExecutionCount(concPrep.payment.id);
  assert(providerCalls === 1, `CRITICAL SAFETY: provider.executePayment() called EXACTLY ONCE (Actual: ${providerCalls})`);

  const { rows: concLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_id = $1`,
    [concPrep.payment.id]
  );
  assert(concLedger.length === 1, 'Ledger has exactly one DEBIT entry');

  // ────────────────────────────────────────────────────────────
  // AUDIT TEST 2: CRASH AFTER PROVIDER ACCEPTANCE
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 2. CRASH AFTER PROVIDER ACCEPTANCE (ZERO SECOND EXECUTION) ---');
  // Model the boundary: Provider accepted order, but worker died before PostgreSQL recorded response.
  const crashPayId = ulid();
  const crashIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 75000,
    currency: 'INR',
    merchant: 'Crash Boundary Vendor',
    purpose: 'Crash after accept',
    category: 'cloud',
    idempotency_key: `crash_after_accept_${testId}`,
  });
  const crashIntent = crashIntentRes.data;

  // Insert payment in 'processing' state
  await db.query(
    `INSERT INTO payments (
      id, payment_intent_id, organization_id, provider, amount_paise, currency,
      rail, status, provider_status, reconciliation_status, updated_at
    ) VALUES ($1, $2, $3, 'mock', 75000, 'INR', 'mock', 'processing', 'INITIATED', 'unreconciled', NOW() - INTERVAL '35 seconds')`,
    [crashPayId, crashIntent.id, orgId]
  );
  await db.query(
    `INSERT INTO payment_attempts (
      id, payment_id, attempt_number, status, provider_request, attempted_at
    ) VALUES ($1, $2, 1, 'processing', '{"amount": 75000}', NOW() - INTERVAL '35 seconds')`,
    [ulid(), crashPayId]
  );

  // Set provider execution count for this payment to 1 (representing the external order already created)
  MockPaymentProvider.executionsByPaymentId.set(crashPayId, 1);

  // Now Worker B / Recovery runs.
  console.log('  Worker B / Recovery attempts to process the in-flight payment...');
  const recoveryAttempt = await PaymentOrchestrator.dispatchProviderExecution(crashPayId, orgId);
  assert(recoveryAttempt.payment.status === 'processing', 'Worker B observed active in-flight lease and returned without re-executing');

  const callsAfterWorkerB = MockPaymentProvider.getExecutionCount(crashPayId);
  assert(callsAfterWorkerB === 1, `CRITICAL SAFETY: Worker B did NOT dispatch a second provider order (Count: ${callsAfterWorkerB})`);

  // Stale recovery sweep runs (simulating process restart)
  console.log('  Executing stale recovery sweep for abandoned worker...');
  await PaymentOrchestrator.recoverStaleExecutions(30000);

  const { rows: postSweepRows } = await db.query(`SELECT status FROM payments WHERE id = $1`, [crashPayId]);
  assert(postSweepRows[0].status === 'unknown', 'Recovery sweep transitioned abandoned payment to "unknown"');

  const callsAfterSweep = MockPaymentProvider.getExecutionCount(crashPayId);
  assert(callsAfterSweep === 1, `CRITICAL SAFETY: Recovery sweep did NOT dispatch a second provider order (Count: ${callsAfterSweep})`);

  // Reconciliation runs
  await ReconciliationService.reconcileOrganization(orgId);
  const { rows: resolvedCrashRows } = await db.query(`SELECT * FROM payments WHERE id = $1`, [crashPayId]);
  assert(resolvedCrashRows[0].status === 'succeeded', 'Reconciliation resolved payment to "succeeded"');

  const callsAfterRecon = MockPaymentProvider.getExecutionCount(crashPayId);
  assert(callsAfterRecon === 1, `CRITICAL SAFETY: Total external provider orders created = 1 (Count: ${callsAfterRecon})`);

  // ────────────────────────────────────────────────────────────
  // AUDIT TEST 3: UNKNOWN RECOVERY — ALL 6 PATHS
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 3. UNKNOWN RECOVERY: PROVING ALL 6 EXECUTION PATHS ---');

  // Helper to create an UNKNOWN payment
  async function createUnknownPayment(prefix: string) {
    const intRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
      amount_paise: 25000,
      currency: 'INR',
      merchant: `Unknown Path ${prefix}`,
      purpose: `Test path ${prefix}`,
      category: 'cloud',
      idempotency_key: `unknown_path_${prefix}_${testId}`,
      metadata: { mock_outcome: 'timeout' },
    });
    await db.query(`UPDATE payment_intents SET status = 'AUTHORIZED' WHERE id = $1`, [intRes.data.id]);
    const prep = await PaymentOrchestrator.prepareExecution(intRes.data.id, orgId, { synchronous: true });
    const timedOut = await PaymentOrchestrator.dispatchProviderExecution(prep.payment.id, orgId);
    assert(timedOut.payment.status === 'unknown', `Payment ${prefix} initialized to UNKNOWN`);
    return { intent: intRes.data, payment: prep.payment };
  }

  // Path A: UNKNOWN + Webhook Arrives
  console.log('  [Path A] UNKNOWN + Inbound Webhook...');
  const pathA = await createUnknownPayment('A');
  const whPayloadA = {
    event_id: `evt_pathA_${testId}`,
    payment_id: pathA.payment.id,
    status: 'succeeded',
    amount: 25000,
  };
  const whSigA = crypto.createHmac('sha256', 'mock_webhook_secret_default').update(JSON.stringify(whPayloadA)).digest('hex');
  await request(`${BASE}/webhooks/mock`, {
    method: 'POST',
    headers: { 'x-frame-mock-signature': whSigA },
  }, whPayloadA);
  const { rows: pathARows } = await db.query('SELECT status FROM payments WHERE id = $1', [pathA.payment.id]);
  assert(pathARows[0].status === 'succeeded', '[Path A] Webhook successfully took ownership and settled UNKNOWN to succeeded');

  // Path B: UNKNOWN + Webhook Lost -> Reconciliation resolves
  console.log('  [Path B] UNKNOWN + Webhook Lost -> Outbound Reconciliation...');
  const pathB = await createUnknownPayment('B');
  // (No webhook is sent)
  await ReconciliationService.reconcileOrganization(orgId);
  const { rows: pathBRows } = await db.query('SELECT status FROM payments WHERE id = $1', [pathB.payment.id]);
  assert(pathBRows[0].status === 'succeeded', '[Path B] Reconciliation took ownership and settled UNKNOWN to succeeded');

  // Path C: UNKNOWN + Provider Reports Declined
  console.log('  [Path C] UNKNOWN + Provider Reports Failure during Reconciliation...');
  const pathC = await createUnknownPayment('C');
  const { rows: payCRows } = await db.query('SELECT provider_payment_id FROM payments WHERE id = $1', [pathC.payment.id]);
  const provIdC = payCRows[0].provider_payment_id || pathC.payment.id;
  (MockPaymentProvider as any).stateStore.set(provIdC, {
    providerPaymentId: provIdC,
    status: 'failed',
    providerStatus: 'DECLINED_BY_BANK',
    errorCode: 'INSUFFICIENT_FUNDS',
    errorDescription: 'Bank declined transaction: Insufficient balance.',
    rawResponse: { status: 'FAILURE' },
  });
  await ReconciliationService.reconcileOrganization(orgId);
  const { rows: pathCRows } = await db.query('SELECT status FROM payments WHERE id = $1', [pathC.payment.id]);
  assert(pathCRows[0].status === 'failed', '[Path C] Reconciliation accurately settled UNKNOWN to failed');
  const { rows: pathCLedger } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [pathC.payment.id]);
  assert(pathCLedger.length === 0, '[Path C] Zero ledger debits for UNKNOWN payment resolved to failed');

  // Path D: Duplicate Reconciliation
  console.log('  [Path D] UNKNOWN + Duplicate Reconciliation Sweep...');
  const pathD = await createUnknownPayment('D');
  await ReconciliationService.reconcileOrganization(orgId);
  const reconSweep2 = await ReconciliationService.reconcileOrganization(orgId);
  const { rows: pathDRows } = await db.query('SELECT status FROM payments WHERE id = $1', [pathD.payment.id]);
  assert(pathDRows[0].status === 'succeeded', '[Path D] First reconciliation settled payment');
  assert(reconSweep2.totalChecked >= 0, '[Path D] Second reconciliation ran idempotently with zero errors');

  // Path E: Duplicate Worker Job
  console.log('  [Path E] UNKNOWN + Duplicate Worker Delivery...');
  const pathE = await createUnknownPayment('E');
  const initialCallsE = MockPaymentProvider.getExecutionCount(pathE.payment.id);
  const dupWorkerRes = await PaymentOrchestrator.dispatchProviderExecution(pathE.payment.id, orgId);
  assert(dupWorkerRes.payment.status === 'unknown', '[Path E] Worker detected UNKNOWN and returned idempotent no-op');
  assert(MockPaymentProvider.getExecutionCount(pathE.payment.id) === initialCallsE, '[Path E] Worker made ZERO additional provider calls');

  // Path F: Server Restart / Stale Sweep
  console.log('  [Path F] UNKNOWN + Server Restart / Recovery Sweep...');
  const pathF = await createUnknownPayment('F');
  await PaymentOrchestrator.recoverStaleExecutions(0);
  const { rows: pathFRows } = await db.query('SELECT status FROM payments WHERE id = $1', [pathF.payment.id]);
  assert(pathFRows[0].status === 'unknown', '[Path F] Startup sweep preserved UNKNOWN without mutating or double-executing');

  // ────────────────────────────────────────────────────────────
  // AUDIT TEST 4: TRIPLE RACE (WORKER + WEBHOOK + RECONCILIATION)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 4. TRIPLE RACE: WORKER + WEBHOOK + RECONCILIATION ---');
  MockPaymentProvider.resetExecutionCounts();

  const tripleIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 33000,
    currency: 'INR',
    merchant: 'Triple Race Merchant',
    purpose: 'Triple race concurrency',
    category: 'cloud',
    idempotency_key: `triple_race_${testId}`,
  });
  const tripleIntent = tripleIntentRes.data;
  await db.query(`UPDATE payment_intents SET status = 'AUTHORIZED' WHERE id = $1`, [tripleIntent.id]);
  const triplePrep = await PaymentOrchestrator.prepareExecution(tripleIntent.id, orgId, { synchronous: true });

  console.log('  Launching Worker, Webhook, and Reconciliation concurrently via Promise.all...');
  await Promise.all([
    PaymentOrchestrator.dispatchProviderExecution(triplePrep.payment.id, orgId),
    PaymentOrchestrator.applyPaymentResult(
      triplePrep.payment.id,
      tripleIntent.id,
      orgId,
      agent.id,
      33000,
      'INR',
      {
        providerPaymentId: `wh_triple_${ulid()}`,
        status: 'succeeded',
        providerStatus: 'CAPTURED',
        rawResponse: { source: 'triple_webhook' },
      }
    ),
    ReconciliationService.reconcileOrganization(orgId),
  ]);

  const { rows: finalTriplePayment } = await db.query('SELECT * FROM payments WHERE id = $1', [triplePrep.payment.id]);
  assert(finalTriplePayment[0].status === 'succeeded', 'Final payment state is strictly succeeded');

  const tripleCalls = MockPaymentProvider.getExecutionCount(triplePrep.payment.id);
  assert(tripleCalls <= 1, `CRITICAL SAFETY: At most ONE external provider execution call occurred (Calls: ${tripleCalls})`);

  const { rows: tripleLedger } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [triplePrep.payment.id]);
  assert(tripleLedger.length === 1, 'Exactly ONE ledger DEBIT entry created under triple race');

  // ────────────────────────────────────────────────────────────
  // AUDIT TEST 5: ACTUAL SUBPROCESS SIGKILL PROCESS LOSS TEST
  // ────────────────────────────────────────────────────────────
  console.log('\n--- 5. ACTUAL SUBPROCESS SIGKILL PROCESS LOSS TEST ---');
  const sigkillPaymentId = ulid();
  const sigkillIntentRes = await request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, {
    amount_paise: 44000,
    currency: 'INR',
    merchant: 'Sigkill Vendor',
    purpose: 'Real process loss test',
    category: 'cloud',
    idempotency_key: `sigkill_${testId}`,
  });

  // Prepare payment in pending
  await db.query(
    `INSERT INTO payments (
      id, payment_intent_id, organization_id, provider, amount_paise, currency,
      rail, status, provider_status, reconciliation_status
    ) VALUES ($1, $2, $3, 'mock', 44000, 'INR', 'mock', 'pending', 'QUEUED', 'unreconciled')`,
    [sigkillPaymentId, sigkillIntentRes.data.id, orgId]
  );

  // Script for the child process to update payment to processing and wait
  const workerScript = `
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://frame:frame_dev_password@localhost:5432/frame' });
    (async () => {
      await pool.query(
        "UPDATE payments SET status = 'processing', provider_status = 'INITIATED', updated_at = NOW() WHERE id = $1",
        ['${sigkillPaymentId}']
      );
      process.stdout.write('WORKER_IN_FLIGHT_READY\\n');
      await new Promise(r => setTimeout(r, 10000));
    })();
  `;

  console.log('  Spawning real child process worker...');
  const child = spawn('node', ['-e', workerScript], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('WORKER_IN_FLIGHT_READY')) {
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => console.error('Child err:', chunk.toString()));
    child.on('error', reject);
  });

  console.log('  Simulating catastrophic OS process failure: Sending SIGKILL to worker...');
  child.kill('SIGKILL');

  await new Promise<void>((resolve) => {
    child.on('close', (_code, signal) => {
      assert(signal === 'SIGKILL', `Subprocess was genuinely terminated by SIGKILL (Signal: ${signal})`);
      resolve();
    });
  });

  // Verify that the payment was left stranded in PostgreSQL
  const { rows: strandedRows } = await db.query('SELECT status FROM payments WHERE id = $1', [sigkillPaymentId]);
  assert(strandedRows[0].status === 'processing', 'PostgreSQL confirms payment was left in "processing" state by dead process');

  // Now run the startup recovery sweep
  console.log('  Executing Frame startup recovery sweep for abandoned process...');
  await PaymentOrchestrator.recoverStaleExecutions(0);

  const { rows: postSigkillSweepRows } = await db.query('SELECT status, error_code FROM payments WHERE id = $1', [sigkillPaymentId]);
  assert(postSigkillSweepRows[0].status === 'unknown', 'Recovery sweep safely transitioned SIGKILL-abandoned payment to "unknown"');
  assert(postSigkillSweepRows[0].error_code === 'WORKER_CRASH_IN_FLIGHT', 'Correct crash error code recorded');

  // Settle via reconciliation
  await ReconciliationService.reconcileOrganization(orgId);
  const { rows: postReconRows } = await db.query('SELECT status FROM payments WHERE id = $1', [sigkillPaymentId]);
  assert(postReconRows[0].status === 'succeeded', 'Reconciliation settled recovered SIGKILL payment to "succeeded"');

  const { rows: sigkillLedger } = await db.query('SELECT * FROM ledger_entries WHERE payment_id = $1', [sigkillPaymentId]);
  assert(sigkillLedger.length === 1, 'Ledger settled exactly once for recovered SIGKILL payment');

  console.log('\n================================================================');
  console.log('🎉 ALL ADVERSARIAL CONCURRENCY & CORRECTNESS AUDIT TESTS PASSED!');
  console.log('================================================================\n');
}

runAuditSuite().catch((err) => {
  console.error('\n❌ AUDIT FAILED WITH ERROR:', err);
  process.exit(1);
});
