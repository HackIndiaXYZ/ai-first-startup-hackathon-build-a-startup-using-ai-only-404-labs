import { FrameMcpTools, McpSecurityError } from '../../src/mcp/tools';
import { createFrameMcpServer } from '../../src/mcp/server';

const API_BASE = 'http://localhost:3001/v1';

async function rawRequest(path: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${path}`, {
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

async function runMcpTestSuite() {
  console.log('\n================================================================');
  console.log('🤖 RUNNING FRAME MCP SERVER COMPREHENSIVE TEST SUITE');
  console.log('================================================================\n');

  const testId = Date.now().toString(36);

  // ── SETUP: PROVISION TENANT A & B WITH REAL CREDENTIALS ────────
  console.log('--- 0. SETUP: PROVISION TEST TENANTS & POLICIES ---');

  // Org A
  const regA = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `mcpa_admin_${testId}@mcp.corp`,
    password: 'Password123!',
    name: 'Admin Alpha MCP',
    organization_name: `Alpha MCP Corp ${testId}`,
  });
  assert(regA.status === 201, 'Org Alpha created');
  const tokenA = regA.data.token;

  const agentARes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  }, {
    name: 'MCP Buyer Agent Alpha',
    role: 'Autonomous Procurement',
  });
  assert(agentARes.status === 201, 'Agent Alpha created');
  const agentA = agentARes.data;

  const keyARes = await rawRequest(`/agents/${agentA.id}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  }, {});
  assert(keyARes.status === 201, 'Agent Alpha credentials generated');
  const agentApiKeyA = keyARes.data.api_key;

  // Policy for Agent A: Max ₹5000 (500,000 paise), Approval threshold ₹2500 (250,000 paise), Allowed categories: ['electronics', 'cloud', 'office']
  const policyARes = await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  }, {
    name: 'Alpha Purchasing Policy',
    agent_id: agentA.id,
    max_amount_paise: 500000,
    daily_budget_paise: 2000000,
    approval_threshold_paise: 250000,
    allowed_categories: ['electronics', 'cloud', 'office'],
  });
  assert(policyARes.status === 201, 'Policy Alpha created');

  // Org B
  const regB = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `mcpb_admin_${testId}@mcp.corp`,
    password: 'Password123!',
    name: 'Admin Beta MCP',
    organization_name: `Beta MCP Corp ${testId}`,
  });
  assert(regB.status === 201, 'Org Beta created');
  const tokenB = regB.data.token;

  const agentBRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  }, {
    name: 'MCP Treasury Agent Beta',
    role: 'Beta Treasury',
  });
  assert(agentBRes.status === 201, 'Agent Beta created');
  const agentB = agentBRes.data;

  const keyBRes = await rawRequest(`/agents/${agentB.id}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  }, {});
  assert(keyBRes.status === 201, 'Agent Beta credentials generated');
  const agentApiKeyB = keyBRes.data.api_key;

  // Policy for Agent B
  const policyBRes = await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  }, {
    name: 'Beta Treasury Policy',
    agent_id: agentB.id,
    max_amount_paise: 1000000,
    daily_budget_paise: 5000000,
    approval_threshold_paise: 500000,
    allowed_categories: ['treasury', 'saas'],
  });
  assert(policyBRes.status === 201, 'Policy Beta created');

  // Instantiate Frame MCP Tools
  const mcpTools = new FrameMcpTools({
    apiUrl: API_BASE,
    agentApiKey: agentApiKeyA,
  });

  // ── TEST 1: Authenticated agent creates payment under policy limit ──
  console.log('\n--- TEST 1: AUTHENTICATED PAYMENT UNDER POLICY LIMIT ---');
  const payment1 = await mcpTools.createPaymentIntent({
    amount: 1499.00,
    currency: 'INR',
    merchant: 'Amazon India',
    purpose: 'Wireless Bluetooth Mouse',
    category: 'electronics',
    idempotency_key: `mcp_t1_${testId}`,
  });

  assert(payment1.decision === 'ALLOW', 'Policy Firewall returns ALLOW for amount under limit');
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(payment1.status), `Intent status is valid (${payment1.status})`);
  assert(payment1.amount === 1499, 'Amount returned accurately in rupees');
  assert(payment1.next_action === 'PAYMENT_EXECUTION', 'Next action is PAYMENT_EXECUTION');
  assert(typeof payment1.payment_intent_id === 'string', 'Valid payment_intent_id returned');

  // ── TEST 2: Agent attempts blocked category ─────────────────────────
  console.log('\n--- TEST 2: AGENT ATTEMPTS BLOCKED CATEGORY ---');
  const payment2 = await mcpTools.createPaymentIntent({
    amount: 500.00,
    currency: 'INR',
    merchant: 'Casino Royale',
    purpose: 'Gambling chips',
    category: 'gambling', // Not in ['electronics', 'cloud', 'office']
    idempotency_key: `mcp_t2_${testId}`,
  });

  assert(payment2.decision === 'DENY', 'Policy Firewall returns DENY for blocked category');
  assert(payment2.status === 'DENIED', 'Intent status is DENIED');
  assert(payment2.next_action === 'DO_NOT_RETRY', 'Next action is DO_NOT_RETRY');
  assert(Boolean(payment2.reasons && payment2.reasons.length > 0), 'Denial reason provided');

  // ── TEST 3: Agent exceeds approval threshold ────────────────────────
  console.log('\n--- TEST 3: AGENT EXCEEDS APPROVAL THRESHOLD ---');
  const payment3 = await mcpTools.createPaymentIntent({
    amount: 3200.00, // Exceeds approval threshold of ₹2500 but <= max ₹5000
    currency: 'INR',
    merchant: 'Dell India',
    purpose: 'Ergonomic Monitor',
    category: 'electronics',
    idempotency_key: `mcp_t3_${testId}`,
  });

  assert(payment3.decision === 'REQUIRE_APPROVAL', 'Policy Firewall returns REQUIRE_APPROVAL');
  assert(payment3.status === 'PENDING_APPROVAL', 'Intent status is PENDING_APPROVAL');
  assert(payment3.next_action === 'WAIT_FOR_APPROVAL', 'Next action is WAIT_FOR_APPROVAL');

  // Test frame_request_approval on this intent
  const approvalRes = await mcpTools.requestApproval({
    payment_intent_id: payment3.payment_intent_id,
    notes: 'Urgent replacement for broken workstation display',
  });
  assert(approvalRes.decision === 'REQUIRE_APPROVAL', 'Approval response confirms REQUIRE_APPROVAL');
  assert(approvalRes.status === 'PENDING_APPROVAL', 'Status is PENDING_APPROVAL');
  assert(typeof approvalRes.approval_task_id === 'string', 'Approval task queued');

  // ── TEST 4: Unauthenticated MCP request ─────────────────────────────
  console.log('\n--- TEST 4: UNAUTHENTICATED MCP REQUEST ---');
  const unauthTools = new FrameMcpTools({
    apiUrl: API_BASE,
    agentApiKey: undefined,
  });

  let unauthRejected = false;
  try {
    // Calling without env key or argument key
    delete process.env.FRAME_AGENT_API_KEY;
    await unauthTools.createPaymentIntent({
      amount: 100,
      merchant: 'Test Merchant',
      purpose: 'Test unauthenticated',
      idempotency_key: `mcp_t4_${testId}`,
    });
  } catch (err: any) {
    unauthRejected = true;
    assert(err.code === 'UNAUTHORIZED', `Unauthenticated request rejected with code: ${err.code}`);
  }
  assert(unauthRejected, 'Unauthenticated MCP request was rejected');

  // Also test with invalid API key
  let invalidKeyRejected = false;
  try {
    await unauthTools.createPaymentIntent({
      amount: 100,
      merchant: 'Test Merchant',
      purpose: 'Test invalid key',
      idempotency_key: `mcp_t4b_${testId}`,
      agent_api_key: 'frm_test_invalid_bogus_key_1234567890',
    });
  } catch (err: any) {
    invalidKeyRejected = true;
    assert(err.code === 'INVALID_API_KEY' || err.code === 'UNAUTHORIZED', `Invalid key rejected: ${err.code}`);
  }
  assert(invalidKeyRejected, 'Invalid key rejected');

  // ── TEST 5: Agent from Org A attempts to access Org B payment ───────
  console.log('\n--- TEST 5: TENANT ISOLATION (ORG A CANNOT ACCESS ORG B) ---');
  // Create an intent in Org B
  const mcpToolsB = new FrameMcpTools({
    apiUrl: API_BASE,
    agentApiKey: agentApiKeyB,
  });
  const paymentBeta = await mcpToolsB.createPaymentIntent({
    amount: 1000.00,
    currency: 'INR',
    merchant: 'AWS Cloud Services',
    purpose: 'Production cluster',
    category: 'saas',
    idempotency_key: `mcp_beta_${testId}`,
  });
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(paymentBeta.status), 'Beta intent created in Org Beta');

  // Agent A tries to get status of Beta payment
  let crossAccessRejected = false;
  try {
    await mcpTools.getPaymentStatus({
      payment_intent_id: paymentBeta.payment_intent_id,
      agent_api_key: agentApiKeyA,
    });
  } catch (err: any) {
    crossAccessRejected = true;
    assert(err.code === 'NOT_FOUND' || err.code === 'HTTP_404', 'Cross-tenant status access blocked with 404');
  }
  assert(crossAccessRejected, 'Agent Alpha cross-tenant access blocked');

  // Agent A tries to get full intent details of Beta payment
  let crossIntentRejected = false;
  try {
    await mcpTools.getPaymentIntent({
      payment_intent_id: paymentBeta.payment_intent_id,
      agent_api_key: agentApiKeyA,
    });
  } catch (err: any) {
    crossIntentRejected = true;
    assert(err.code === 'NOT_FOUND' || err.code === 'HTTP_404', 'Cross-tenant intent fetch blocked with 404');
  }
  assert(crossIntentRejected, 'Agent Alpha cannot fetch Org Beta payment intent');

  // ── TEST 6: Duplicate payment request with same idempotency key ─────
  console.log('\n--- TEST 6: IDEMPOTENCY DEDUPLICATION ---');
  const idempKey = `idemp_mcp_${testId}`;
  const firstCall = await mcpTools.createPaymentIntent({
    amount: 850.00,
    currency: 'INR',
    merchant: 'Cloudflare',
    purpose: 'DNS Pro Plan',
    category: 'cloud',
    idempotency_key: idempKey,
  });
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(firstCall.status), 'First idempotent call creates intent');

  const secondCall = await mcpTools.createPaymentIntent({
    amount: 850.00,
    currency: 'INR',
    merchant: 'Cloudflare',
    purpose: 'DNS Pro Plan',
    category: 'cloud',
    idempotency_key: idempKey,
  });

  assert(secondCall.payment_intent_id === firstCall.payment_intent_id, 'Second call returns EXACT same payment_intent_id');
  assert(secondCall.status === firstCall.status, 'Second call returns matching status');

  // ── TEST 7: Agent attempts to submit sensitive credentials (UPI PIN) ─
  console.log('\n--- TEST 7: REJECT SENSITIVE CREDENTIALS (UPI PIN / CVV / PASSWORD) ---');
  let upiPinRejected = false;
  try {
    await mcpTools.createPaymentIntent({
      amount: 500,
      merchant: 'Swiggy',
      purpose: 'Dinner order',
      idempotency_key: `mcp_t7_${testId}`,
      upi_pin: '123456', // Prohibited!
    } as any);
  } catch (err: any) {
    upiPinRejected = true;
    assert(err instanceof McpSecurityError, 'Error is McpSecurityError');
    assert(err.code === 'SENSITIVE_CREDENTIAL_REJECTED', 'Error code is SENSITIVE_CREDENTIAL_REJECTED');
  }
  assert(upiPinRejected, 'UPI PIN submission rejected before reaching backend');

  let nestedCvvRejected = false;
  try {
    await mcpTools.createPaymentIntent({
      amount: 500,
      merchant: 'Swiggy',
      purpose: 'Dinner order',
      idempotency_key: `mcp_t7b_${testId}`,
      metadata: {
        card_details: {
          cvv: '999',
        },
      },
    } as any);
  } catch (err: any) {
    nestedCvvRejected = true;
    assert(err.code === 'SENSITIVE_CREDENTIAL_REJECTED', 'Nested CVV credential rejected');
  }
  assert(nestedCvvRejected, 'Nested CVV in metadata rejected');

  // ── TEST 8: Payment status retrieval after payment execution ────────
  console.log('\n--- TEST 8: PAYMENT STATUS RETRIEVAL ---');
  const statusRes = await mcpTools.getPaymentStatus({
    payment_intent_id: payment1.payment_intent_id,
  });
  assert(statusRes.payment_intent_id === payment1.payment_intent_id, 'Status returned for correct intent');
  assert(statusRes.decision === 'ALLOW', 'Decision is ALLOW');
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(statusRes.status), `Payment status is valid: ${statusRes.status}`);

  const safeIntent = await mcpTools.getPaymentIntent({
    payment_intent_id: payment1.payment_intent_id,
  });
  assert(safeIntent.id === payment1.payment_intent_id, 'Safe intent id matches');
  assert(safeIntent.merchant === 'Amazon India', 'Merchant matches');
  assert(safeIntent.amount === 1499, 'Amount matches');
  assert((safeIntent as any).provider_secret === undefined, 'No provider secret in safe intent');

  console.log('\n================================================================');
  console.log('✅ ALL 8 FRAME MCP SERVER TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');
}

runMcpTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ MCP TEST SUITE FAILED:', err);
    process.exit(1);
  });
