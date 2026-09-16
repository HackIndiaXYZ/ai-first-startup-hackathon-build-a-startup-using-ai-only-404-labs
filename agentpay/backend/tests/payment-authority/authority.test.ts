// Comprehensive Security & Delegated Authorization Test Suite
// Verifies all 22 required authority, security, and financial integrity scenarios.

import { ulid } from 'ulid';
import * as crypto from 'crypto';
import { db } from '../../src/db';
import { AuthorityService } from '../../src/modules/payment-authorities/authority.service';
import { evaluatePolicy } from '../../src/modules/policies/firewall';
import { PaymentOrchestrator } from '../../src/modules/payments/orchestrator/payment-orchestrator';
import { LedgerService } from '../../src/modules/payments/ledger/ledger.service';
import { assertNoSensitiveCredentials, McpSecurityError } from '../../src/mcp/tools';
import { ProviderRegistry } from '../../src/modules/payments/providers/provider-registry';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-provider';

const BASE_URL = 'http://localhost:3001/v1';

async function request(url: string, options: RequestInit = {}, body?: unknown): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const res = await fetch(url, {
    ...options,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runAuthorityTests(): Promise<void> {
  console.log('\n================================================================');
  console.log('🛡️  RUNNING PAYMENT AUTHORITY & SECURITY TEST SUITE (22 SCENARIOS)');
  console.log('================================================================\n');

  // ── Setup: Organizations, Users & Agents ─────────────────────
  console.log('--- 0. PROVISIONING TEST ENVIRONMENT ---');
  const testId = Date.now();
  const regAlpha = await request(`${BASE_URL}/auth/register`, {
    method: 'POST',
  }, {
    name: 'Alpha Admin',
    email: `alpha_${testId}@frame.dev`,
    password: 'Password123!',
    organization_name: 'Security Org Alpha',
  });
  assert(regAlpha.status === 201, 'Alpha Org & Admin registered');
  const orgAlphaId = regAlpha.data.data.organization.id;
  const userAlphaId = regAlpha.data.data.user.id;
  const userAlphaToken = regAlpha.data.data.token;

  const regBeta = await request(`${BASE_URL}/auth/register`, {
    method: 'POST',
  }, {
    name: 'Beta Admin',
    email: `beta_${testId}@frame.dev`,
    password: 'Password123!',
    organization_name: 'Security Org Beta',
  });
  assert(regBeta.status === 201, 'Beta Org & Admin registered');
  const orgBetaId = regBeta.data.data.organization.id;
  const userBetaId = regBeta.data.data.user.id;
  const userBetaToken = regBeta.data.data.token;

  // Create Agents
  const agent1Id = ulid();
  const agent2Id = ulid();
  const agentBetaId = ulid();

  await db.query(`INSERT INTO agents (id, organization_id, name, created_by) VALUES ($1, $2, 'Shopping Agent 1', $3)`, [agent1Id, orgAlphaId, userAlphaId]);
  await db.query(`INSERT INTO agents (id, organization_id, name, created_by) VALUES ($1, $2, 'Unauthorized Agent 2', $3)`, [agent2Id, orgAlphaId, userAlphaId]);
  await db.query(`INSERT INTO agents (id, organization_id, name, created_by) VALUES ($1, $2, 'Beta Shopping Agent', $3)`, [agentBetaId, orgBetaId, userBetaId]);

  // Issue Agent API Keys
  const bcrypt = require('bcryptjs');
  const key1 = `frm_test_agent1_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const key1Hash = await bcrypt.hash(key1, 10);
  await db.query(
    `INSERT INTO agent_credentials (id, agent_id, organization_id, key_prefix, key_hash, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
    [ulid(), agent1Id, orgAlphaId, key1.slice(0, 12), key1Hash]
  );

  const key2 = `frm_test_agent2_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const key2Hash = await bcrypt.hash(key2, 10);
  await db.query(
    `INSERT INTO agent_credentials (id, agent_id, organization_id, key_prefix, key_hash, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
    [ulid(), agent2Id, orgAlphaId, key2.slice(0, 12), key2Hash]
  );

  // Create Policy for Agent 1
  const policyId = ulid();
  const versionId = ulid();
  await db.query(`INSERT INTO policies (id, organization_id, agent_id, name, current_version_id) VALUES ($1, $2, $3, 'Base Policy', $4)`, [policyId, orgAlphaId, agent1Id, versionId]);
  await db.query(
    `INSERT INTO policy_versions (id, policy_id, version_number, transaction_limit_paise, daily_limit_paise, monthly_limit_paise, approval_threshold_paise)
     VALUES ($1, $2, 1, 500000, 2000000, 5000000, 300000)`,
    [versionId, policyId]
  );

  console.log('  ✓ Organizations, Users, Agents, and Policy versions provisioned.');

  // ── SCENARIO 1: Agent without authority → DENY ────────────────
  console.log('\n--- SCENARIO 1: AGENT WITHOUT AUTHORITY → DENY ---');
  const res1 = await AuthorityService.evaluateAuthority(orgAlphaId, agent2Id, 100000);
  assert(res1.valid === false, 'Agent without authority evaluated as invalid');
  assert(res1.reason?.includes('not been granted any PaymentAuthority') === true, 'Correct denial reason recorded');

  // ── Setup Authority for Agent 1: Max ₹5,000 tx, ₹10,000 daily, ₹25,000 monthly
  const validUntilFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const auth1 = await AuthorityService.createAuthority({
    organizationId: orgAlphaId,
    userId: userAlphaId,
    agentId: agent1Id,
    maxTransactionAmountPaise: 500000, // ₹5,000
    dailyLimitPaise: 1000000,          // ₹10,000
    monthlyLimitPaise: 2500000,        // ₹25,000
    allowedCategories: ['electronics', 'software', 'books'],
    blockedCategories: ['gambling', 'crypto'],
    allowedMerchants: ['trusted_electronics', 'amazon_in'],
    blockedMerchants: ['shady_merchant'],
    validUntil: validUntilFuture,
    requiresApprovalAbovePaise: 300000, // ₹3,000 requires human approval
  });
  assert(auth1.status === 'ACTIVE', 'Base authority created in ACTIVE status');

  // ── SCENARIO 2: Expired authority → DENY ──────────────────────
  console.log('\n--- SCENARIO 2: EXPIRED AUTHORITY → DENY ---');
  const expiredAuthId = ulid();
  await db.query(
    `INSERT INTO payment_authorities (
      id, organization_id, user_id, agent_id, provider, rail, currency,
      max_transaction_amount_paise, daily_limit_paise, monthly_limit_paise,
      valid_from, valid_until, status
    ) VALUES ($1, $2, $3, $4, 'mock', 'upi_autopay', 'INR', 500000, 1000000, 2500000, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 hour', 'ACTIVE')`,
    [expiredAuthId, orgAlphaId, userAlphaId, agent2Id]
  );
  const res2 = await AuthorityService.evaluateAuthority(orgAlphaId, agent2Id, 100000);
  assert(res2.valid === false, 'Expired authority denied spend');
  assert(res2.reason?.includes('expired') === true, 'Reason correctly states authority expired');

  // ── SCENARIO 3: Revoked authority → DENY ──────────────────────
  console.log('\n--- SCENARIO 3: REVOKED AUTHORITY → DENY ---');
  await db.query(`UPDATE payment_authorities SET status = 'REVOKED' WHERE id = $1`, [expiredAuthId]);
  const res3 = await AuthorityService.evaluateAuthority(orgAlphaId, agent2Id, 100000);
  assert(res3.valid === false, 'Revoked authority denied spend');
  assert(res3.reason?.includes('revoked') === true, 'Reason correctly states authority revoked');

  // ── SCENARIO 4: Suspended authority → DENY ────────────────────
  console.log('\n--- SCENARIO 4: SUSPENDED AUTHORITY → DENY ---');
  await db.query(`UPDATE payment_authorities SET status = 'SUSPENDED' WHERE id = $1`, [expiredAuthId]);
  const res4 = await AuthorityService.evaluateAuthority(orgAlphaId, agent2Id, 100000);
  assert(res4.valid === false, 'Suspended authority denied spend');
  assert(res4.reason?.includes('suspended') === true, 'Reason correctly states authority suspended');

  // ── SCENARIO 5: Amount above authority max transaction limit → DENY
  console.log('\n--- SCENARIO 5: AMOUNT ABOVE AUTHORITY MAX TX LIMIT → DENY ---');
  const res5 = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 600000, 'electronics', 'trusted_electronics'); // ₹6,000 > ₹5,000
  assert(res5.valid === false, 'Spend exceeding per-transaction limit was denied');
  assert(res5.reason?.includes('exceeds authority max transaction limit') === true, 'Per-transaction limit reason verified');

  // ── SCENARIO 6: Merchant not allowed → DENY ───────────────────
  console.log('\n--- SCENARIO 6: MERCHANT NOT ALLOWED → DENY ---');
  const res6a = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 200000, 'electronics', 'unknown_merchant');
  assert(res6a.valid === false, 'Unlisted merchant denied under allowlist');
  assert(res6a.reason?.includes('not in allowed merchants') === true, 'Merchant allowlist reason confirmed');

  const res6b = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 200000, 'electronics', 'shady_merchant');
  assert(res6b.valid === false, 'Blocklisted merchant explicitly denied');
  assert(res6b.reason?.includes('explicitly blocked') === true, 'Merchant blocklist reason confirmed');

  // ── SCENARIO 7: Category blocked → DENY ───────────────────────
  console.log('\n--- SCENARIO 7: CATEGORY BLOCKED → DENY ---');
  const res7a = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 200000, 'gambling', 'trusted_electronics');
  assert(res7a.valid === false, 'Blocklisted category denied');
  assert(res7a.reason?.includes('Category "gambling" is explicitly blocked') === true, 'Category block reason confirmed');

  const res7b = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 200000, 'fashion', 'trusted_electronics');
  assert(res7b.valid === false, 'Unlisted category denied under allowlist');
  assert(res7b.reason?.includes('not in allowed categories') === true, 'Category allowlist reason confirmed');

  // ── SCENARIO 8: Monthly limit exceeded → DENY ─────────────────
  console.log('\n--- SCENARIO 8: MONTHLY LIMIT EXCEEDED → DENY ---');
  // Temporarily set spent_this_month to ₹24,000 (paise: 2400000). A ₹2,000 spend pushes over ₹25,000 limit
  await db.query(
    `UPDATE payment_authorities SET spent_this_month_paise = 2400000, last_reset_month = TO_CHAR(CURRENT_DATE, 'YYYY-MM') WHERE id = $1`,
    [auth1.id]
  );
  const res8 = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 200000, 'electronics', 'trusted_electronics');
  assert(res8.valid === false, 'Monthly spend limit breach denied');
  assert(res8.reason?.includes('exceed monthly spend limit') === true, 'Monthly limit breach confirmed');
  await db.query(`UPDATE payment_authorities SET spent_this_month_paise = 0 WHERE id = $1`, [auth1.id]);

  // ── SCENARIO 9: Daily limit exceeded → DENY ───────────────────
  console.log('\n--- SCENARIO 9: DAILY LIMIT EXCEEDED → DENY ---');
  // Temporarily set spent_today to ₹9,000. A ₹2,000 spend pushes over ₹10,000 limit
  await db.query(
    `UPDATE payment_authorities SET spent_today_paise = 900000, last_reset_date = CURRENT_DATE WHERE id = $1`,
    [auth1.id]
  );
  const res9 = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 200000, 'electronics', 'trusted_electronics');
  assert(res9.valid === false, 'Daily spend limit breach denied');
  assert(res9.reason?.includes('exceed daily spend limit') === true, 'Daily limit breach confirmed');
  await db.query(`UPDATE payment_authorities SET spent_today_paise = 0 WHERE id = $1`, [auth1.id]);

  // ── SCENARIO 10: Approval threshold → REQUIRE_APPROVAL ────────
  console.log('\n--- SCENARIO 10: APPROVAL THRESHOLD → REQUIRE_APPROVAL ---');
  // Auth threshold is ₹3,000 (300000 paise). Spend ₹3,500
  const res10 = await AuthorityService.evaluateAuthority(orgAlphaId, agent1Id, 350000, 'electronics', 'trusted_electronics');
  assert(res10.valid === true, 'Transaction is compliant with authority constraints');
  assert(res10.requiresApproval === true, 'Correctly flagged as requiring human approval');

  // ── SCENARIO 11: Duplicate idempotency key → single execution ──
  console.log('\n--- SCENARIO 11: DUPLICATE IDEMPOTENCY KEY → SINGLE INTENT & EXECUTION ---');
  const idemKey = `idem_test_${Date.now()}`;
  const intent1Res = await request(`${BASE_URL}/payment-intents`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    amount_paise: 150000, // ₹1,500
    currency: 'INR',
    merchant: 'trusted_electronics',
    purpose: 'Dual execution idempotency test',
    category: 'electronics',
    idempotency_key: idemKey,
  });
  assert(intent1Res.status === 201, 'First intent creation succeeded');
  const firstIntentId = intent1Res.data.data.id;

  const intent2Res = await request(`${BASE_URL}/payment-intents`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    amount_paise: 150000,
    currency: 'INR',
    merchant: 'trusted_electronics',
    purpose: 'Dual execution idempotency test',
    category: 'electronics',
    idempotency_key: idemKey,
  });
  assert(intent2Res.status === 200 || intent2Res.status === 201, 'Second call with identical idempotency key returned cached response');
  assert(intent2Res.data.data.id === firstIntentId, 'Returned EXACT same payment_intent_id');

  // ── SCENARIO 12: Cross-tenant authority access → DENY / 404 ────
  console.log('\n--- SCENARIO 12: CROSS-TENANT AUTHORITY ACCESS → 404 ---');
  // User Beta attempts to view Authority 1 from Org Alpha
  const crossTenantRes = await request(`${BASE_URL}/payment-authorities/${auth1.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${userBetaToken}` },
  });
  assert(crossTenantRes.status === 404, 'Cross-tenant authority inspection blocked with 404');

  // ── SCENARIO 13: Agent attempting to modify authority → 403 ────
  console.log('\n--- SCENARIO 13: AGENT ATTEMPTING TO MODIFY AUTHORITY → 403 ---');
  const agentRevokeRes = await request(`${BASE_URL}/payment-authorities/${auth1.id}/revoke`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {});
  assert(agentRevokeRes.status === 403, 'Agent attempt to revoke authority blocked with 403 Forbidden');
  assert(agentRevokeRes.data.error.code === 'AGENT_AUTHORITY_MUTATION_FORBIDDEN', 'Mutation forbidden code confirmed');

  // ── SCENARIO 14: Agent attempting to create authority → 403 ────
  console.log('\n--- SCENARIO 14: AGENT ATTEMPTING TO CREATE AUTHORITY → 403 ---');
  const agentCreateRes = await request(`${BASE_URL}/payment-authorities`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    agentId: agent1Id,
    maxTransactionAmountPaise: 999999,
    dailyLimitPaise: 9999999,
    monthlyLimitPaise: 99999999,
    validUntil: new Date(Date.now() + 86400000).toISOString(),
  });
  assert(agentCreateRes.status === 403, 'Agent attempt to create authority blocked with 403 Forbidden');

  // ── SCENARIO 15: Agent sending UPI PIN → rejected ─────────────
  console.log('\n--- SCENARIO 15: AGENT SENDING UPI PIN → REJECTED ---');
  let upiPinCaught = false;
  try {
    assertNoSensitiveCredentials({ upi_pin: '123456', amount: 1000 });
  } catch (err: any) {
    upiPinCaught = err instanceof McpSecurityError && err.code === 'SENSITIVE_CREDENTIAL_REJECTED';
  }
  assert(upiPinCaught, 'Credential scanner instantly rejected upi_pin');

  // ── SCENARIO 16: Agent sending OTP → rejected ──────────────────
  console.log('\n--- SCENARIO 16: AGENT SENDING OTP → REJECTED ---');
  let otpCaught = false;
  try {
    assertNoSensitiveCredentials({ metadata: { bank_otp: '987654' } });
  } catch (err: any) {
    otpCaught = err instanceof McpSecurityError && err.code === 'SENSITIVE_CREDENTIAL_REJECTED';
  }
  assert(otpCaught, 'Credential scanner instantly rejected nested OTP');

  // ── SCENARIO 17: Provider timeout → UNKNOWN, never fake success
  console.log('\n--- SCENARIO 17: PROVIDER TIMEOUT → UNKNOWN, NEVER FAKE SUCCESS ---');
  const timeoutIntentRes = await request(`${BASE_URL}/payment-intents`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    amount_paise: 200000,
    currency: 'INR',
    merchant: 'trusted_electronics',
    purpose: 'Provider timeout verification',
    category: 'electronics',
    idempotency_key: `timeout_${Date.now()}`,
    metadata: { mock_outcome: 'timeout' },
  });
  const timeoutIntentId = timeoutIntentRes.data.data.id;
  const timeoutPaymentResult = await PaymentOrchestrator.executeIntent(timeoutIntentId, orgAlphaId, {
    metadata: { mock_outcome: 'timeout' },
  });
  assert(timeoutPaymentResult.payment.status === 'unknown', 'Payment status is strictly UNKNOWN');
  assert(timeoutPaymentResult.payment.provider_status === 'GATEWAY_TIMEOUT', 'Provider status is GATEWAY_TIMEOUT');

  // ── SCENARIO 18: Webhook replay → ignored ─────────────────────
  console.log('\n--- SCENARIO 18: WEBHOOK REPLAY → SAFELY DEDUPLICATED ---');
  const rawWebhook = JSON.stringify({
    event_id: `evt_test_${Date.now()}`,
    event_type: 'payment.succeeded',
    provider_payment_id: timeoutPaymentResult.payment.provider_payment_id,
    status: 'SUCCESS',
    amount: 200000,
  });
  const whSignature = crypto.createHmac('sha256', 'mock_webhook_secret_default').update(rawWebhook).digest('hex');

  const wh1 = await request(`${BASE_URL}/webhooks/mock`, {
    method: 'POST',
    headers: { 'x-frame-mock-signature': whSignature },
  }, JSON.parse(rawWebhook));
  assert(wh1.status === 200, 'First webhook accepted');

  const wh2 = await request(`${BASE_URL}/webhooks/mock`, {
    method: 'POST',
    headers: { 'x-frame-mock-signature': whSignature },
  }, JSON.parse(rawWebhook));
  assert(wh2.status === 200, 'Duplicate webhook handled idempotently');
  assert(wh2.data.result?.status === 'deduplicated', 'Webhook replay explicitly flagged as deduplicated');

  // ── SCENARIO 19: Invalid webhook signature → rejected ─────────
  console.log('\n--- SCENARIO 19: INVALID WEBHOOK SIGNATURE → REJECTED ---');
  const badWh = await request(`${BASE_URL}/webhooks/mock`, {
    method: 'POST',
    headers: { 'x-frame-mock-signature': 'invalid_signature_hash' },
  }, JSON.parse(rawWebhook));
  assert(badWh.status === 400, 'Invalid webhook signature rejected with 400 Bad Request');

  // ── SCENARIO 20: Revoke authority while payment is pending ────
  console.log('\n--- SCENARIO 20: REVOKE AUTHORITY WHILE PAYMENT IS PENDING → BLOCKED ---');
  const pendingIntentRes = await request(`${BASE_URL}/payment-intents`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    amount_paise: 350000, // ₹3,500 -> PENDING_APPROVAL
    currency: 'INR',
    merchant: 'trusted_electronics',
    purpose: 'Pending approval revocation test',
    category: 'electronics',
    idempotency_key: `rev_pend_${Date.now()}`,
  });
  const pendingIntentId = pendingIntentRes.data.data.id;
  assert(pendingIntentRes.data.data.status === 'PENDING_APPROVAL', 'Payment intent in PENDING_APPROVAL');

  // Fetch created approval task
  const { rows: appTasks } = await db.query(
    `SELECT id FROM approval_tasks WHERE payment_intent_id = $1`,
    [pendingIntentId]
  );
  const approvalTaskId = appTasks[0].id;

  // Now revoke the authority
  await AuthorityService.revokeAuthority(auth1.id, orgAlphaId, userAlphaId, 'Security breach detected');

  // Now human tries to approve the pending intent
  const approveRevokedRes = await request(`${BASE_URL}/approvals/${approvalTaskId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userAlphaToken}` },
  }, {});
  assert(approveRevokedRes.status === 403, 'Execution blocked after authority revocation');
  assert(approveRevokedRes.data.error.code === 'AUTHORITY_REVOKED', 'Returned AUTHORITY_REVOKED code');

  // Restore authority for scenarios 21 and 22
  await db.query(`UPDATE payment_authorities SET status = 'ACTIVE' WHERE id = $1`, [auth1.id]);

  // ── SCENARIO 21: Provider failure → no ledger debit ───────────
  console.log('\n--- SCENARIO 21: PROVIDER FAILURE → NO LEDGER DEBIT ---');
  const { rows: initialLedger } = await db.query(
    `SELECT COUNT(*) as count FROM ledger_entries WHERE organization_id = $1`,
    [orgAlphaId]
  );
  const initialLedgerCount = parseInt(initialLedger[0].count, 10);

  const failIntentRes = await request(`${BASE_URL}/payment-intents`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    amount_paise: 120000,
    currency: 'INR',
    merchant: 'trusted_electronics',
    purpose: 'Provider failure ledger test',
    category: 'electronics',
    idempotency_key: `fail_test_${Date.now()}`,
    metadata: { mock_outcome: 'failed' },
  });
  const failIntentId = failIntentRes.data.data.id;
  assert(failIntentRes.data.data.status === 'FAILED', 'Payment intent transitioned to FAILED due to provider rejection');

  const { rows: postFailLedger } = await db.query(
    `SELECT COUNT(*) as count FROM ledger_entries WHERE organization_id = $1`,
    [orgAlphaId]
  );
  assert(
    parseInt(postFailLedger[0].count, 10) === initialLedgerCount,
    'Zero ledger entries created for failed payment'
  );

  // ── SCENARIO 22: Successful settlement → exactly one ledger debit
  console.log('\n--- SCENARIO 22: SUCCESSFUL SETTLEMENT → EXACTLY ONE LEDGER DEBIT ---');
  const successIntentRes = await request(`${BASE_URL}/payment-intents`, {
    method: 'POST',
    headers: { 'X-API-Key': key1 },
  }, {
    amount_paise: 249900, // ₹2,499
    currency: 'INR',
    merchant: 'trusted_electronics',
    purpose: 'Clean settlement ledger test',
    category: 'electronics',
    idempotency_key: `success_ledger_${Date.now()}`,
  });
  const successIntentId = successIntentRes.data.data.id;
  assert(successIntentRes.data.data.status === 'SUCCEEDED', 'Payment execution succeeded');

  const { rows: postSuccessLedger } = await db.query(
    `SELECT * FROM ledger_entries WHERE payment_intent_id = $1`,
    [successIntentId]
  );
  assert(postSuccessLedger.length === 1, 'Exactly one ledger entry created');
  assert(postSuccessLedger[0].entry_type === 'DEBIT', 'Ledger entry is a verified DEBIT');
  assert(Number(postSuccessLedger[0].amount_paise) === 249900, 'Ledger entry matches ₹2,499.00 amount');

  console.log('\n================================================================');
  console.log('🎉 ALL 22 PAYMENT AUTHORITY & SECURITY SCENARIOS PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runAuthorityTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
