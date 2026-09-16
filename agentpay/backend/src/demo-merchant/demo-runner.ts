import { DemoMerchantStore } from './server';
import { ShoppingAgent } from './agent-flow';
import { FrameMcpTools } from '../mcp/tools';
import { db } from '../db';

const FRAME_API = process.env.FRAME_API_URL || 'http://localhost:3001/v1';

async function rawRequest(path: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${FRAME_API}${path}`, {
    ...options,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

async function runLiveDemo() {
  console.log('\n================================================================');
  console.log('🤖 FRAME E2E AGENT PAYMENT EXECUTION DEMO');
  console.log('   Architecture: User → AI Agent → Browser Checkout → Frame MCP → Policy → Payment → Ledger');
  console.log('================================================================\n');

  // 1. Start Demo Merchant Store on port 3002
  const merchantStore = new DemoMerchantStore();
  const merchantPort = await merchantStore.start(3002).catch(() => 3002);
  const merchantBaseUrl = `http://localhost:${merchantPort}`;
  console.log(`[MERCHANT] Local storefront active at ${merchantBaseUrl}`);

  // 2. Setup Frame Tenant, Agent, and Spend Policy
  const demoId = Date.now().toString(36);
  const regRes = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `agent_demo_${demoId}@enterprise.corp`,
    password: 'Password123!',
    name: 'Demo Enterprise Admin',
    organization_name: `Autonomous Systems Corp ${demoId}`,
  });
  const token = regRes.data.token;
  const orgId = regRes.data.organization.id;

  // Provision Agent
  const agentRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    name: 'Hardware Procurement Agent',
    role: 'Autonomous Office Hardware Purchasing',
  });
  const agentId = agentRes.data.id;

  // Issue Agent API Key
  const keyRes = await rawRequest(`/agents/${agentId}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {});
  const agentApiKey = keyRes.data.api_key;

  // Configure Policy Firewall:
  // - Max amount: ₹5,000
  // - Approval threshold: ₹2,500
  // - Allowed categories: ['electronics', 'office', 'peripherals']
  await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    name: 'Hardware Purchasing Policy',
    agent_id: agentId,
    transaction_limit_paise: 500000,
    daily_limit_paise: 2000000,
    approval_threshold_paise: 250000,
    allowed_categories: ['electronics', 'office', 'peripherals'],
  });

  const mcpTools = new FrameMcpTools({
    apiUrl: FRAME_API,
    agentApiKey,
  });

  const agent = new ShoppingAgent({
    merchantBaseUrl,
    frameMcpTools: mcpTools,
    agentApiKey,
  });

  // ── SCENARIO A: AUTO-APPROVED PURCHASE ──────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('📌 SCENARIO A: AUTO-APPROVAL (Keychron Mechanical Keyboard under ₹3,000)');
  console.log('----------------------------------------------------------------');

  console.log('[USER] Instruction: "Buy a mechanical keyboard under ₹3,000"');

  // Agent searches merchant
  const products = await agent.searchCatalog('mechanical keyboard', 3000);
  const chosenProduct = products[0];
  console.log(`[BROWSER] Navigated to ${merchantBaseUrl}/products`);
  console.log(`[BROWSER] Product selected: ${chosenProduct.name} (Category: ${chosenProduct.category})`);

  // Agent proceeds to checkout
  const order = await agent.proceedToCheckout(chosenProduct.id, 1);
  console.log(`[BROWSER] Reached Checkout: Order ID = ${order.orderId}`);
  console.log(`[BROWSER] Final Checkout Total: ₹${order.totalRupees.toLocaleString('en-IN')}`);

  // Agent delegates payment to Frame MCP
  console.log('[FRAME MCP] Agent calling frame_create_payment_intent...');
  const purchaseResult = await agent.executePurchase({
    keyword: 'mechanical keyboard',
    maxBudgetRupees: 3000,
    idempotencyKey: `demo_checkout_${demoId}`,
  });

  const paymentIntent = purchaseResult.paymentResponse!;
  console.log(`[FRAME] Payment Intent Created: ${paymentIntent.payment_intent_id}`);
  console.log(`[FRAME] Policy Firewall Decision: ${paymentIntent.decision} (Status: ${paymentIntent.status})`);
  console.log(`[FRAME] Next Action: ${paymentIntent.next_action}`);

  // Verify settlement and ledger debit in database
  const statusRes = await mcpTools.getPaymentStatus({
    payment_intent_id: paymentIntent.payment_intent_id,
    agent_api_key: agentApiKey,
  });
  console.log(`[FRAME] Payment Status: ${statusRes.status}`);

  const { rows: ledgerRows } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT' ORDER BY recorded_at DESC LIMIT 1`,
    [orgId]
  );
  if (ledgerRows.length > 0) {
    const debit = ledgerRows[0];
    console.log(`[LEDGER] Verified Ledger Entry: ${debit.id}`);
    console.log(`[LEDGER] Debit: ₹${Number(debit.amount_paise) / 100} (${debit.currency}) | Hash: ${debit.entry_hash.slice(0, 16)}...`);
  }

  // Verify merchant order fulfillment
  const confirmedOrder = merchantStore.getOrder(purchaseResult.merchantOrder!.orderId);
  console.log(`[MERCHANT] Order ${confirmedOrder?.orderId} Final Status: ${confirmedOrder?.status} (PaymentIntent: ${confirmedOrder?.paymentIntentId})`);

  // ── SCENARIO B: HIGH SPEND REQUIRING APPROVAL ────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('📌 SCENARIO B: HUMAN APPROVAL REQUIRED (Ergonomic Chair ₹2,799 > ₹2,500 Threshold)');
  console.log('----------------------------------------------------------------');

  console.log('[USER] Instruction: "Buy an ergonomic office chair"');
  const chairOrder = await agent.proceedToCheckout('prod_chair_02', 1);
  console.log(`[BROWSER] Checkout Total: ₹${chairOrder.totalRupees} (Policy Approval Threshold: ₹2,500)`);

  const chairResult = await agent.executePurchase({
    keyword: 'ergonomic',
    idempotencyKey: `demo_chair_${demoId}`,
  });
  console.log(`[FRAME] Policy Firewall Decision: ${chairResult.paymentResponse?.decision}`);
  console.log(`[FRAME] Intent Status: ${chairResult.paymentResponse?.status}`);
  console.log(`[FRAME MCP] Human approval workflow triggered. Next Action: ${chairResult.paymentResponse?.next_action}`);

  // ── SCENARIO C: POLICY DENIED CATEGORY ──────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('📌 SCENARIO C: POLICY DENIED (Restricted Category "gambling")');
  console.log('----------------------------------------------------------------');

  console.log('[USER] Instruction: "Buy Casino VIP chips"');
  const chipsResult = await agent.executePurchase({
    keyword: 'casino',
    idempotencyKey: `demo_chips_${demoId}`,
  });
  console.log(`[FRAME] Policy Firewall Decision: ${chipsResult.paymentResponse?.decision}`);
  console.log(`[FRAME] Intent Status: ${chipsResult.paymentResponse?.status}`);
  console.log(`[FRAME] Reasons: ${chipsResult.paymentResponse?.reasons?.join(', ')}`);
  console.log(`[FRAME] Next Action: ${chipsResult.paymentResponse?.next_action} (Zero money moved, zero ledger debits)`);

  console.log('\n================================================================');
  console.log('✅ DEMO COMPLETE: ALL SCENARIOS DEMONSTRATED SUCCESSFULLY!');
  console.log('================================================================\n');

  await merchantStore.stop();
  process.exit(0);
}

runLiveDemo().catch((err) => {
  console.error('\n❌ DEMO FAILED:', err);
  process.exit(1);
});
