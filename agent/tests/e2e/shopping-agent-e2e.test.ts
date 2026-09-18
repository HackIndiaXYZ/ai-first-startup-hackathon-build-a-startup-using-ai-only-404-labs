import assert from 'assert';
import path from 'path';
import { ShoppingAgent } from '../../src/core/agent';
import { DemoStoreMerchantAdapter } from '../../src/merchants/demo-store-adapter';
import { FrameMcpClient } from '../../src/frame/frame-mcp-client';
import { DeterministicRuleProvider } from '../../src/llm/deterministic';

// Import DemoMerchantStore directly from backend
const { DemoMerchantStore } = require(path.resolve(__dirname, '../../../agentpay/backend/src/demo-merchant/server'));

console.log('============================================================');
console.log('🛒 RUNNING COMPLETE END-TO-END SHOPPING AGENT TEST');
console.log('============================================================\n');

async function runE2ETest() {
  // 1. Start Demo Merchant Store on port 3002
  console.log('--- 1. STARTING DEMO MERCHANT STORE (Port 3002) ---');
  const store = new DemoMerchantStore();
  await store.start(3002);
  console.log('  ✓ Demo Merchant Store active on http://localhost:3002');

  try {
    // 2. Initialize Shopping Agent with mock/simulated Frame client for isolated E2E test
    console.log('\n--- 2. INITIALIZING AUTONOMOUS SHOPPING AGENT ---');
    const merchantAdapter = new DemoStoreMerchantAdapter('http://localhost:3002');
    const frameClient = new FrameMcpClient();

    // Configure simulated Frame responses for deterministic E2E assertions
    frameClient.listAuthorities = async () => [
      {
        authority_id: 'auth_dev_01',
        max_transaction_amount_paise: 1500000, // ₹15,000
        daily_limit_paise: 2000000,
        remaining_daily_budget_paise: 1500000,
        status: 'ACTIVE',
        allowed_categories: ['electronics', 'peripherals', 'office', 'infrastructure'],
      },
    ];

    frameClient.createPaymentIntent = async (params) => {
      // Simulate Policy Firewall evaluation:
      // - If category is gambling -> DENY
      // - If amount > ₹3,500 -> REQUIRE_APPROVAL
      // - Otherwise -> ALLOW
      if (params.category === 'gambling') {
        return {
          payment_intent_id: 'pi_deny_01',
          decision: 'DENY',
          status: 'DENIED',
          amount: params.amount_paise / 100,
          currency: 'INR',
          merchant: params.merchant,
          next_action: 'DO_NOT_RETRY',
          reasons: ['Category "gambling" is blocked by Frame Policy Firewall.'],
        };
      }

      if (params.amount_paise > 350000) {
        return {
          payment_intent_id: 'pi_approval_01',
          decision: 'REQUIRE_APPROVAL',
          status: 'PENDING_APPROVAL',
          amount: params.amount_paise / 100,
          currency: 'INR',
          merchant: params.merchant,
          next_action: 'WAIT_FOR_APPROVAL',
          reasons: ['Amount exceeds autonomous limit (₹3,500). Requires human approval.'],
          approval_task_id: 'task_appr_01',
        };
      }

      return {
        payment_intent_id: 'pi_allow_01',
        decision: 'ALLOW',
        status: 'AUTHORIZED',
        amount: params.amount_paise / 100,
        currency: 'INR',
        merchant: params.merchant,
        next_action: 'PAYMENT_EXECUTION',
      };
    };

    frameClient.requestApproval = async () => ({ success: true, message: 'Approval requested' });

    const agent = new ShoppingAgent({
      merchantAdapter,
      frameClient,
      llmProvider: new DeterministicRuleProvider(),
    });

    // ── SCENARIO A: Successful ALLOW Flow ──────────────────────────────
    console.log('\n--- 3. TEST SCENARIO A: ALLOW Flow (Mechanical Keyboard under ₹3,000) ---');
    const resultA = await agent.execute('Buy me a mechanical keyboard under ₹3,000');

    assert.strictEqual(resultA.status, 'SUCCEEDED');
    assert(resultA.selectedProduct !== undefined);
    assert.strictEqual(resultA.selectedProduct.name, 'Keychron C3 Mechanical Keyboard');
    assert.strictEqual(resultA.selectedProduct.price_rupees, 2499);
    assert(resultA.canonicalCheckout !== undefined);
    assert.strictEqual(resultA.canonicalCheckout.total_rupees, 2499);
    assert.strictEqual(resultA.framePaymentIntent?.decision, 'ALLOW');
    assert.strictEqual(resultA.orderConfirmation?.status, 'PAID_AND_FULFILLED');
    console.log('  ✓ SCENARIO A PASSED: Purchase completed and fulfilled autonomously!');

    // ── SCENARIO B: REQUIRE_APPROVAL Flow ──────────────────────────────
    console.log('\n--- 4. TEST SCENARIO B: REQUIRE_APPROVAL Flow (Office chair under ₹20,000) ---');
    const resultB = await agent.execute('Buy me an ergonomic office chair under ₹20,000');

    // Office chair is ₹2,799; to trigger approval threshold (> ₹3,500), let's test high budget server
    const resultApproval = await agent.execute('Buy enterprise GPU server under ₹20,000');
    assert.strictEqual(resultApproval.status, 'WAITING_FOR_HUMAN_APPROVAL');
    assert.strictEqual(resultApproval.framePaymentIntent?.decision, 'REQUIRE_APPROVAL');
    assert(resultApproval.humanInterventionRequired !== undefined);
    console.log('  ✓ SCENARIO B PASSED: High-value transaction safely paused for human approval!');

    // ── SCENARIO C: Security Rejection (Prohibited category: gambling) ──
    console.log('\n--- 5. TEST SCENARIO C: Security Rejection (Gambling casino chips) ---');
    const resultC = await agent.execute('Buy casino chips pack under ₹5,000');
    assert.strictEqual(resultC.status, 'TERMINATED_BY_SECURITY');
    assert(resultC.error?.message.includes('gambling'));
    console.log('  ✓ SCENARIO C PASSED: Prohibited category cleanly blocked by Security Policy!');

    // ── SCENARIO D: Frame Policy Firewall DENY Flow ────────────────────
    console.log('\n--- 6. TEST SCENARIO D: Frame Policy Firewall DENY Decision ---');
    // Change Frame mock to return DENY
    frameClient.createPaymentIntent = async (params) => ({
      payment_intent_id: 'pi_deny_policy',
      decision: 'DENY',
      status: 'DENIED',
      amount: params.amount_paise / 100,
      currency: 'INR',
      merchant: params.merchant,
      next_action: 'DO_NOT_RETRY',
      reasons: ['Daily velocity threshold reached for merchant TechSupply Store.'],
    });

    const resultD = await agent.execute('Buy me a mechanical keyboard under ₹3,000');
    assert.strictEqual(resultD.status, 'TERMINATED_BY_POLICY');
    assert.strictEqual(resultD.framePaymentIntent?.decision, 'DENY');
    assert.strictEqual(resultD.framePaymentIntent?.next_action, 'DO_NOT_RETRY');
    console.log('  ✓ SCENARIO D PASSED: Frame Policy Firewall DENY cleanly halted without retries!');

    console.log('\n============================================================');
    console.log('🎉 ALL END-TO-END AGENT SHOPPING TESTS PASSED!');
    console.log('============================================================\n');
  } finally {
    await store.stop();
    console.log('  ✓ Demo Merchant Store stopped');
  }
}

runE2ETest().catch((err) => {
  console.error('💥 E2E Test Failed:', err);
  process.exit(1);
});
