// TypeScript SDK Integration Test
// Verifies: SDK -> Frame API -> Payment Intent -> Policy -> Provider -> Status
import { FrameClient, FramePaymentError } from '../../../../sdk/typescript/src/index';
import { db } from '../../../src/db';
import { ulid } from 'ulid';
import * as bcrypt from 'bcryptjs';

const BASE_URL = 'http://localhost:3001';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runTsSdkIntegrationTest() {
  console.log('================================================================');
  console.log('🧪 FRAME TYPESCRIPT SDK INTEGRATION TEST');
  console.log('================================================================\n');

  // Verify backend is up
  const healthRes = await fetch(`${BASE_URL}/health`);
  assert(healthRes.ok, 'Backend server is running on port 3001');

  // 1. Seed Org, Agent, and Authority
  const orgId = ulid();
  await db.query(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES ($1, 'TS SDK Test Corp', $2, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `, [orgId, `ts-sdk-${orgId.toLowerCase()}`]);

  const userId = ulid();
  await db.query(`
    INSERT INTO users (id, organization_id, email, password_hash, name, role, created_at, updated_at)
    VALUES ($1, $2, $3, '$2a$10$abcdefghijklmnopqrstuu', 'TS SDK Admin', 'admin', NOW(), NOW())
  `, [userId, orgId, `user_${userId.toLowerCase()}@test.corp`]);

  const rawApiKey = `frm_test_ts_${ulid().toLowerCase()}`;
  const keyHash = await bcrypt.hash(rawApiKey, 10);
  const keyPrefix = rawApiKey.substring(0, 12);
  const agentId = ulid();

  await db.query(`
    INSERT INTO agents (id, organization_id, name, description, frame_env, status, created_at, updated_at)
    VALUES ($1, $2, 'TS SDK Procurement Agent', 'Autonomous Bot using TS SDK', 'sandbox', 'active', NOW(), NOW())
  `, [agentId, orgId]);

  const credId = ulid();
  await db.query(`
    INSERT INTO agent_credentials (id, agent_id, organization_id, key_prefix, key_hash, status, created_at)
    VALUES ($1, $2, $3, $4, $5, 'active', NOW())
  `, [credId, agentId, orgId, keyPrefix, keyHash]);

  // Create Policy and Policy Version for Agent
  const policyId = ulid();
  const versionId = ulid();
  await db.query(
    `INSERT INTO policies (id, organization_id, agent_id, name, current_version_id) VALUES ($1, $2, $3, 'TS SDK Policy', $4)`,
    [policyId, orgId, agentId, versionId]
  );
  await db.query(
    `INSERT INTO policy_versions (id, policy_id, version_number, transaction_limit_paise, daily_limit_paise, monthly_limit_paise, approval_threshold_paise)
     VALUES ($1, $2, 1, 500000, 2000000, 5000000, 300000)`,
    [versionId, policyId]
  );

  // Insert an active Payment Authority with limit ₹5,000 (500000 paise)
  const authorityId = ulid();
  await db.query(`
    INSERT INTO payment_authorities (
      id, organization_id, user_id, agent_id, purpose, max_transaction_amount_paise,
      daily_limit_paise, monthly_limit_paise, allowed_categories, allowed_merchants,
      status, valid_from, valid_until, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, 'Autonomous Office Supplies Authority', 500000, 2000000, 5000000,
      $5, $6, 'ACTIVE', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())
  `, [authorityId, orgId, userId, agentId, ['electronics', 'office_supplies'], ['tech-gear', 'demo-merchant']]);

  console.log('--- 1. Initialize FrameClient with Agent API Key ---');
  const client = new FrameClient({
    apiKey: rawApiKey,
    baseUrl: BASE_URL,
  });
  assert(client instanceof FrameClient, 'FrameClient instantiated');

  console.log('\n--- 2. Inspect Authorities via SDK ---');
  const authList = await client.listAuthorities();
  assert(authList && authList.data && authList.data.length >= 1, 'Agent authorities listed successfully');
  const foundAuth = authList.data.find((a: any) => a.id === authorityId);
  assert(!!foundAuth, `Authority ${authorityId} found in agent scoped list`);

  const authDetails = await client.getAuthority(authorityId);
  assert(authDetails && authDetails.data && authDetails.data.id === authorityId, 'Authority details retrieved');
  assert(authDetails.data.status === 'ACTIVE', 'Authority is ACTIVE');

  console.log('\n--- 3. Create Valid Payment Intent via SDK (₹2,499) ---');
  const paymentDecision = await client.pay({
    amount: 2499, // ₹2,499
    currency: 'INR',
    merchant: 'tech-gear',
    purpose: 'Mechanical keyboard under ₹3,000 threshold',
    category: 'electronics',
    merchantReference: `ORD_TS_${Date.now()}`,
  });

  assert(!!paymentDecision.id, `Payment Intent created: ${paymentDecision.id}`);
  assert(Number(paymentDecision.amountPaise) === 249900, 'Amount correctly converted to paise (249900)');
  assert(paymentDecision.merchant === 'tech-gear', 'Merchant verified');
  assert(paymentDecision.requiresApproval === false, 'Within authority limit, does not require approval');

  console.log('\n--- 4. Verify Payment Status & Lifecycle via SDK ---');
  const fetchedIntent = await client.getIntent(paymentDecision.id);
  assert(fetchedIntent.id === paymentDecision.id, 'Fetched intent ID matches');
  assert(fetchedIntent.status === 'SUCCEEDED' || fetchedIntent.status === 'AUTHORIZED' || fetchedIntent.status === 'EXECUTING',
    `Intent state is valid: ${fetchedIntent.status}`);

  console.log('\n--- 5. Verify Policy Firewall Guardrails (Exceeding Limit) ---');
  // Limit is 5000, try paying 15000 (₹15,000)
  const excessiveDecision = await client.pay({
    amount: 15000,
    merchant: 'tech-gear',
    purpose: 'Bulk server rack purchase',
    category: 'electronics',
  });
  assert(
    excessiveDecision.status === 'PENDING_APPROVAL' || excessiveDecision.status === 'DENIED',
    `Excessive amount rejected or routed to approval: status=${excessiveDecision.status}`
  );

  console.log('\n--- 6. Verify Error Handling on Invalid Credentials ---');
  const invalidClient = new FrameClient({
    apiKey: 'frm_agent_invalid_secret_key_xyz',
    baseUrl: BASE_URL,
  });

  let threwAuthError = false;
  try {
    await invalidClient.listAuthorities();
  } catch (err: any) {
    threwAuthError = true;
    assert(err instanceof FramePaymentError, 'Error instance of FramePaymentError');
    assert(err.status === 401 || err.code === 'AUTHENTICATION_FAILED' || err.code === 'UNAUTHORIZED',
      `Correct authentication error code: ${err.code} (HTTP ${err.status})`);
  }
  assert(threwAuthError, 'Invalid API key correctly rejected with exception');

  console.log('\n================================================================');
  console.log('✅ FRAME TYPESCRIPT SDK INTEGRATION TEST PASSED');
  console.log('================================================================\n');
}

runTsSdkIntegrationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ TypeScript SDK Test failed:', err);
    process.exit(1);
  });
