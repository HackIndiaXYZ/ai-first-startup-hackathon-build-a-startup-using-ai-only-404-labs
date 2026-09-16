import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'path';

const API_BASE = 'http://localhost:3001/v1';

async function rawRequest(pathUrl: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${pathUrl}`, {
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

function getContentText(res: any): string {
  if (!res || !res.content || !res.content[0]) return '';
  return res.content[0].text || '';
}

async function runExternalMcpClientTest() {
  console.log('\n================================================================');
  console.log('🌐 RUNNING EXTERNAL MCP CLIENT TEST (STDIO TRANSPORT)');
  console.log('   Simulating Real External AI Agent (e.g. Claude Desktop / Cursor)');
  console.log('================================================================\n');

  const testId = Date.now().toString(36);

  // ── 1. PROVISION USER, ORG, AGENT & PAYMENT AUTHORITY VIA API ──
  console.log('--- 1. PROVISIONING AGENT & PAYMENT AUTHORITY ---');
  const reg = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `ext_agent_${testId}@external.corp`,
    password: 'Password123!',
    name: 'Principal User',
    organization_name: `External Agent Corp ${testId}`,
  });
  assert(reg.status === 201, 'User registered & Organization created');
  const token = reg.data.token;
  const orgId = reg.data.user.organization_id;
  const userId = reg.data.user.id;

  // Create Agent Entity
  const agentRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    name: 'Claude Desktop Procurement Agent',
    description: 'Autonomous hardware procurement agent',
    purpose: 'Procure developer hardware peripherals',
  });
  assert(agentRes.status === 201, 'Agent identity provisioned');
  const agent = agentRes.data;

  // Issue API Key
  const keyRes = await rawRequest(`/agents/${agent.id}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {});
  assert(keyRes.status === 201, 'Agent API key issued');
  const agentApiKey = keyRes.data.api_key;
  assert(agentApiKey.startsWith('frm_test_'), 'Agent API key follows frm_test_* convention');

  // Create Policy Baseline
  const policyRes = await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    name: 'Hardware Procurement Policy',
    agent_id: agent.id,
    max_amount_paise: 500000, // ₹5,000
    daily_budget_paise: 2000000, // ₹20,000
    approval_threshold_paise: 350000, // ₹3,500
    allowed_categories: ['electronics', 'peripherals'],
  });
  assert(policyRes.status === 201, 'Baseline spend policy active');

  // Create Delegated Payment Authority
  const authorityRes = await rawRequest('/payment-authorities', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    agent_id: agent.id,
    currency: 'INR',
    max_transaction_amount_paise: 500000, // ₹5,000
    daily_limit_paise: 2000000, // ₹20,000
    monthly_limit_paise: 5000000, // ₹50,000
    valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    allowed_categories: ['electronics', 'peripherals'],
    requires_approval_above_paise: 350000, // ₹3,500
    purpose: 'Delegated purchasing authority for developer peripherals',
  });
  assert(authorityRes.status === 201, 'Delegated Payment Authority granted to agent');
  const authority = authorityRes.data;

  // ── 2. SPAWN FRAME MCP SERVER OVER STDIO ───────────────────────
  console.log('\n--- 2. CONNECTING MCP CLIENT OVER STDIO ---');
  const backendRoot = path.resolve(__dirname, '../../');
  const mcpEntry = path.join(backendRoot, 'src/mcp/index.ts');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['ts-node', '-r', 'tsconfig-paths/register', mcpEntry],
    env: {
      ...process.env,
      FRAME_API_URL: API_BASE,
      FRAME_AGENT_API_KEY: agentApiKey,
    },
  });

  const client = new Client(
    {
      name: 'external-agent-client-e2e',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  assert(true, 'MCP Client connected to Frame MCP server via stdio transport');

  // ── 3. DISCOVER TOOLS VIA MCP PROTOCOL ────────────────────────
  console.log('\n--- 3. DISCOVERING TOOLS (tools/list) ---');
  const toolsList = await client.listTools();
  const toolNames = toolsList.tools.map((t) => t.name);
  console.log(`  Discovered ${toolNames.length} tools: ${toolNames.join(', ')}`);

  assert(toolNames.includes('frame_create_payment_intent'), 'frame_create_payment_intent discovered');
  assert(toolNames.includes('frame_get_payment_status'), 'frame_get_payment_status discovered');
  assert(toolNames.includes('frame_get_payment_intent'), 'frame_get_payment_intent discovered');
  assert(toolNames.includes('frame_request_approval'), 'frame_request_approval discovered');
  assert(toolNames.includes('frame_list_payment_authorities'), 'frame_list_payment_authorities discovered');
  assert(toolNames.includes('frame_get_payment_authority'), 'frame_get_payment_authority discovered');

  // ── 4. INSPECT PAYMENT AUTHORITIES VIA MCP ─────────────────────
  console.log('\n--- 4. AGENT INSPECTS DELEGATED AUTHORITIES ---');
  const listAuthRes = await client.callTool({
    name: 'frame_list_payment_authorities',
    arguments: {},
  });
  assert(!listAuthRes.isError, 'frame_list_payment_authorities executed without error');
  const auths = JSON.parse(getContentText(listAuthRes));
  assert(Array.isArray(auths) && auths.length > 0, 'Returned delegated authorities list');
  const agentAuth = auths.find((a: any) => a.id === authority.id);
  assert(!!agentAuth, 'Granted authority exists in list');
  assert(agentAuth.max_transaction_amount === 5000, 'Authority max transaction limit is ₹5,000');
  assert(agentAuth.daily_limit === 20000, 'Authority daily limit is ₹20,000');
  assert(agentAuth.remaining_daily === 20000, 'Remaining daily limit is ₹20,000');

  // Read specific authority
  const getAuthRes = await client.callTool({
    name: 'frame_get_payment_authority',
    arguments: { authority_id: authority.id },
  });
  assert(!getAuthRes.isError, 'frame_get_payment_authority executed without error');
  const specificAuth = JSON.parse(getContentText(getAuthRes));
  assert(specificAuth.id === authority.id, 'Authority ID matches');
  assert(specificAuth.status === 'ACTIVE', 'Authority status is ACTIVE');

  // ── 5. ZERO-TRUST TEST: REJECT CREDENTIAL INJECTION VIA MCP ────
  console.log('\n--- 5. ZERO-TRUST SECURITY TEST: PIN/OTP INJECTION ---');
  const pinAttempt = await client.callTool({
    name: 'frame_create_payment_intent',
    arguments: {
      amount: 2499,
      currency: 'INR',
      merchant: 'Keychron India',
      purpose: 'Mechanical Keyboard with PIN',
      idempotency_key: `pin_attempt_${testId}`,
      upi_pin: '123456', // ⚠️ MALICIOUS ATTEMPT
    },
  });
  assert(pinAttempt.isError === true, 'MCP server rejected upi_pin argument');
  const pinErr = JSON.parse(getContentText(pinAttempt));
  assert(
    pinErr.error.code === 'SENSITIVE_CREDENTIAL_REJECTED',
    'Error code is strictly SENSITIVE_CREDENTIAL_REJECTED'
  );

  // ── 6. AGENT CREATES AUTHORIZED PAYMENT INTENT VIA MCP ─────────
  console.log('\n--- 6. AGENT CREATES INTENT WITHIN POLICY & AUTHORITY ---');
  const intentCall = await client.callTool({
    name: 'frame_create_payment_intent',
    arguments: {
      amount: 2499,
      currency: 'INR',
      merchant: 'Keychron India',
      merchant_reference: `ORDER-${testId}-001`,
      order_reference: `ORDER-${testId}-001`,
      purpose: 'Keychron K2 Mechanical Keyboard for Dev Workstation',
      category: 'electronics',
      idempotency_key: `keychron_${testId}`,
    },
  });
  assert(!intentCall.isError, 'frame_create_payment_intent executed successfully');
  const intentData = JSON.parse(getContentText(intentCall));
  assert(intentData.decision === 'ALLOW', 'Firewall decision is ALLOW');
  assert(intentData.amount === 2499, 'Amount is ₹2,499.00');
  assert(intentData.merchant === 'Keychron India', 'Merchant is Keychron India');
  assert(!!intentData.payment_intent_id, 'Generated valid payment_intent_id');
  const paymentIntentId = intentData.payment_intent_id;

  // ── 7. AGENT POLLS REAL-TIME PAYMENT STATUS VIA MCP ────────────
  console.log('\n--- 7. AGENT RETRIEVES PAYMENT STATUS VIA MCP ---');
  const statusCall = await client.callTool({
    name: 'frame_get_payment_status',
    arguments: { payment_intent_id: paymentIntentId },
  });
  assert(!statusCall.isError, 'frame_get_payment_status executed successfully');
  const statusData = JSON.parse(getContentText(statusCall));
  assert(statusData.payment_intent_id === paymentIntentId, 'payment_intent_id matches');
  assert(statusData.decision === 'ALLOW', 'Decision confirmed as ALLOW');
  assert(
    ['EXECUTING', 'SUCCEEDED', 'AUTHORIZED'].includes(statusData.status),
    `Payment status is valid active state (${statusData.status})`
  );

  // ── 8. AGENT RETRIEVES SAFE PAYMENT INTENT VIA MCP ─────────────
  console.log('\n--- 8. AGENT RETRIEVES SAFE PAYMENT INTENT VIA MCP ---');
  const safeIntentCall = await client.callTool({
    name: 'frame_get_payment_intent',
    arguments: { payment_intent_id: paymentIntentId },
  });
  assert(!safeIntentCall.isError, 'frame_get_payment_intent executed successfully');
  const safeIntent = JSON.parse(getContentText(safeIntentCall));
  assert(safeIntent.id === paymentIntentId, 'Safe intent id matches');
  assert(safeIntent.amount === 2499, 'Safe intent amount matches');
  assert(safeIntent.purpose.includes('Keychron K2'), 'Purpose preserved');
  assert(!('provider_secret' in safeIntent), 'Zero internal provider secrets leaked');

  // ── 9. AGENT ATTEMPTS PAYMENT EXCEEDING APPROVAL THRESHOLD ─────
  console.log('\n--- 9. AGENT CREATES INTENT REQUIRING HUMAN APPROVAL ---');
  const highValueIntent = await client.callTool({
    name: 'frame_create_payment_intent',
    arguments: {
      amount: 4200, // Above ₹3,500 approval threshold, under ₹5,000 max
      currency: 'INR',
      merchant: 'Keychron India',
      purpose: 'Keychron Q1 Pro Custom Keyboard',
      category: 'electronics',
      idempotency_key: `keychron_high_${testId}`,
    },
  });
  assert(!highValueIntent.isError, 'High-value intent submitted successfully');
  const highValueData = JSON.parse(getContentText(highValueIntent));
  assert(highValueData.decision === 'REQUIRE_APPROVAL', 'Policy Firewall flagged REQUIRE_APPROVAL');
  assert(highValueData.status === 'PENDING_APPROVAL', 'Status is PENDING_APPROVAL');
  assert(highValueData.next_action === 'WAIT_FOR_APPROVAL', 'Next action is WAIT_FOR_APPROVAL');

  // Agent requests human approval notes
  const reqApprovalCall = await client.callTool({
    name: 'frame_request_approval',
    arguments: {
      payment_intent_id: highValueData.payment_intent_id,
      notes: 'Developer workstation mechanical keyboard needed for ergonomic typing',
    },
  });
  assert(!reqApprovalCall.isError, 'frame_request_approval submitted justification');

  // ── 10. CLEANUP & TERMINATION ──────────────────────────────────
  console.log('\n--- 10. GRACEFUL CLIENT DISCONNECT ---');
  await client.close();
  assert(true, 'MCP Client disconnected cleanly');

  console.log('\n================================================================');
  console.log('🎉 EXTERNAL MCP CLIENT TEST PASSED PERFECTLY!');
  console.log('   Real stdio handshake, tool discovery, authority inspection,');
  console.log('   intent creation, zero-trust protection & status polling verified.');
  console.log('================================================================\n');
}

runExternalMcpClientTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ External MCP Test Failed:', err);
    process.exit(1);
  });
