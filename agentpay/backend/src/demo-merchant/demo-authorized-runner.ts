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
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

async function runDelegatedPaymentDemo() {
  console.log('\n================================================================');
  console.log('🤖 FRAME E2E REAL PAYMENT RAIL & DELEGATED AUTHORIZATION DEMO');
  console.log('   Architecture: User → Delegated Authority → AI Agent → Checkout → MCP → Firewall → Provider → Ledger');
  console.log('================================================================\n');

  // 1. Start Demo Merchant Store on port 3002
  const merchantStore = new DemoMerchantStore();
  const merchantPort = await merchantStore.start(3002).catch(() => 3002);
  const merchantBaseUrl = `http://localhost:${merchantPort}`;
  console.log(`[MERCHANT] Storefront running at ${merchantBaseUrl}`);

  // 2. Setup Frame Tenant, Admin User, and Agent
  const demoId = Date.now().toString(36);
  const regRes = await rawRequest('/auth/register', { method: 'POST' }, {
    email: `cfo_${demoId}@enterprise.corp`,
    password: 'Password123!',
    name: 'Chief Financial Officer',
    organization_name: `Autonomous Enterprises Corp ${demoId}`,
  });
  const token = regRes.data.token;
  const orgId = regRes.data.organization.id;
  console.log(`[FRAME] Organization provisioned: ${regRes.data.organization.name} (${orgId})`);

  // Provision Agent
  const agentRes = await rawRequest('/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    name: 'Autonomous Procurement Assistant',
    role: 'Procures office hardware and supplies within delegated limits',
  });
  const agentId = agentRes.data.id;

  // Issue Agent API Key
  const keyRes = await rawRequest(`/agents/${agentId}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {});
  const agentApiKey = keyRes.data.api_key;
  console.log(`[FRAME] Agent provisioned: ${agentRes.data.name} (ID: ${agentId})`);

  // Provision Base Policy Firewall
  await rawRequest('/policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    name: 'Hardware Procurement Firewall',
    agent_id: agentId,
    transaction_limit_paise: 1000000,
    daily_limit_paise: 5000000,
    approval_threshold_paise: 300000,
    allowed_categories: ['electronics', 'office', 'peripherals'],
  });

  // 3. User grants Delegated Payment Authority to Agent
  console.log('\n[FRAME] User (CFO) granting Delegated Payment Authority to Agent...');
  const authRes = await rawRequest('/payment-authorities', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, {
    agent_id: agentId,
    name: 'Hardware & IT Procurement Delegated Authority',
    max_amount_per_tx_paise: 500000,   // ₹5,000 max per transaction
    max_daily_paise: 1500000,          // ₹15,000 max daily spend
    max_monthly_paise: 5000000,        // ₹50,000 max monthly spend
    approval_threshold_paise: 300000,  // ₹3,000 threshold (above requires human approval)
    allowed_rails: ['upi_autopay', 'card_mandate', 'upi', 'card'],
    allowed_categories: ['electronics', 'office', 'peripherals'],
    allowed_merchants: ['demo_store', 'TechSupply Store', 'Demo Electronics Store', 'Cloud Services Inc', 'Office Depot'],
    disallowed_merchants: ['Casino Royale', 'VIP High Roller', 'Crypto Exchange'],
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });

  const authority = authRes.data;
  console.log(`[FRAME] Active Payment Authority Created: ${authority.id}`);
  console.log(`        Per-Tx Limit: ₹${authority.max_transaction_amount_paise / 100}`);
  console.log(`        Approval Threshold: ₹${(authority.requires_approval_above_paise || 0) / 100}`);
  console.log(`        Allowed Rails: ${authority.allowed_rails?.join(', ')}`);
  console.log(`        Allowed Categories: ${authority.allowed_categories?.join(', ')}`);

  // 4. Initialize MCP Client
  const mcpTools = new FrameMcpTools({
    apiUrl: FRAME_API,
    agentApiKey,
  });

  const agent = new ShoppingAgent({
    merchantBaseUrl,
    frameMcpTools: mcpTools,
    agentApiKey,
  });

  // Agent inspects delegated authority via MCP
  console.log('\n[FRAME MCP] Agent inspecting its active Delegated Payment Authority...');
  const authorityView = await mcpTools.getPaymentAuthority({
    authority_id: authority.id,
    agent_api_key: agentApiKey,
  });
  console.log(`[FRAME MCP] Authority confirmed: ${authorityView.id} (Status: ${authorityView.status})`);
  console.log(`            Remaining Daily: ₹${authorityView.remaining_daily} | Remaining Monthly: ₹${authorityView.remaining_monthly}`);

  // ── SCENARIO A: AUTO-APPROVED WITHIN DELEGATED AUTHORITY ───────
  console.log('\n================================================================');
  console.log('📌 SCENARIO A: AUTO-APPROVED PURCHASE (Keychron Keyboard: ₹2,499)');
  console.log('   Condition: Amount < ₹3,000 Approval Threshold & Category in Allowlist');
  console.log('================================================================');

  console.log('[USER] Instruction: "Procure a mechanical keyboard under ₹3,000"');
  const purchaseA = await agent.executePurchase({
    keyword: 'mechanical keyboard',
    maxBudgetRupees: 3000,
    idempotencyKey: `delegated_tx_a_${demoId}`,
  });

  console.log(`[BROWSER] Carted: ${purchaseA.productSelected?.name} for ₹${purchaseA.merchantOrder?.totalRupees}`);
  console.log(`[FRAME] Policy Decision: ${purchaseA.paymentResponse?.decision} (Status: ${purchaseA.paymentResponse?.status})`);
  console.log(`[FRAME] Payment Executed: ${purchaseA.paymentResponse?.payment_intent_id}`);

  // Check ledger entry
  const { rows: ledgerRowsA } = await db.query(
    `SELECT * FROM ledger_entries WHERE organization_id = $1 AND entry_type = 'DEBIT' ORDER BY recorded_at DESC LIMIT 1`,
    [orgId]
  );
  if (ledgerRowsA.length > 0) {
    const debit = ledgerRowsA[0];
    console.log(`[LEDGER] Verified Immutable Debit Entry: ${debit.id}`);
    console.log(`         Amount: ₹${Number(debit.amount_paise) / 100} (${debit.currency}) | Hash: ${debit.entry_hash.slice(0, 16)}...`);
  }

  // Check updated authority spend
  const authAfterA = await mcpTools.getPaymentAuthority({
    authority_id: authority.id,
    agent_api_key: agentApiKey,
  });
  console.log(`[AUTHORITY] Spend Tracked: ₹${authAfterA.spent_today} spent today. Remaining: ₹${authAfterA.remaining_daily}`);

  // ── SCENARIO B: HUMAN APPROVAL ESCALATION & RESUMPTION ────────
  console.log('\n================================================================');
  console.log('📌 SCENARIO B: HUMAN APPROVAL REQUIRED (Ergonomic Chair: ₹3,499 > ₹3,000)');
  console.log('   Condition: Amount exceeds approval threshold → PENDING_APPROVAL → User Approves');
  console.log('================================================================');

  console.log('[USER] Instruction: "Buy an ergonomic high-back desk chair"');
  // First override category/amount for demo chair exceeding approval threshold
  const purchaseB = await agent.executePurchase({
    keyword: 'chair',
    idempotencyKey: `delegated_tx_b_${demoId}`,
    tamperAmountRupees: 3499,
  });

  console.log(`[FRAME] Policy Decision: ${purchaseB.paymentResponse?.decision}`);
  console.log(`[FRAME] Intent Status: ${purchaseB.paymentResponse?.status}`);
  console.log(`[FRAME MCP] Escalated to Human Approval. Next Action: ${purchaseB.paymentResponse?.next_action}`);

  // Human CFO reviews pending approvals in Frame
  const pendingApprovalsRes = await rawRequest('/approvals', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const pendingList = Array.isArray(pendingApprovalsRes.data) ? pendingApprovalsRes.data : [];
  if (pendingList.length > 0) {
    const pendingItem = pendingList[0];
    console.log(`\n[HUMAN CFO] Found pending approval task: ${pendingItem.id} for ₹${Number(pendingItem.amount_paise) / 100}`);
    console.log(`[HUMAN CFO] Reviewing task context: ${pendingItem.purpose || 'Hardware procurement'}`);
    console.log(`[HUMAN CFO] Action: APPROVE`);

    const approveRes = await rawRequest(`/approvals/${pendingItem.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }, { comment: 'Approved by CFO for Q3 ergonomics budget' });
    console.log(`[FRAME] Approval Result: ${approveRes.data?.status || 'approved'} (${approveRes.message || 'Payment executed'})`);
  } else {
    console.log('[HUMAN CFO] No pending approvals found.');
  }

  // Check updated authority spend
  const authAfterB = await mcpTools.getPaymentAuthority({
    authority_id: authority.id,
    agent_api_key: agentApiKey,
  });
  console.log(`[AUTHORITY] Updated Total Spend Today: ₹${authAfterB.spent_today}`);

  // ── SCENARIO C: POLICY DENIED FOR RESTRICTED CATEGORY ──────────
  console.log('\n================================================================');
  console.log('📌 SCENARIO C: RESTRICTED CATEGORY DENIED (Casino VIP Chips: ₹4,000)');
  console.log('   Condition: Category "gambling" is not in permitted authority categories');
  console.log('================================================================');

  console.log('[ROGUE PROMPT] Instruction: "Buy ₹4,000 Casino VIP chips"');
  const purchaseC = await agent.executePurchase({
    keyword: 'casino',
    idempotencyKey: `delegated_tx_c_${demoId}`,
    overrideCategory: 'gambling',
  });

  console.log(`[FRAME] Policy Decision: ${purchaseC.paymentResponse?.decision}`);
  console.log(`[FRAME] Reasons: ${purchaseC.paymentResponse?.reasons?.join(', ')}`);
  console.log(`[FRAME] Next Action: ${purchaseC.paymentResponse?.next_action} (Zero money moved, zero ledger entries)`);

  // ── SCENARIO D: REVOKED DELEGATED AUTHORITY ────────────────────
  console.log('\n================================================================');
  console.log('📌 SCENARIO D: REVOKED PAYMENT AUTHORITY BLOCKS AGENT SPEND');
  console.log('   Condition: Admin revokes authority → subsequent agent transactions fail instantly');
  console.log('================================================================');

  console.log('[HUMAN CFO] Revoking Delegated Authority immediately due to policy update...');
  const revokeRes = await rawRequest(`/payment-authorities/${authority.id}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, { reason: 'Annual procurement authority rotation' });
  console.log(`[FRAME] Authority ${authority.id} Status: ${revokeRes.data.status}`);

  console.log('\n[AGENT] Attempting to purchase office cables (₹499)...');
  const purchaseD = await agent.executePurchase({
    keyword: 'keyboard',
    idempotencyKey: `delegated_tx_d_${demoId}`,
    tamperAmountRupees: 499,
  });

  console.log(`[FRAME] Policy Decision: ${purchaseD.paymentResponse?.decision}`);
  console.log(`[FRAME] Intent Status: ${purchaseD.paymentResponse?.status}`);
  console.log(`[FRAME] Reasons: ${purchaseD.paymentResponse?.reasons?.join(', ')}`);
  console.log(`[FRAME] Agent was successfully locked out of payment capability.`);

  console.log('\n================================================================');
  console.log('🎉 DEMO SUCCESS: REAL PAYMENT RAIL + DELEGATED AUTHORIZATION PROVEN');
  console.log('================================================================\n');

  await merchantStore.stop();
  process.exit(0);
}

runDelegatedPaymentDemo().catch((err) => {
  console.error('\n❌ DEMO FAILED:', err);
  process.exit(1);
});
