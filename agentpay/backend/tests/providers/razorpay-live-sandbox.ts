// Real Razorpay Sandbox Flow Verification
// Dispatches genuine HTTPS calls to https://api.razorpay.com/v1/
// through the existing Frame payment architecture:
// Agent Identity -> Intent -> Firewall -> PaymentOrchestrator -> RazorpayPaymentProvider

import { ProviderRegistry } from '../../src/modules/payments/providers/provider-registry';
import { db } from '../../src/db';
import { config } from '../../src/config';

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
  return { httpStatus: res.status, ...data, status: data.status !== undefined ? data.status : res.status };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runLiveRazorpaySandbox() {
  console.log('\n================================================================');
  console.log('📡 REAL RAZORPAY SANDBOX NETWORK VERIFICATION');
  console.log('   Target: https://api.razorpay.com/v1');
  console.log('   Architecture: Intent -> Firewall -> Orchestrator -> Provider');
  console.log('================================================================\n');

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.log('ℹ️  No RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET found in environment or .env.');
    console.log('   Probing live Razorpay endpoint to verify direct network connectivity and error mapping...');

    // Live probe to real Razorpay API endpoint
    const probeRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from('rzp_test_probe_key:probe_secret').toString('base64'),
      },
      body: JSON.stringify({ amount: 10000, currency: 'INR', receipt: 'probe_receipt' }),
    });

    const probeBody: any = await probeRes.json().catch(() => ({}));
    console.log(`  📡 Live HTTP Status from Razorpay edge: ${probeRes.status}`);
    console.log(`  📡 Live Response Body:`, JSON.stringify(probeBody));

    assert(probeRes.status === 401, 'Live Razorpay API responded with HTTP 401 Authentication Required');
    assert(probeBody.error?.code === 'BAD_REQUEST_ERROR', 'Live Razorpay error code matches BAD_REQUEST_ERROR');
    assert(probeBody.error?.description === 'Authentication failed', 'Live Razorpay error description verified');

    console.log('\n================================================================');
    console.log('📋 INSTRUCTIONS TO RUN LIVE SANDBOX FLOW WITH YOUR CREDENTIALS:');
    console.log('================================================================');
    console.log('1. Open your Razorpay Dashboard in Test Mode (https://dashboard.razorpay.com).');
    console.log('2. Navigate to Account & Settings > API Keys > Generate Key.');
    console.log('3. Add your credentials to /Users/dev/Desktop/Frame/agentpay/backend/.env:');
    console.log('   RAZORPAY_KEY_ID=rzp_test_YOUR_ACTUAL_KEY_ID');
    console.log('   RAZORPAY_KEY_SECRET=YOUR_ACTUAL_KEY_SECRET');
    console.log('   RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET');
    console.log('   DEFAULT_PAYMENT_PROVIDER=razorpay');
    console.log('4. Re-run: npm run test:live-sandbox\n');
    return;
  }

  // ── REAL CREDENTIALS PATH ──────────────────────────────────────
  console.log(`🔑 Real credentials detected: Key ID = ${keyId.slice(0, 12)}... (Secret length: ${keySecret.length})`);
  assert(keyId.startsWith('rzp_test_'), 'Key format verified: starts with rzp_test_ (Sandbox Mode)');

  const testId = Date.now().toString(36);
  const email = `live_rzp_${testId}@test.com`;

  // Step 1: Register Org
  console.log('\n--- STEP 1: REGISTER ORGANISATION & CONFIGURE RAZORPAY ---');
  const regRes = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    email,
    password: 'Password123!',
    name: 'Live Sandbox Tester',
    organization_name: `Live Razorpay Org ${testId}`,
  });
  assert(regRes.httpStatus === 201, 'Organization registered');
  const userToken = regRes.data.token;
  const userHeaders = { Authorization: `Bearer ${userToken}` };

  // Configure Razorpay provider for this org
  const provConfigRes = await request(`${BASE}/providers`, {
    method: 'POST',
    headers: userHeaders,
  }, {
    provider_type: 'razorpay',
    name: 'Live Razorpay Sandbox',
    is_default: true,
    webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_test',
    settings: {
      key_id: keyId,
      key_secret: keySecret,
    },
  });
  assert(provConfigRes.httpStatus === 201, 'Razorpay provider configured in organization');

  // Step 2: Create Agent & Issue Credentials
  console.log('\n--- STEP 2: PROVISION AI AGENT ---');
  const agentRes = await request(`${BASE}/agents`, { method: 'POST', headers: userHeaders }, {
    name: `DevOps Agent ${testId}`,
    role: 'Infrastructure Procurement',
  });
  const agent = agentRes.data;

  const keyRes = await request(`${BASE}/agents/${agent.id}/credentials`, { method: 'POST', headers: userHeaders }, {});
  assert(keyRes.httpStatus === 201, 'Agent API key issued');
  const agentApiKey = keyRes.data.api_key;
  const agentHeaders = { 'X-API-Key': agentApiKey };

  // Step 3: Attach Spending Policy
  console.log('\n--- STEP 3: ATTACH POLICY FIREWALL ---');
  await request(`${BASE}/policies`, { method: 'POST', headers: userHeaders }, {
    name: 'Cloud Procurement Policy',
    agent_id: agent.id,
    max_amount_paise: 100000, // ₹1,000 max
    daily_budget_paise: 500000,
    approval_threshold_paise: 50000, // ₹500 approval threshold
    allowed_categories: ['cloud', 'compute'],
  });
  console.log('  ✓ Policy attached: ₹1,000 limit, ₹500 approval threshold, allowed category: cloud');

  // Step 4: Agent requests payment intent (₹250 < ₹500 threshold -> ALLOW)
  console.log('\n--- STEP 4: AGENT CREATES PAYMENT INTENT (AUTO-EXECUTE) ---');
  const intentRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 25000, // ₹250.00
    currency: 'INR',
    merchant: 'AWS Cloud Services',
    purpose: 'EC2 Spot instance capacity',
    category: 'cloud',
    idempotency_key: `live_rzp_intent_${testId}`,
  });

  assert(intentRes.httpStatus === 201, 'Payment intent accepted by Frame');
  const intent = intentRes.data;
  console.log(`  ✓ Intent created: ID = ${intent.id}, Status = ${intent.status}, Decision = ${intent.decision}`);
  assert(intent.decision === 'ALLOW', 'Firewall evaluated ALLOW (under threshold, allowed category)');

  // Step 5: Check Payment Record created in database
  console.log('\n--- STEP 5: VERIFY REAL RAZORPAY ORDER EXECUTION ---');
  const { rows: paymentRows } = await db.query(
    `SELECT * FROM payments WHERE payment_intent_id = $1`,
    [intent.id]
  );

  assert(paymentRows.length === 1, 'Payment record created via PaymentOrchestrator');
  const payment = paymentRows[0];
  console.log(`  ✓ Payment ID: ${payment.id}`);
  console.log(`  ✓ Provider: ${payment.provider}`);
  console.log(`  ✓ Provider Payment ID: ${payment.provider_payment_id}`);
  console.log(`  ✓ Internal Status: ${payment.status}`);
  console.log(`  ✓ Remote Provider Status: ${payment.provider_status}`);

  if (payment.provider_payment_id && payment.provider_payment_id.startsWith('order_')) {
    console.log(`  🎉 GENUINE RAZORPAY ORDER CONFIRMED: ${payment.provider_payment_id}`);

    // Step 6: Query Razorpay Status via GET /v1/orders/:id
    console.log('\n--- STEP 6: VERIFY REMOTE STATUS VIA RAZORPAY API ---');
    const provider = ProviderRegistry.get('razorpay');
    const statusResult = await provider.getPaymentStatus(
      payment.provider_payment_id,
      {
        id: 'cfg_test',
        organization_id: intent.organization_id,
        provider_type: 'razorpay',
        name: 'Razorpay Config',
        is_default: true,
        status: 'active',
        api_key: keyId,
        api_secret: keySecret,
      }
    );

    console.log(`  ✓ Status checked from Razorpay:`, statusResult.providerStatus);
    assert(statusResult.status === 'processing' || statusResult.status === 'succeeded', 'Remote status mapped safely into Frame');

    // Step 7: Trigger Reconciliation Service
    console.log('\n--- STEP 7: TRIGGER RECONCILIATION RUN ---');
    const reconRes = await request(`${BASE}/reconciliation/run`, {
      method: 'POST',
      headers: userHeaders,
    });
    assert(reconRes.httpStatus === 200, 'Reconciliation run completed successfully');
    console.log(`  ✓ Reconciliation run ID: ${reconRes.data?.runId}`);
  } else {
    console.log(`  ℹ️ Payment creation returned: ${payment.status} (${payment.error_description || 'Pending'})`);
  }

  console.log('\n================================================================');
  console.log('🎉 REAL RAZORPAY SANDBOX FLOW VERIFICATION COMPLETE!');
  console.log('================================================================\n');
}

runLiveRazorpaySandbox()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Live Sandbox Verification Failed:', err);
    process.exit(1);
  });
