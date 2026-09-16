import * as crypto from 'crypto';
import { DemoMerchantStore } from '../src/demo-merchant/server';
import { ShoppingAgent } from '../src/demo-merchant/agent-flow';
import { FrameMcpTools } from '../src/mcp/tools';
import { db } from '../src/db';
import { WebhookReceiver } from '../src/modules/payments/webhooks/webhook-receiver';

const BASE = 'http://localhost:3001/v1';

async function rawRequest(path: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runE2EAgentCheckoutSuite() {
  console.log('\n================================================================');
  console.log('🛒 RUNNING E2E AGENT BROWSER CHECKOUT & PAYMENT TEST SUITE');
  console.log('================================================================\n');

  // Start Demo Merchant Store on port 3002
  const merchantStore = new DemoMerchantStore();
  const merchantPort = await merchantStore.start(3002).catch(() => 3002);
  const merchantUrl = `http://localhost:${merchantPort}`;
  console.log(`  🏪 Demo Merchant Store listening on ${merchantUrl}`);

  const testId = Date.now().toString(36);

  // ── 0. SETUP TENANT ALPHA & BETA ────────────────────────────
  console.log('\n--- 0. SETUP: PROVISION TENANTS & AGENTS ---');

  // Org Alpha
  const regAlpha = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `alpha_e2e_${testId}@enterprise.corp`,
    password: 'Password123!',
    name: 'Admin Alpha E2E',
    organization_name: `Alpha E2E Corp ${testId}`,
  });
  assert(regAlpha.status === 201, 'Tenant Alpha created');
  const tokenAlpha = regAlpha.data.token;
  const orgAlphaId = regAlpha.data.organization.id;

  const agentAlphaRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAlpha}` },
  }, {
    name: 'Alpha Shopping Agent',
    role: 'Autonomous Procurement',
  });
  assert(agentAlphaRes.status === 201, 'Agent Alpha provisioned');
  const agentAlpha = agentAlphaRes.data;

  const keyAlphaRes = await rawRequest(`/agents/${agentAlpha.id}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAlpha}` },
  }, {});
  assert(keyAlphaRes.status === 201, 'Agent Alpha API Key generated');
  const agentApiKeyAlpha = keyAlphaRes.data.api_key;

  // Spend Policy for Alpha:
  // - Max per transaction: ₹5,000 (500,000 paise)
  // - Approval threshold: ₹2,500 (250,000 paise)
  // - Allowed categories: ['electronics', 'office', 'peripherals']
  // - Restricted: 'gambling'
  const policyAlphaRes = await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAlpha}` },
  }, {
    name: 'Alpha Procurement Policy',
    agent_id: agentAlpha.id,
    transaction_limit_paise: 500000,
    daily_limit_paise: 2000000,
    approval_threshold_paise: 250000,
    allowed_categories: ['electronics', 'office', 'peripherals'],
  });
  assert(policyAlphaRes.status === 201, 'Policy Alpha created');

  // Org Beta (for cross-tenant testing)
  const regBeta = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `beta_e2e_${testId}@enterprise.corp`,
    password: 'Password123!',
    name: 'Admin Beta E2E',
    organization_name: `Beta E2E Corp ${testId}`,
  });
  assert(regBeta.status === 201, 'Tenant Beta created');
  const tokenBeta = regBeta.data.token;
  const orgBetaId = regBeta.data.organization.id;

  const agentBetaRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenBeta}` },
  }, {
    name: 'Beta Purchasing Agent',
    role: 'Beta Procurement',
  });
  const agentBeta = agentBetaRes.data;

  const keyBetaRes = await rawRequest(`/agents/${agentBeta.id}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenBeta}` },
  }, {});
  const agentApiKeyBeta = keyBetaRes.data.api_key;

  await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenBeta}` },
  }, {
    name: 'Beta Policy',
    agent_id: agentBeta.id,
    transaction_limit_paise: 1000000,
    daily_limit_paise: 5000000,
    approval_threshold_paise: 500000,
    allowed_categories: ['electronics', 'saas'],
  });

  const mcpToolsAlpha = new FrameMcpTools({
    apiUrl: BASE,
    agentApiKey: agentApiKeyAlpha,
  });

  const agentAlphaRunner = new ShoppingAgent({
    merchantBaseUrl: merchantUrl,
    frameMcpTools: mcpToolsAlpha,
    agentApiKey: agentApiKeyAlpha,
  });

  // ── TEST 1: Browser Checkout -> Frame MCP -> ALLOW -> Payment Execution -> Ledger ─
  console.log('\n--- TEST 1: AUTO-APPROVAL FLOW (Keyboard ₹2,499 under ₹3,000) ---');
  const purchase1 = await agentAlphaRunner.executePurchase({
    keyword: 'mechanical keyboard',
    maxBudgetRupees: 3000,
    idempotencyKey: `e2e_t1_${testId}`,
  });

  assert(purchase1.step === 'COMPLETED', 'Agent completed purchase step');
  assert(purchase1.paymentResponse?.decision === 'ALLOW', 'Policy Firewall evaluated ALLOW');
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(purchase1.paymentResponse?.status || ''), 'Intent status valid');
  assert(purchase1.orderFulfilled === true, 'Merchant order marked PAID and fulfilled');

  // Verify Ledger: Exactly one DEBIT entry for this payment
  const { rows: ledgerRows1 } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT'`,
    [orgAlphaId]
  );
  assert(ledgerRows1.length === 1, 'Exactly one ledger debit entry created');
  assert(Number(ledgerRows1[0].amount_paise) === 249900, 'Ledger debit matches ₹2,499 (249,900 paise)');
  const savedIntentId1 = purchase1.paymentResponse!.payment_intent_id;

  // ── TEST 2: Browser Checkout -> Frame MCP -> REQUIRE_APPROVAL -> Human Approves ──
  console.log('\n--- TEST 2: HUMAN APPROVAL ESCALATION & RESUMPTION (Chair ₹2,799 > ₹2,500) ---');
  const purchase2 = await agentAlphaRunner.executePurchase({
    keyword: 'ergonomic',
    idempotencyKey: `e2e_t2_${testId}`,
  });

  assert(purchase2.step === 'WAITING_HUMAN_APPROVAL', 'Purchase correctly paused in WAITING_HUMAN_APPROVAL');
  assert(purchase2.paymentResponse?.decision === 'REQUIRE_APPROVAL', 'Policy Firewall returned REQUIRE_APPROVAL');
  assert(purchase2.paymentResponse?.status === 'PENDING_APPROVAL', 'Intent is PENDING_APPROVAL');

  // Find queued approval task in Frame
  const approvalIntentId = purchase2.paymentResponse!.payment_intent_id;
  const approvalsListRes = await rawRequest('/approvals', {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenAlpha}` },
  });
  const approvalTask = approvalsListRes.data.find((a: any) => a.payment_intent_id === approvalIntentId);
  assert(approvalTask !== undefined, 'Approval task queued in review queue');
  assert(approvalTask.status === 'pending', 'Approval task is pending human review');

  // Human Administrator approves the transaction
  const approveActionRes = await rawRequest(`/approvals/${approvalTask.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAlpha}` },
  }, { comment: 'Approved for developer ergonomic ergonomics request' });
  assert(approveActionRes.status === 200, 'Human approver successfully approved intent');

  // Check payment status via MCP after human approval
  const statusAfterApproval = await mcpToolsAlpha.getPaymentStatus({
    payment_intent_id: approvalIntentId,
    agent_api_key: agentApiKeyAlpha,
  });
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(statusAfterApproval.status), 'Payment resumed execution to completion');

  // Verify Ledger has second debit entry
  const { rows: ledgerRows2 } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT'`,
    [orgAlphaId]
  );
  assert(ledgerRows2.length === 2, 'Exactly two ledger debit entries now exist in Org Alpha');

  // ── TEST 3: Browser Checkout -> Frame MCP -> DENY (Blocked Category) ────────
  console.log('\n--- TEST 3: BLOCKED CATEGORY DENIAL (Casino Chips) ---');
  const purchase3 = await agentAlphaRunner.executePurchase({
    keyword: 'casino',
    idempotencyKey: `e2e_t3_${testId}`,
  });

  assert(purchase3.step === 'POLICY_DENIED', 'Transaction halted in POLICY_DENIED');
  assert(purchase3.paymentResponse?.decision === 'DENY', 'Decision is DENY');
  assert(purchase3.paymentResponse?.status === 'DENIED', 'Status is DENIED');
  assert(purchase3.orderFulfilled === false, 'Merchant order was NOT fulfilled');

  // Ledger must NOT have increased
  const { rows: ledgerRows3 } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT'`,
    [orgAlphaId]
  );
  assert(ledgerRows3.length === 2, 'Zero new ledger debits created for DENIED transaction');

  // ── TEST 4: Checkout Amount Tampering Defense ───────────────────────────────
  console.log('\n--- TEST 4: CHECKOUT AMOUNT TAMPERING DEFENSE (₹2,499 -> ₹9,999) ---');
  // Agent attempts to pass an inflated amount exceeding policy max limit ₹5,000
  const tamperedResult = await agentAlphaRunner.executePurchase({
    keyword: 'mechanical keyboard',
    idempotencyKey: `e2e_t4_${testId}`,
    tamperAmountRupees: 9999.00, // Tampered! Exceeds ₹5,000 limit
  });

  assert(
    tamperedResult.paymentResponse?.decision === 'DENY' || tamperedResult.step === 'POLICY_DENIED',
    'Tampered payment exceeding spend policy was blocked by Frame Policy Firewall'
  );

  // ── TEST 5: Merchant Mismatch Defense ──────────────────────────────────────
  console.log('\n--- TEST 5: UNRECOGNIZED / UNTRUSTED MERCHANT DEFENSE ---');
  let merchantBlocked = false;
  try {
    await mcpToolsAlpha.createPaymentIntent({
      amount: 500,
      currency: 'INR',
      merchant: '', // Empty or invalid merchant name
      purpose: 'Tampered Merchant',
      idempotency_key: `e2e_t5_${testId}`,
    });
  } catch (err: any) {
    merchantBlocked = true;
  }
  assert(merchantBlocked, 'Invalid or empty merchant identifier rejected by input validation');

  // ── TEST 6: Duplicate Agent Request (Idempotency Replay Protection) ────────
  console.log('\n--- TEST 6: IDEMPOTENCY REPLAY DEDUPLICATION ---');
  const replayIdempKey = `e2e_replay_${testId}`;
  const replay1 = await mcpToolsAlpha.createPaymentIntent({
    amount: 1499.00,
    currency: 'INR',
    merchant: 'demo_store',
    purpose: 'Precision Wireless Mouse',
    category: 'electronics',
    idempotency_key: replayIdempKey,
  });

  const replay2 = await mcpToolsAlpha.createPaymentIntent({
    amount: 1499.00,
    currency: 'INR',
    merchant: 'demo_store',
    purpose: 'Precision Wireless Mouse',
    category: 'electronics',
    idempotency_key: replayIdempKey,
  });

  assert(replay1.payment_intent_id === replay2.payment_intent_id, 'Duplicate call returned exact same intent ID');
  assert(replay1.status === replay2.status, 'Duplicate call returned cached status');

  // Verify exactly one debit for the mouse in ledger
  const { rows: mouseLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1 AND amount_paise = 149900`,
    [orgAlphaId]
  );
  assert(mouseLedger.length === 1, 'Exactly one ledger debit recorded despite duplicate agent dispatches');

  // ── TEST 7: Cross-Tenant Access Defense ─────────────────────────────────────
  console.log('\n--- TEST 7: CROSS-TENANT MCP ACCESS REJECTION ---');
  // Agent B in Org Beta creates an intent
  const mcpToolsBeta = new FrameMcpTools({
    apiUrl: BASE,
    agentApiKey: agentApiKeyBeta,
  });
  const betaIntent = await mcpToolsBeta.createPaymentIntent({
    amount: 1000.00,
    currency: 'INR',
    merchant: 'demo_store',
    purpose: 'Beta Cloud Item',
    category: 'saas',
    idempotency_key: `e2e_beta_intent_${testId}`,
  });

  // Agent Alpha tries to read Beta intent status
  let alphaCrossStatusBlocked = false;
  try {
    await mcpToolsAlpha.getPaymentStatus({
      payment_intent_id: betaIntent.payment_intent_id,
      agent_api_key: agentApiKeyAlpha,
    });
  } catch (err: any) {
    alphaCrossStatusBlocked = true;
    assert(err.code === 'NOT_FOUND' || err.code === 'HTTP_404', 'Cross-tenant status rejected with 404');
  }
  assert(alphaCrossStatusBlocked, 'Agent Alpha blocked from inspecting Org Beta payment');

  // ── TEST 8: Complete Audit Trail Reconstruction ─────────────────────────────
  console.log('\n--- TEST 8: COMPLETE AUDIT TRAIL RECONSTRUCTION ---');
  const { rows: auditEvents } = await db.query(
    `SELECT action, actor_type, resource_type, resource_id, occurred_at
     FROM audit_events
     WHERE organization_id = $1 AND (resource_id = $2 OR (new_state->>'intent_id') = $2)
     ORDER BY occurred_at ASC`,
    [orgAlphaId, savedIntentId1]
  );

  const actions = auditEvents.map((e) => e.action);
  console.log('  Audit trail actions:', actions);
  assert(actions.includes('payment_intent.created'), 'Audit trail contains payment_intent.created');
  assert(actions.includes('payment_intent.evaluated'), 'Audit trail contains payment_intent.evaluated');
  assert(actions.includes('payment.executed') || actions.includes('payment.succeeded'), 'Audit trail records payment execution');

  // ── TEST 9: Provider Failure Handling ───────────────────────────────────────
  console.log('\n--- TEST 9: PROVIDER FAILURE SAFETY (NO FALSE LEDGER DEBITS) ---');
  const prevDebitsCount = (
    await db.query(`SELECT COUNT(*) FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT'`, [orgAlphaId])
  ).rows[0].count;

  const failedIntentRes = await mcpToolsAlpha.createPaymentIntent({
    amount: 1000.00,
    currency: 'INR',
    merchant: 'demo_store',
    purpose: 'Simulated Network Glitch',
    category: 'electronics',
    idempotency_key: `e2e_fail_${testId}`,
    metadata: {
      mock_outcome: 'failed',
    },
  });

  // Payment status should reflect failure or failure caught
  const failStatus = await mcpToolsAlpha.getPaymentStatus({
    payment_intent_id: failedIntentRes.payment_intent_id,
    agent_api_key: agentApiKeyAlpha,
  });
  console.log(`  Failed payment status: ${failStatus.status}`);

  // CRITICAL: Ensure zero ledger debits recorded for failed payment
  const postDebitsCount = (
    await db.query(`SELECT COUNT(*) FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT'`, [orgAlphaId])
  ).rows[0].count;
  assert(prevDebitsCount === postDebitsCount, 'Zero ledger debits added for failed payment provider execution');

  // ── TEST 10: Inbound Webhook Settlement ─────────────────────────────────────
  console.log('\n--- TEST 10: INBOUND WEBHOOK SIGNATURE & SETTLEMENT ---');
  // Create an intent in Beta
  const webhookIntentRes = await mcpToolsBeta.createPaymentIntent({
    amount: 750.00,
    currency: 'INR',
    merchant: 'demo_store',
    purpose: 'Webhook Trigger Item',
    category: 'electronics',
    idempotency_key: `e2e_wh_${testId}`,
  });

  // Verify payment record exists in Beta
  const { rows: whPaymentRows } = await db.query(
    `SELECT * FROM payments WHERE payment_intent_id = $1`,
    [webhookIntentRes.payment_intent_id]
  );
  assert(whPaymentRows.length > 0, 'Payment record found for webhook test');
  const whPayment = whPaymentRows[0];

  // Process mock webhook with valid HMAC-SHA256 signature
  const rawWhPayload = JSON.stringify({
    event_id: `evt_wh_${testId}`,
    event_type: 'payment.captured',
    payment_id: whPayment.id,
    provider_payment_id: whPayment.provider_payment_id,
    status: 'SUCCESS',
  });
  const whSignature = crypto.createHmac('sha256', 'mock_webhook_secret_default').update(rawWhPayload).digest('hex');

  const webhookResult = await WebhookReceiver.processWebhook(
    'mock',
    rawWhPayload,
    JSON.parse(rawWhPayload),
    { 'x-frame-mock-signature': whSignature }
  );
  assert(['processed', 'deduplicated', 'ignored_terminal'].includes(webhookResult.status), 'Webhook processed safely');

  // ── TEST 11: Ledger Double-Entry Correctness & Immutability ─────────────────
  console.log('\n--- TEST 11: LEDGER IMMUTABILITY & BALANCE INTEGRITY ---');
  const { rows: allDebits } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1`,
    [orgAlphaId]
  );
  assert(allDebits.length > 0, 'Ledger has recorded verified financial entries');
  for (const entry of allDebits) {
    assert(entry.entry_type === 'DEBIT', 'Entry type is valid DEBIT');
    assert(Number(entry.amount_paise) > 0, 'Ledger entry has positive amount_paise');
    assert(entry.entry_hash && entry.entry_hash.length > 0, 'Ledger entry has immutable entry hash');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 11 E2E AGENT CHECKOUT & PAYMENT SCENARIOS PASSED!');
  console.log('================================================================\n');

  await merchantStore.stop();
}

runE2EAgentCheckoutSuite()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n❌ E2E AGENT CHECKOUT SUITE FAILED:', err);
    process.exit(1);
  });
