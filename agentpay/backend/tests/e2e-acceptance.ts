// Frame Autonomous Agent Payment Infrastructure — Master E2E Acceptance Test Suite
// Validates all 7 required core flows against the live server and database.

import http from 'http';
import * as crypto from 'crypto';

interface ApiResponse<T = any> {
  status: number;
  data?: T;
  error?: { code: string; message: string };
  meta?: Record<string, unknown>;
  [key: string]: any;
}

async function request<T = any>(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
  data: unknown = null
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = data ? JSON.stringify(data) : null;
    const headers = {
      ...(options.headers || {}),
      ...(postData ? { 'Content-Length': Buffer.byteLength(postData).toString() } : {}),
    };

    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ ...parsed, status: res.statusCode || 200, httpStatus: res.statusCode || 200 });
          } catch {
            resolve({ status: res.statusCode || 200, httpStatus: res.statusCode || 200, data: body as any });
          }
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runMasterAcceptance(): Promise<void> {
  console.log('================================================================');
  console.log('🧪 RUNNING MASTER PAYMENT INFRASTRUCTURE ACCEPTANCE TEST SUITE');
  console.log('================================================================\n');

  const BASE = 'http://localhost:3001/v1';

  // ── Setup: Register User & Org ──────────────────────────────
  const testId = Date.now();
  const reg = await request(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    name: 'Architect Tester',
    email: `arch_${testId}@frame.dev`,
    password: 'Password123!',
    organization_name: 'Autonomous Systems Ltd',
  });
  assert(reg.status === 201, 'User and Organization registered successfully');
  const userToken = reg.data.token;
  const userHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`,
  };

  // ── Setup: Create Agent ─────────────────────────────────────
  const agentRes = await request(`${BASE}/agents`, {
    method: 'POST',
    headers: userHeaders,
  }, {
    name: 'Infra Procurement Agent',
    description: 'Autonomous buyer for cloud infra',
    owner_team: 'DevOps',
    purpose: 'Procures cloud services and APIs under policy',
  });
  assert(agentRes.status === 201, 'Agent created');
  const agent = agentRes.data;

  // ── Setup: Issue Agent API Key ──────────────────────────────
  const keyRes = await request(`${BASE}/agents/${agent.id}/credentials`, {
    method: 'POST',
    headers: userHeaders,
  }, {});
  assert(keyRes.status === 201, 'Agent API key issued');
  const agentApiKey = keyRes.data.api_key;
  const agentHeaders = {
    'Content-Type': 'application/json',
    'X-API-Key': agentApiKey,
  };

  // ── Setup: Configure Policy Guardrails ───────────────────────
  const policyRes = await request(`${BASE}/policies`, {
    method: 'POST',
    headers: userHeaders,
  }, {
    name: 'Standard Cloud Policy',
    agent_id: agent.id,
    transaction_limit_paise: 500000,    // ₹5,000 max per tx
    daily_limit_paise: 2000000,         // ₹20,000 daily
    monthly_limit_paise: 10000000,      // ₹100,000 monthly
    approval_threshold_paise: 150000,   // ₹1,500 requires human approval
    allowed_categories: ['cloud', 'saas', 'compute'],
    blocked_categories: ['gambling', 'entertainment'],
  });
  assert(policyRes.status === 201, 'Policy attached to agent with guardrails');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 1: AUTOMATIC PAYMENT
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 1: AUTOMATIC PAYMENT (Under Threshold) ---');
  const autoPayRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 49900, // ₹499
    currency: 'INR',
    merchant: 'DigitalOcean',
    purpose: 'Worker droplet upgrade',
    category: 'cloud',
    idempotency_key: `auto_pay_${testId}`,
  });
  assert(autoPayRes.status === 201, 'Automatic payment intent accepted');
  assert(autoPayRes.data.firewall.decision === 'ALLOW', 'Policy firewall evaluated ALLOW');
  assert(autoPayRes.data.status === 'SUCCEEDED', 'PaymentOrchestrator transitioned intent to SUCCEEDED');

  // Verify Ledger Debit
  const ledgerRes1 = await request(`${BASE}/ledger`, { headers: userHeaders });
  assert(ledgerRes1.data.length >= 1, 'Ledger entry created for succeeded payment');
  assert(ledgerRes1.data[0].entry_type === 'DEBIT', 'Ledger entry is DEBIT');
  assert(parseInt(ledgerRes1.data[0].amount_paise, 10) === 49900, 'Ledger amount matches exact paise');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 2: BLOCKED PAYMENT
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 2: BLOCKED PAYMENT (Disallowed Category) ---');
  const blockedRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 10000, // ₹100
    currency: 'INR',
    merchant: 'Casino Online',
    purpose: 'Credits',
    category: 'gambling', // Blocked
    idempotency_key: `blocked_${testId}`,
  });
  assert(blockedRes.status === 201, 'Payment intent received');
  assert(blockedRes.data.firewall.decision === 'DENY', 'Firewall evaluated DENY');
  assert(blockedRes.data.status === 'DENIED', 'Intent status is DENIED');

  // Verify NO additional ledger entry
  const ledgerRes2 = await request(`${BASE}/ledger`, { headers: userHeaders });
  assert(ledgerRes2.data.length === ledgerRes1.data.length, 'NO ledger debit recorded for denied payment');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 3: HUMAN APPROVAL WORKFLOW
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 3: HUMAN APPROVAL (Over Threshold) ---');
  const approvalIntentRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 250000, // ₹2,500 (> ₹1,500 threshold)
    currency: 'INR',
    merchant: 'AWS Cloud Services',
    purpose: 'GPU Cluster Reservation',
    category: 'compute',
    idempotency_key: `approval_intent_${testId}`,
  });
  assert(approvalIntentRes.status === 201, 'Intent over threshold created');
  assert(approvalIntentRes.data.firewall.decision === 'REQUIRE_APPROVAL', 'Firewall evaluated REQUIRE_APPROVAL');
  assert(approvalIntentRes.data.status === 'PENDING_APPROVAL', 'Intent is in PENDING_APPROVAL state');
  const pendingIntentId = approvalIntentRes.data.id;

  // Admin checks pending approvals
  const pendingList = await request(`${BASE}/approvals?status=pending`, { headers: userHeaders });
  const approvalTask = pendingList.data.find((a: any) => a.payment_intent_id === pendingIntentId);
  assert(!!approvalTask, 'Approval task queued in admin review center');

  // Admin approves
  const approveAction = await request(`${BASE}/approvals/${approvalTask.id}/approve`, {
    method: 'POST',
    headers: userHeaders,
  }, {
    comment: 'Approved for production machine learning workload',
  });
  assert(approveAction.status === 200, 'Admin approved payment');

  // Verify Intent executed to SUCCEEDED after approval
  const verifiedIntent = await request(`${BASE}/payment-intents/${pendingIntentId}`, { headers: userHeaders });
  assert(verifiedIntent.data.status === 'SUCCEEDED', 'Approved payment executed to SUCCEEDED');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 4: UNKNOWN PAYMENT & RECONCILIATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 4: UNKNOWN PAYMENT & RECONCILIATION ---');
  // Trigger timeout/unknown simulation via metadata
  const unknownRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 80000, // ₹800
    currency: 'INR',
    merchant: 'HuggingFace',
    purpose: 'API Tokens',
    category: 'cloud',
    idempotency_key: `unknown_sim_${testId}`,
    metadata: { mock_outcome: 'unknown' }, // ⚠️ Simulates network failure / timeout
  });
  assert(unknownRes.status === 201, 'Payment intent created');
  assert(unknownRes.data.status === 'EXECUTING', 'Payment intent remains in EXECUTING (NOT FAILED)');

  // Verify payment status is strictly 'unknown' in database
  const paymentsList = await request(`${BASE}/payments?status=unknown`, { headers: userHeaders });
  const unknownPayment = paymentsList.data.find((p: any) => p.payment_intent_id === unknownRes.data.id);
  assert(!!unknownPayment, 'Payment correctly flagged as UNKNOWN status in database');
  assert(unknownPayment.status === 'unknown', 'Status is strictly "unknown" (never converted to failed)');

  // Run Reconciliation to query ground truth and resolve
  console.log('  Triggering Reconciliation Service...');
  const reconRes = await request(`${BASE}/reconciliation/run`, {
    method: 'POST',
    headers: userHeaders,
  }, {});
  assert(reconRes.status === 200, 'Reconciliation run completed');
  assert(reconRes.data.resolvedCount >= 1, 'Reconciliation successfully resolved UNKNOWN payment');

  // Verify resolved payment is now succeeded
  const reconciledPayment = await request(`${BASE}/payments/${unknownPayment.id}`, { headers: userHeaders });
  assert(reconciledPayment.data.status === 'succeeded', 'Unknown payment safely resolved to succeeded via reconciliation');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 5: CONCURRENT DUPLICATE IDEMPOTENCY
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 5: CONCURRENT DUPLICATE REQUEST PROTECTION ---');
  const duplicateKey = `idem_concurrent_${testId}`;
  const payload = {
    amount_paise: 50000,
    currency: 'INR',
    merchant: 'Cloudflare Inc',
    purpose: 'Domain registration',
    category: 'saas',
    idempotency_key: duplicateKey,
  };

  // Launch two concurrent requests simultaneously with identical key
  const [reqA, reqB] = await Promise.all([
    request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, payload),
    request(`${BASE}/payment-intents`, { method: 'POST', headers: agentHeaders }, payload),
  ]);

  assert(reqA.status === 201 || reqA.status === 200, 'Request A completed');
  assert(reqB.status === 201 || reqB.status === 200, 'Request B completed');
  assert(reqA.data.id === reqB.data.id, 'Both requests returned the EXACT SAME payment intent ID');

  // Verify only ONE payment was created in database
  const paymentsForIdem = await request(`${BASE}/payments`, { headers: userHeaders });
  const matchingPayments = paymentsForIdem.data.filter((p: any) => p.payment_intent_id === reqA.data.id);
  assert(matchingPayments.length === 1, 'Exactly ONE payment executed despite concurrent duplicate requests');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 6: WEBHOOK SIGNATURE, EVENT STORAGE & DEDUPLICATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 6: WEBHOOK INGESTION & DEDUPLICATION ---');
  const webhookEventId = `wh_evt_${testId}`;
  const webhookPayload = {
    event_id: webhookEventId,
    event_type: 'payment.settled',
    provider_payment_id: `mock_provider_${testId}`,
    status: 'SUCCESS',
    amount: 50000,
    currency: 'INR',
  };
  const rawPayloadStr = JSON.stringify(webhookPayload);
  const secret = 'mock_webhook_secret_default';
  const signature = crypto.createHmac('sha256', secret).update(rawPayloadStr).digest('hex');

  // Send webhook
  const whRes1 = await request(`${BASE}/webhooks/mock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frame-Mock-Signature': signature,
    },
  }, webhookPayload);
  assert(whRes1.status === 200, 'Webhook accepted and signature verified');

  // Send DUPLICATE webhook with same event_id
  const whRes2 = await request(`${BASE}/webhooks/mock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frame-Mock-Signature': signature,
    },
  }, webhookPayload);
  assert(whRes2.status === 200, 'Duplicate webhook handled gracefully');
  assert((whRes2 as any).result?.status === 'deduplicated', 'Duplicate webhook correctly recognized as deduplicated');

  // Send webhook with INVALID signature
  const badWhRes = await request(`${BASE}/webhooks/mock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frame-Mock-Signature': 'invalid_signature_hash',
    },
  }, webhookPayload);
  assert(badWhRes.status === 400, 'Webhook with invalid signature rejected');

  // ─────────────────────────────────────────────────────────────
  // CRITERION 7: REVOKED AGENT IS BLOCKED
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SCENARIO 7: REVOKED AGENT PROTECTION ---');
  // Disable / Revoke agent
  const disableRes = await request(`${BASE}/agents/${agent.id}/disable`, {
    method: 'POST',
    headers: userHeaders,
  }, {
    reason: 'Compromised credentials rotation test',
  });
  assert(disableRes.status === 200, 'Agent status set to disabled');

  // Attempt payment with revoked agent credentials
  const revokedPaymentRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentHeaders,
  }, {
    amount_paise: 20000,
    currency: 'INR',
    merchant: 'GitHub Inc',
    purpose: 'Copilot enterprise seats',
    category: 'saas',
    idempotency_key: `revoked_${testId}`,
  });
  assert(revokedPaymentRes.status === 403, 'Revoked agent request blocked with HTTP 403');
  assert(revokedPaymentRes.error?.code === 'AGENT_DISABLED', 'Error code is AGENT_DISABLED');

  console.log('\n================================================================');
  console.log('🎉 ALL 7 CRITICAL ACCEPTANCE SCENARIOS PASSED WITH ZERO ERRORS!');
  console.log('================================================================\n');
}

runMasterAcceptance().catch((err) => {
  console.error('\n❌ Master Acceptance Suite Failed:', err);
  process.exit(1);
});
