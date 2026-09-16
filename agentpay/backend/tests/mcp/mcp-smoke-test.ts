import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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

async function runRealAgentSmokeTest() {
  console.log('\n================================================================');
  console.log('🛍️ RUNNING REAL AI AGENT SMOKE TEST OVER MCP');
  console.log('================================================================\n');

  const testId = Date.now().toString(36);

  // ── 1. SETUP: PROVISION ENTERPRISE TENANT & AGENT ──────────────
  console.log('--- Step 1: Provisioning Enterprise Organization & Agent in Frame ---');
  const regRes = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `procure_admin_${testId}@acme.com`,
    password: 'Password123!',
    name: 'Acme Admin',
    organization_name: `Acme Robotics ${testId}`,
  });
  assert(regRes.status === 201, 'Acme Organization registered in Frame');
  const adminToken = regRes.data.token;

  // Create autonomous procurement agent
  const agentRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  }, {
    name: 'Hardware Procurement Agent',
    role: 'Autonomous IT Supply Purchaser',
  });
  assert(agentRes.status === 201, 'Hardware Procurement Agent provisioned');
  const agentId = agentRes.data.id;

  // Generate real Agent API Key
  const credRes = await rawRequest(`/agents/${agentId}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  }, {});
  assert(credRes.status === 201, 'Real Agent API key generated');
  const agentApiKey = credRes.data.api_key;
  console.log(`  🔑 Agent API Key: ${agentApiKey.slice(0, 12)}... (active)`);

  // Configure Policy Firewall:
  // - Max per transaction: ₹5,000 (500,000 paise)
  // - Approval threshold: ₹2,500 (250,000 paise)
  // - Daily budget: ₹10,000 (1,000,000 paise)
  // - Allowed categories: ['electronics', 'peripherals', 'office']
  const policyRes = await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  }, {
    name: 'IT Hardware Procurement Policy',
    agent_id: agentId,
    max_amount_paise: 500000,
    daily_budget_paise: 1000000,
    approval_threshold_paise: 250000,
    allowed_categories: ['electronics', 'peripherals', 'office'],
  });
  assert(policyRes.status === 201, 'Deterministic Policy Firewall active for agent');

  // ── 2. SPIN UP MCP SERVER & CLIENT OVER PROTOCOL ───────────────
  console.log('\n--- Step 2: Initializing MCP Transport & Agent Client Handshake ---');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const { server } = createFrameMcpServer({
    apiUrl: API_BASE,
    agentApiKey: agentApiKey,
  });

  const client = new Client(
    {
      name: 'autonomous-procurement-agent',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  console.log('  ✓ Connected MCP Client to Frame MCP Server over JSON-RPC');

  // ── 3. DISCOVER MCP TOOLS ──────────────────────────────────────
  console.log('\n--- Step 3: Agent Discovers Available Frame MCP Tools ---');
  const toolsList = await client.listTools();
  const toolNames = toolsList.tools.map((t) => t.name);
  console.log('  Discovered Tools:', toolNames);

  assert(toolNames.includes('frame_create_payment_intent'), 'frame_create_payment_intent discovered');
  assert(toolNames.includes('frame_get_payment_status'), 'frame_get_payment_status discovered');
  assert(toolNames.includes('frame_get_payment_intent'), 'frame_get_payment_intent discovered');
  assert(toolNames.includes('frame_request_approval'), 'frame_request_approval discovered');

  // ── 4. SCENARIO A: AGENT BUYS MECHANICAL KEYBOARD (ALLOW) ───────
  console.log('\n--- Step 4: Scenario A — Agent Purchases Mechanical Keyboard (₹2,499) ---');
  console.log('  Prompt: "Buy a mechanical keyboard under ₹3,000 for the team"');
  console.log('  Agent Action: Browses, identifies Keychron C3 for ₹2,499 on Amazon India, calls Frame MCP');

  const createResult: any = await client.callTool({
    name: 'frame_create_payment_intent',
    arguments: {
      amount: 2499.00,
      currency: 'INR',
      merchant: 'Amazon India',
      merchant_reference: 'AMZN-ORD-98214',
      purpose: 'Keychron Mechanical Keyboard for developer workstation',
      category: 'peripherals',
      idempotency_key: `agent_checkout_kbd_${testId}`,
    },
  });

  const createText = createResult.content[0].text;
  const intentData = JSON.parse(createText);
  console.log('  MCP Response:', JSON.stringify(intentData, null, 2));

  assert(intentData.decision === 'ALLOW', 'Policy Firewall evaluated and returned ALLOW');
  assert(intentData.amount === 2499, 'Amount verified at ₹2,499');
  assert(intentData.merchant === 'Amazon India', 'Merchant verified as Amazon India');
  assert(typeof intentData.payment_intent_id === 'string', 'Received payment_intent_id');
  const keyboardIntentId = intentData.payment_intent_id;

  // ── 5. AGENT TRACKS PAYMENT STATUS ─────────────────────────────
  console.log('\n--- Step 5: Agent Checks Payment Execution Status ---');
  const statusResult: any = await client.callTool({
    name: 'frame_get_payment_status',
    arguments: {
      payment_intent_id: keyboardIntentId,
    },
  });

  const statusData = JSON.parse(statusResult.content[0].text);
  console.log('  Status Response:', JSON.stringify(statusData, null, 2));
  assert(statusData.payment_intent_id === keyboardIntentId, 'Payment status matches intent ID');
  assert(statusData.decision === 'ALLOW', 'Decision confirmed as ALLOW');
  assert(['AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'COMPLETED', 'SETTLED'].includes(statusData.status), 'Payment is successfully executing or settled');

  // ── 6. AGENT FETCHES SAFE PAYMENT RECEIPT ──────────────────────
  console.log('\n--- Step 6: Agent Retrieves Safe Payment Receipt ---');
  const receiptResult: any = await client.callTool({
    name: 'frame_get_payment_intent',
    arguments: {
      payment_intent_id: keyboardIntentId,
    },
  });

  const receiptData = JSON.parse(receiptResult.content[0].text);
  assert(receiptData.id === keyboardIntentId, 'Receipt ID matches');
  assert(receiptData.amount === 2499, 'Receipt amount is ₹2,499');
  assert(receiptData.purpose.includes('Mechanical Keyboard'), 'Receipt purpose matches');
  assert(receiptData.secret === undefined, 'No internal secrets exposed to agent');

  // ── 7. SCENARIO B: AGENT ATTEMPTS HIGHER SPEND (REQUIRE_APPROVAL) ─
  console.log('\n--- Step 7: Scenario B — Agent Purchases High-End Server (₹4,200 > ₹2,500 Threshold) ---');
  console.log('  Agent calls frame_create_payment_intent for ₹4,200...');

  const approvalReqResult: any = await client.callTool({
    name: 'frame_create_payment_intent',
    arguments: {
      amount: 4200.00,
      currency: 'INR',
      merchant: 'Hetzner Online',
      purpose: 'Dedicated staging server',
      category: 'electronics',
      idempotency_key: `agent_checkout_server_${testId}`,
    },
  });

  const approvalIntent = JSON.parse(approvalReqResult.content[0].text);
  console.log('  Firewall Response:', JSON.stringify(approvalIntent, null, 2));

  assert(approvalIntent.decision === 'REQUIRE_APPROVAL', 'Policy Firewall requires human approval');
  assert(approvalIntent.status === 'PENDING_APPROVAL', 'Intent is in PENDING_APPROVAL status');
  assert(approvalIntent.next_action === 'WAIT_FOR_APPROVAL', 'Agent instructed to WAIT_FOR_APPROVAL');

  // Agent requests human approval workflow
  console.log('\n--- Step 8: Agent Requests Human Approval via frame_request_approval ---');
  const approvalWorkflowResult: any = await client.callTool({
    name: 'frame_request_approval',
    arguments: {
      payment_intent_id: approvalIntent.payment_intent_id,
      notes: 'Required for Q4 load testing infrastructure',
    },
  });

  const workflowData = JSON.parse(approvalWorkflowResult.content[0].text);
  console.log('  Workflow Response:', JSON.stringify(workflowData, null, 2));

  assert(workflowData.decision === 'REQUIRE_APPROVAL', 'Decision confirmed REQUIRE_APPROVAL');
  assert(typeof workflowData.approval_task_id === 'string', 'Approval task assigned to human approvers');
  assert(workflowData.next_action === 'WAIT_FOR_APPROVAL', 'Next action is WAIT_FOR_APPROVAL');

  console.log('\n================================================================');
  console.log('🎉 REAL AI AGENT SMOKE TEST OVER MCP COMPLETED SUCCESSFULLY!');
  console.log('================================================================\n');

  await client.close();
  await server.close();
}

runRealAgentSmokeTest()
  .catch((err) => {
    console.error('\n❌ REAL AGENT SMOKE TEST FAILED:', err);
    process.exit(1);
  });
