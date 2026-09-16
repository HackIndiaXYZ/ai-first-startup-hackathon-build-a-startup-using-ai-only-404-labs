// Real Payment Rail & Capabilities Verification Test Suite
// Verifies MOCK vs SANDBOX vs REAL_PRODUCTION differentiation and provider capabilities enforcement.

import { ulid } from 'ulid';
import { db } from '../../src/db';
import { ProviderRegistry } from '../../src/modules/payments/providers/provider-registry';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-provider';
import { RazorpayPaymentProvider } from '../../src/modules/payments/providers/razorpay-provider';
import { PaymentOrchestrator } from '../../src/modules/payments/orchestrator/payment-orchestrator';
import {
  IPaymentProvider,
  PaymentProviderCapabilities,
  ProviderPaymentRequest,
  ProviderPaymentResult,
  NormalizedWebhookEvent,
  ProviderConfigRecord,
} from '../../src/modules/payments/providers/provider.interface';
import { PaymentRail } from '../../src/modules/payments/domain/payment.entity';
import { computeCanonicalIntentHash } from '../../src/modules/payments/domain/intent-hasher';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runRailTests(): Promise<void> {
  console.log('\n================================================================');
  console.log('💳 RUNNING REAL PAYMENT RAIL & CAPABILITIES TEST SUITE');
  console.log('   Environment Labeling: MOCK vs SANDBOX vs REAL_PRODUCTION');
  console.log('================================================================\n');

  // ── TEST 1: Mock Provider Capabilities & Environment Tagging ──
  console.log('--- 1. MOCK PROVIDER CAPABILITIES & ENVIRONMENT TAGGING ---');
  const mockProvider = ProviderRegistry.get('mock');
  const mockCaps: PaymentProviderCapabilities = mockProvider.getCapabilities();

  assert(mockCaps.railEnvironment === 'MOCK', 'Mock provider strictly labeled as MOCK (never masquerading as REAL)');
  assert(mockCaps.supportsAgentInitiatedPayment === true, 'Mock supports agent-initiated testing');
  assert(mockCaps.supportsDelegatedAuthorization === true, 'Mock supports delegated authorization');
  assert(mockCaps.supportsSandbox === true, 'Mock provider supports sandbox simulation');
  assert(mockCaps.requiresUserInteraction === false, 'Mock provider requires no physical device interaction');

  // ── TEST 2: Razorpay Provider Capabilities & Rail Environment ─
  console.log('\n--- 2. RAZORPAY PROVIDER CAPABILITIES & SANDBOX ISOLATION ---');
  const razorpayProvider = ProviderRegistry.get('razorpay');
  const rzpCaps: PaymentProviderCapabilities = razorpayProvider.getCapabilities();

  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const expectedEnv = keyId.startsWith('rzp_live_') ? 'REAL_PRODUCTION' : 'SANDBOX';
  assert(rzpCaps.railEnvironment === expectedEnv, `Razorpay correctly tagged as ${expectedEnv} based on credential inspection`);
  assert(rzpCaps.supportsDelegatedAuthorization === true, 'Razorpay declares legitimate delegated authorization support (e-mandates/subscriptions)');
  assert(rzpCaps.supportsPreAuthorization === true, 'Razorpay declares pre-authorization support (auth & capture)');
  assert(rzpCaps.supportsUPI === true, 'Razorpay declares UPI support');
  assert(rzpCaps.supportsCards === true, 'Razorpay declares Card support');

  // ── TEST 3: Unsupported Rail Rejection (No Silent Fallback) ───
  console.log('\n--- 3. UNSUPPORTED RAIL REJECTION (NO SILENT FALLBACK) ---');
  // Create a restricted test provider that only supports 'card_mandate'
  class RestrictedProvider implements IPaymentProvider {
    readonly name = 'Restricted Card Provider';
    readonly providerType = 'restricted_test';
    readonly supportedRails: readonly PaymentRail[] = ['card_mandate'];

    getCapabilities(): PaymentProviderCapabilities {
      return {
        supportsAgentInitiatedPayment: true,
        supportsDelegatedAuthorization: true,
        supportsPreAuthorization: false,
        supportsUPI: false,
        supportsCards: true,
        supportsRefund: false,
        supportsWebhook: false,
        supportsReconciliation: false,
        requiresUserInteraction: false,
        supportsSandbox: true,
        railEnvironment: 'MOCK',
      };
    }

    async executePayment(_request: ProviderPaymentRequest, _config: ProviderConfigRecord): Promise<ProviderPaymentResult> {
      throw new Error('Should not reach executePayment');
    }
    async getPaymentStatus(_providerPaymentId: string, _config: ProviderConfigRecord): Promise<ProviderPaymentResult> {
      throw new Error('Not implemented');
    }
    verifyWebhookSignature(_rawPayload: string, _headers: Record<string, string | string[] | undefined>, _secret: string): boolean {
      return true;
    }
    normalizeWebhookEvent(_rawPayload: Record<string, unknown>): NormalizedWebhookEvent {
      throw new Error('Not implemented');
    }
  }

  ProviderRegistry.register(new RestrictedProvider());

  // Setup test org with restricted provider
  const testOrgId = ulid();
  const testAgentId = ulid();
  await db.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Restricted Rail Org', $2)`, [testOrgId, `org-rail-${Date.now()}`]);
  await db.query(`INSERT INTO agents (id, organization_id, name) VALUES ($1, $2, 'Rail Test Agent')`, [testAgentId, testOrgId]);
  await db.query(
    `INSERT INTO provider_configs (id, organization_id, provider_type, name, is_default, status)
     VALUES ($1, $2, 'restricted_test', 'Restricted Rail Provider', true, 'active')`,
    [ulid(), testOrgId]
  );

  // Create an authorized intent requesting 'upi' rail
  const intentId = ulid();
  const idemKey1 = `idem_rail_${Date.now()}`;
  const hash1 = computeCanonicalIntentHash({
    organization_id: testOrgId,
    agent_id: testAgentId,
    amount_paise: 10000,
    currency: 'INR',
    merchant: 'Demo Store',
    purpose: 'Rail test',
    idempotency_key: idemKey1,
  });
  await db.query(
    `INSERT INTO payment_intents (
      id, organization_id, agent_id, amount_paise, currency, merchant, purpose, intent_hash, idempotency_key, status
    ) VALUES ($1, $2, $3, 10000, 'INR', 'Demo Store', 'Rail test', $4, $5, 'AUTHORIZED')`,
    [intentId, testOrgId, testAgentId, hash1, idemKey1]
  );

  // Attempt to execute with unsupported rail 'upi' on restricted provider
  const paymentResult = await PaymentOrchestrator.executeIntent(intentId, testOrgId, { rail: 'upi' });
  assert(paymentResult.payment.status === 'failed', 'Execution failed immediately for unsupported rail');
  assert(paymentResult.payment.error_code === 'UNSUPPORTED_PAYMENT_RAIL', 'Deterministic error UNSUPPORTED_PAYMENT_RAIL returned');
  assert(
    paymentResult.payment.error_description?.includes('does not support payment rail "upi"') === true,
    'Clear explanation that provider does not support rail'
  );

  // ── TEST 4: Unsupported Agent-Initiated Payment Rejection ─────
  console.log('\n--- 4. UNSUPPORTED AGENT-INITIATED CAPABILITY REJECTION ---');
  class ManualUserOnlyProvider implements IPaymentProvider {
    readonly name = 'Manual Interactive Provider';
    readonly providerType = 'manual_only';
    readonly supportedRails: readonly PaymentRail[] = ['upi', 'card'];

    getCapabilities(): PaymentProviderCapabilities {
      return {
        supportsAgentInitiatedPayment: false, // Disallows autonomous agent execution
        supportsDelegatedAuthorization: false,
        supportsPreAuthorization: false,
        supportsUPI: true,
        supportsCards: true,
        supportsRefund: true,
        supportsWebhook: true,
        supportsReconciliation: true,
        requiresUserInteraction: true,
        supportsSandbox: true,
        railEnvironment: 'SANDBOX',
      };
    }

    async executePayment(_request: ProviderPaymentRequest, _config: ProviderConfigRecord): Promise<ProviderPaymentResult> {
      throw new Error('Should not reach executePayment');
    }
    async getPaymentStatus(_providerPaymentId: string, _config: ProviderConfigRecord): Promise<ProviderPaymentResult> {
      throw new Error('Not implemented');
    }
    verifyWebhookSignature(_rawPayload: string, _headers: Record<string, string | string[] | undefined>, _secret: string): boolean {
      return true;
    }
    normalizeWebhookEvent(_rawPayload: Record<string, unknown>): NormalizedWebhookEvent {
      throw new Error('Not implemented');
    }
  }

  ProviderRegistry.register(new ManualUserOnlyProvider());

  await db.query(`UPDATE provider_configs SET provider_type = 'manual_only' WHERE organization_id = $1`, [testOrgId]);

  const intent2Id = ulid();
  const idemKey2 = `idem_manual_${Date.now()}`;
  const hash2 = computeCanonicalIntentHash({
    organization_id: testOrgId,
    agent_id: testAgentId,
    amount_paise: 10000,
    currency: 'INR',
    merchant: 'Demo Store',
    purpose: 'Manual only test',
    idempotency_key: idemKey2,
  });
  await db.query(
    `INSERT INTO payment_intents (
      id, organization_id, agent_id, amount_paise, currency, merchant, purpose, intent_hash, idempotency_key, status
    ) VALUES ($1, $2, $3, 10000, 'INR', 'Demo Store', 'Manual only test', $4, $5, 'AUTHORIZED')`,
    [intent2Id, testOrgId, testAgentId, hash2, idemKey2]
  );

  const payment2Result = await PaymentOrchestrator.executeIntent(intent2Id, testOrgId);
  assert(payment2Result.payment.status === 'failed', 'Execution rejected when provider lacks supportsAgentInitiatedPayment');
  assert(payment2Result.payment.error_code === 'UNSUPPORTED_PROVIDER_CAPABILITY', 'Deterministic error UNSUPPORTED_PROVIDER_CAPABILITY returned');

  console.log('\n================================================================');
  console.log('🎉 ALL PAYMENT RAIL CAPABILITY CHECKS PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runRailTests().catch(err => {
  console.error('Rail Capabilities Test Failed:', err);
  process.exit(1);
});
