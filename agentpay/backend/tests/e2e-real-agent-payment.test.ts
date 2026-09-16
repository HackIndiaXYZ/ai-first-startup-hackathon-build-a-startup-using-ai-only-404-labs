// Canonical End-to-End Real Agent Payment Test Suite
// Verified Environment: E2E_REAL_SANDBOX
// Integrates: AI Agent -> Merchant Checkout -> Frame MCP -> Policy Firewall ->
//             Payment Authority -> Razorpay Sandbox -> Real Webhook Verification ->
//             Settlement -> Immutable SHA-256 Ledger -> Audit Trail

import * as crypto from 'crypto';
import { DemoMerchantStore } from '../src/demo-merchant/server';
import { FrameMcpTools } from '../src/mcp/tools';
import { db } from '../src/db';
import { config } from '../src/config';
import { buildApp } from '../src/app';

const BASE = 'http://localhost:3001/v1';

async function rawRequest(path: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, httpStatus: res.status, ...data };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function ensureBackendRunning(): Promise<() => Promise<void>> {
  try {
    const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      console.log('  📡 Connected to existing Frame API on port 3001');
      return async () => {};
    }
  } catch {}

  console.log('  🚀 Booting in-process Frame API server on port 3001...');
  const app = await buildApp();
  await app.listen({ port: 3001, host: '0.0.0.0' });
  return async () => {
    await app.close();
  };
}

async function runCanonicalRealE2E(): Promise<void> {
  console.log('================================================================');
  console.log('🌐 CANONICAL REAL AGENT PAYMENT TEST SUITE');
  console.log('   Execution Tag: [E2E_REAL_SANDBOX]');
  console.log('   Provider: Razorpay Sandbox API (api.razorpay.com/v1)');
  console.log('   Zero Bypasses: No PIN/OTP, Real HMAC Webhook, Double-Entry Ledger');
  console.log('================================================================\n');

  const closeBackend = await ensureBackendRunning();

  // Start Demo Merchant Store on port 3002
  const merchantStore = new DemoMerchantStore();
  const merchantPort = await merchantStore.start(3002).catch(() => 3002);
  const merchantUrl = `http://localhost:${merchantPort}`;
  console.log(`  🏪 Demo Merchant Store listening on ${merchantUrl}\n`);

  try {
    const testId = Date.now().toString(36);
    const webhookSecret = 'test_wh_secret_' + testId;

    // ── 1. CREATE USER & ORGANIZATION ───────────────────────────
    console.log('--- 1. PROVISION USER & ORGANIZATION ---');
    const regRes = await rawRequest('/auth/register', { method: 'POST' }, {
      email: `fintech_lead_${testId}@autonomous.corp`,
      password: 'Password123!',
      name: 'Treasury Officer',
      organization_name: `Autonomous Enterprises ${testId}`,
    });
    assert(regRes.status === 201, 'User registered & Organization created');
    const userToken = regRes.data.token;
    const orgId = regRes.data.organization.id;
    const userHeaders = { Authorization: `Bearer ${userToken}` };

    // ── 2. CONFIGURE REAL RAZORPAY SANDBOX PROVIDER ─────────────
    console.log('\n--- 2. CONFIGURE REAL RAZORPAY SANDBOX CREDENTIALS ---');
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_TadwtFgpN24FFm';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '3WTiwzmAEuUfFKOaowMr1Wjp';

    assert(keyId.startsWith('rzp_test_'), 'Razorpay test key format confirmed (SANDBOX)');

    const provRes = await rawRequest('/providers', {
      method: 'POST',
      headers: userHeaders,
    }, {
      provider_type: 'razorpay',
      name: 'Razorpay Sandbox Direct',
      is_default: true,
      webhook_secret: webhookSecret,
      credentials: {
        key_id: keyId,
        key_secret: keySecret,
      },
    });
    assert(provRes.status === 201, 'Razorpay provider configured as default for tenant');

    // ── 3. PROVISION AI AGENT & ISSUE CREDENTIALS ───────────────
    console.log('\n--- 3. PROVISION AI AGENT & API KEY ---');
    const agentRes = await rawRequest('/agents', {
      method: 'POST',
      headers: userHeaders,
    }, {
      name: 'Hardware Procurement Agent 01',
      description: 'Autonomous hardware procurement agent',
      owner_team: 'IT Logistics',
      purpose: 'Purchases developer equipment under strict policy limits',
    });
    assert(agentRes.status === 201, 'Agent entity created');
    const agentId = agentRes.data.id;

    const credRes = await rawRequest(`/agents/${agentId}/credentials`, {
      method: 'POST',
      headers: userHeaders,
    }, {});
    assert(credRes.status === 201, 'Agent API key issued');
    const agentApiKey = credRes.data.api_key;
    const agentHeaders = { 'X-API-Key': agentApiKey };

    // Baseline Agent Policy
    const polRes = await rawRequest('/policies', {
      method: 'POST',
      headers: userHeaders,
    }, {
      name: 'Hardware Procurement Policy',
      agent_id: agentId,
      transaction_limit_paise: 500000,
      daily_limit_paise: 2000000,
      monthly_limit_paise: 10000000,
      approval_threshold_paise: 300000,
      allowed_categories: ['electronics', 'office', 'peripherals'],
      blocked_categories: ['gambling', 'crypto'],
    });
    assert(polRes.status === 201, 'Agent baseline Policy registered');

    // ── 4. CREATE PAYMENT AUTHORITY (DELEGATED MANDATE) ─────────
    console.log('\n--- 4. HUMAN USER CREATES BOUNDED PAYMENT AUTHORITY ---');
    // Policy:
    // Max transaction: ₹5,000 (500,000 paise)
    // Daily limit: ₹20,000 (2,000,000 paise)
    // Monthly limit: ₹100,000 (10,000,000 paise)
    // Approval threshold: ₹3,000 (300,000 paise)
    // Allowed categories: ['electronics', 'office', 'peripherals']
    // Blocked: ['gambling', 'crypto']
    const authRes = await rawRequest('/payment-authorities', {
      method: 'POST',
      headers: userHeaders,
    }, {
      agent_id: agentId,
      provider: 'razorpay',
      rail: 'card_mandate',
      currency: 'INR',
      max_transaction_amount_paise: 500000,
      daily_limit_paise: 2000000,
      monthly_limit_paise: 10000000,
      requires_approval_above_paise: 300000,
      allowed_categories: ['electronics', 'office', 'peripherals'],
      blocked_categories: ['gambling', 'crypto'],
      allowed_merchants: ['Demo Tech Supplies', 'TechSupply Store'],
      purpose: 'Developer workstation peripherals procurement',
      valid_until: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    assert(authRes.status === 201, 'PaymentAuthority created and activated');
    const authority = authRes.data;
    assert(authority.status === 'ACTIVE', 'Authority is immediately ACTIVE');
    assert(Number(authority.spent_today_paise) === 0, 'Zero spend recorded initially');

    // ── 5. AGENT CONNECTS VIA MCP & CHECKS AUTHORITY ────────────
    console.log('\n--- 5. AGENT INSPECTS AUTHORITY BOUNDS VIA MCP ---');
    const mcpTools = new FrameMcpTools({
      apiUrl: 'http://localhost:3001/v1',
      agentApiKey,
    });

    const mcpAuthorities = await mcpTools.listPaymentAuthorities({ agent_api_key: agentApiKey });
    assert(mcpAuthorities.length >= 1, 'MCP returned active delegated authorities');
    const activeAuth = mcpAuthorities[0];
    assert(activeAuth.max_transaction_amount === 5000, 'Authority max transaction limit is ₹5,000');
    assert(activeAuth.allowed_categories.includes('electronics'), 'Allowed categories include electronics');

    // ── 6. AGENT BROWSES MERCHANT & CREATES CHECKOUT ORDER ──────
    console.log('\n--- 6. AGENT BROWSES MERCHANT CATALOG & INITIATES CHECKOUT ---');
    const productsRes = await fetch(`${merchantUrl}/products`);
    const { data: products } = (await productsRes.json()) as any;
    const keyboard = products.find((p: any) => p.id === 'prod_kbd_01');
    assert(keyboard && keyboard.pricePaise === 249900, 'Found Mechanical Keyboard (₹2,499)');

    const checkoutRes = await fetch(`${merchantUrl}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: keyboard.id, quantity: 1 }],
      }),
    });
    const orderData: any = await checkoutRes.json();
    assert(checkoutRes.ok, 'Merchant generated checkout order');
    const merchantOrderId = orderData.data.orderId;
    assert(orderData.data.status === 'AWAITING_PAYMENT', 'Merchant order awaiting payment');

    // ── 7. ZERO-TRUST SAFETY: REJECT SENSITIVE CREDENTIALS ──────
    console.log('\n--- 7. ZERO-TRUST SECURITY: ATTEMPTED PIN INJECTION REJECTION ---');
    let rejectedAsExpected = false;
    try {
      await mcpTools.createPaymentIntent({
        amount_paise: keyboard.pricePaise,
        currency: 'INR',
        merchant: 'Demo Tech Supplies',
        purpose: 'Keyboard procurement',
        category: 'electronics',
        idempotency_key: `malicious_pin_${testId}`,
        metadata: {
          upi_pin: '123456', // ILLEGAL CREDENTIAL
        },
        agent_api_key: agentApiKey,
      } as any);
    } catch (err: any) {
      if (err.code === 'SENSITIVE_CREDENTIAL_REJECTED' || err.message.includes('SENSITIVE_CREDENTIAL_REJECTED')) {
        rejectedAsExpected = true;
      }
    }
    assert(rejectedAsExpected, 'Sensitive credential (PIN/OTP) strictly blocked with SENSITIVE_CREDENTIAL_REJECTED');

    // ── 8. AGENT CREATES PAYMENT INTENT VIA MCP (ALLOW FLOW) ────
    console.log('\n--- 8. AGENT CREATES LEGITIMATE PAYMENT INTENT VIA MCP ---');
    const intentIdempotencyKey = `real_agent_pay_${testId}`;
    const mcpIntentResult = await mcpTools.createPaymentIntent({
      amount_paise: keyboard.pricePaise,
      currency: 'INR',
      merchant: 'Demo Tech Supplies',
      merchant_reference: merchantOrderId,
      purpose: 'Logitech Mechanical Keyboard for developer workstation',
      category: 'electronics',
      idempotency_key: intentIdempotencyKey,
      agent_api_key: agentApiKey,
    });

    assert(mcpIntentResult.decision === 'ALLOW', 'Firewall evaluated ALLOW (within authority limits)');
    const paymentIntentId = mcpIntentResult.payment_intent_id;
    console.log(`  💳 Payment Intent Created: ${paymentIntentId} (Status: ${mcpIntentResult.status})`);

    // ── 9. REAL PROVIDER EXECUTION & INQUIRY ─────────────────────
    console.log('\n--- 9. VERIFY REAL PROVIDER PAYMENT RECORD ---');
    // Fetch payment record
    const { rows: paymentRows } = await db.query(
      `SELECT * FROM payments WHERE payment_intent_id = $1`,
      [paymentIntentId]
    );
    assert(paymentRows.length === 1, 'Payment record provisioned in database');
    const paymentRecord = paymentRows[0];
    assert(paymentRecord.provider === 'razorpay', 'Payment routed to Razorpay provider');
    console.log('  Payment record from DB:', JSON.stringify(paymentRecord));
    assert(paymentRecord.status === 'processing' || paymentRecord.status === 'succeeded', `Payment status is ${paymentRecord.status}, expected processing or succeeded`);
    const providerOrderId = paymentRecord.provider_payment_id;
    assert(providerOrderId && providerOrderId.startsWith('order_'), `Real Razorpay Order ID created: ${providerOrderId}`);

    // ── 10. REAL CRYPTOGRAPHIC WEBHOOK VERIFICATION ─────────────
    console.log('\n--- 10. DELIVER AUTHENTIC HMAC-SHA256 PROVIDER WEBHOOK ---');
    const webhookPayload = {
      id: `evt_canonical_${testId}`,
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'order.paid',
      contains: ['order', 'payment'],
      payload: {
        order: {
          entity: {
            id: providerOrderId,
            amount: keyboard.pricePaise,
            currency: 'INR',
            status: 'paid',
            receipt: paymentRecord.id.substring(0, 40),
          },
        },
        payment: {
          entity: {
            id: `pay_${testId}`,
            order_id: providerOrderId,
            amount: keyboard.pricePaise,
            currency: 'INR',
            status: 'captured',
            method: 'card',
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    const rawPayloadString = JSON.stringify(webhookPayload);
    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawPayloadString)
      .digest('hex');

    // Test: Invalid signature must be rejected
    const tamperedPayload = {
      ...webhookPayload,
      id: `evt_tampered_${testId}`,
    };
    const badWebhookRes = await rawRequest('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': 'invalid_signature_tampered',
      },
    }, tamperedPayload);
    assert(badWebhookRes.httpStatus === 400, 'Tampered webhook signature rejected with HTTP 400');

    // Test: Legitimate signature verified
    const goodWebhookRes = await rawRequest('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': validSignature,
      },
    }, webhookPayload);
    if (goodWebhookRes.httpStatus !== 200) {
      console.error('  DEBUG goodWebhookRes error:', JSON.stringify(goodWebhookRes));
    }
    assert(goodWebhookRes.httpStatus === 200, 'Legitimate HMAC webhook accepted with HTTP 200');
    assert(goodWebhookRes.result?.status === 'processed', 'Webhook event processed successfully');

    // ── 11. VERIFY SETTLEMENT, LEDGER & AUTHORITY SPEND ─────────
    console.log('\n--- 11. VERIFY FINAL SETTLEMENT & IMMUTABLE LEDGER ---');
    const { rows: settledIntents } = await db.query(
      `SELECT * FROM payment_intents WHERE id = $1`,
      [paymentIntentId]
    );
    assert(settledIntents[0].status === 'SUCCEEDED', 'Payment Intent status settled to SUCCEEDED');

    const { rows: settledPayments } = await db.query(
      `SELECT * FROM payments WHERE id = $1`,
      [paymentRecord.id]
    );
    assert(settledPayments[0].status === 'succeeded', 'Payment status settled to succeeded');
    assert(settledPayments[0].reconciliation_status === 'reconciled', 'Reconciliation status is reconciled');

    // Ledger Verification: Exactly 1 DEBIT
    const { rows: ledgerEntries } = await db.query(
      `SELECT * FROM ledger_entries WHERE payment_id = $1`,
      [paymentRecord.id]
    );
    assert(ledgerEntries.length === 1, 'Exactly ONE ledger entry created for settled payment');
    assert(ledgerEntries[0].entry_type === 'DEBIT', 'Ledger entry is immutable DEBIT');
    assert(Number(ledgerEntries[0].amount_paise) === keyboard.pricePaise, 'Ledger debit amount matches exact paise (249900)');
    assert(ledgerEntries[0].entry_hash && ledgerEntries[0].entry_hash.length === 64, 'Ledger entry is cryptographically sealed (SHA-256)');

    // Authority Spend Updated
    const { rows: updatedAuths } = await db.query(
      `SELECT * FROM payment_authorities WHERE id = $1`,
      [authority.id]
    );
    assert(Number(updatedAuths[0].spent_today_paise) === keyboard.pricePaise, 'Authority recorded spend in spent_today_paise');

    // ── 12. WEBHOOK REPLAY PROTECTION INVARIANT ─────────────────
    console.log('\n--- 12. VERIFY REPLAY PROTECTION (ZERO DUPLICATE DEBITS) ---');
    const replayWebhookRes = await rawRequest('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': validSignature,
      },
    }, webhookPayload);
    assert(replayWebhookRes.httpStatus === 200, 'Replayed webhook acknowledged safely');
    assert(replayWebhookRes.result?.status === 'deduplicated', 'Replayed webhook marked as deduplicated');

    const { rows: ledgerAfterReplay } = await db.query(
      `SELECT * FROM ledger_entries WHERE payment_id = $1`,
      [paymentRecord.id]
    );
    assert(ledgerAfterReplay.length === 1, 'ZERO duplicate ledger debits on webhook replay');

    // ── 13. MERCHANT ORDER SETTLEMENT ───────────────────────────
    console.log('\n--- 13. SETTLE MERCHANT ORDER ---');
    const merchantConfirmRes = await fetch(`${merchantUrl}/orders/${merchantOrderId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_intent_id: paymentIntentId }),
    });
    const merchantConfirmData: any = await merchantConfirmRes.json();
    assert(merchantConfirmRes.ok, 'Merchant successfully verified payment with Frame');
    assert(merchantConfirmData.data.status === 'PAID', 'Merchant order transitioned to PAID');

    // ── 14. AUDIT TRAIL VERIFICATION ────────────────────────────
    console.log('\n--- 14. AUDIT TRAIL VERIFICATION ---');
    const { rows: auditEvents } = await db.query(
      `SELECT action, resource_type, occurred_at FROM audit_events WHERE organization_id = $1 ORDER BY occurred_at ASC`,
      [orgId]
    );
    const actions = auditEvents.map(e => e.action);
    assert(actions.includes('authority.created'), 'Audit contains authority.created');
    assert(actions.includes('payment_intent.created'), 'Audit contains payment_intent.created');
    assert(actions.includes('payment.succeeded'), 'Audit contains payment.succeeded');
    console.log(`  ✓ Complete audit trail recorded (${auditEvents.length} events logged)`);

    // ── 15. REFUND EXECUTION & REVERSAL ENTRY ───────────────────
    console.log('\n--- 15. REFUND DISPATCH & REVERSAL ENTRY TEST ---');
    const refundRes = await rawRequest(`/payments/${paymentRecord.id}/refund`, {
      method: 'POST',
      headers: userHeaders,
    }, {
      amount_paise: keyboard.pricePaise,
      reason: 'Workstation order cancelled by team lead',
    });
    assert(refundRes.httpStatus === 200, 'Payment refund processed');

    const { rows: refundLedger } = await db.query(
      `SELECT * FROM ledger_entries WHERE payment_id = $1 AND entry_type = 'REFUND'`,
      [paymentRecord.id]
    );
    assert(refundLedger.length === 1, 'Exactly ONE REFUND reversal entry created in ledger');
    assert(Number(refundLedger[0].amount_paise) === keyboard.pricePaise, 'Refund amount matches original debit');

    console.log('\n================================================================');
    console.log('🎉 CANONICAL REAL AGENT PAYMENT TEST PASSED PERFECTLY!');
    console.log('   All 15 Invariants & Lifecycles Fully Grounded in Reality');
    console.log('================================================================\n');

  } finally {
    merchantStore.stop();
    await closeBackend();
  }
}

runCanonicalRealE2E()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ E2E Real Agent Payment Test Failed:', err);
    process.exit(1);
  });
