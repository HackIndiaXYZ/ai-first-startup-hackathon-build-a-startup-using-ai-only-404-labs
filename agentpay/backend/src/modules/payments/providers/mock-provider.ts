// Production-Quality Deterministic Mock Payment Provider
// Strictly implements IPaymentProvider for testing, local development, and QA.

import * as crypto from 'crypto';
import {
  IPaymentProvider,
  ProviderPaymentRequest,
  ProviderPaymentResult,
  NormalizedWebhookEvent,
  ProviderConfigRecord,
  PaymentProviderCapabilities,
  ProviderRefundRequest,
  ProviderRefundResult,
} from './provider.interface';
import { PaymentRail } from '../domain/payment.entity';

export class MockPaymentProvider implements IPaymentProvider {
  public readonly name = 'Mock Provider';
  public readonly providerType = 'mock';
  public readonly supportedRails: readonly PaymentRail[] = [
    'mock',
    'upi',
    'card',
    'bank_transfer',
    'upi_autopay',
    'card_mandate',
    'pre_auth',
  ];

  getCapabilities(): PaymentProviderCapabilities {
    return {
      supportsAgentInitiatedPayment: true,
      supportsDelegatedAuthorization: true,
      supportsPreAuthorization: true,
      supportsUPI: true,
      supportsCards: true,
      supportsRefund: true,
      supportsWebhook: true,
      supportsReconciliation: true,
      requiresUserInteraction: false,
      supportsSandbox: true,
      railEnvironment: 'MOCK',
    };
  }

  // In-memory status store to simulate real provider state retention for reconciliation
  private static readonly stateStore = new Map<string, ProviderPaymentResult>();

  // Real execution call counters to detect any duplicate provider dispatches
  public static executionCount: number = 0;
  public static executionsByPaymentId = new Map<string, number>();

  static getExecutionCount(paymentId?: string): number {
    if (paymentId) return this.executionsByPaymentId.get(paymentId) || 0;
    return this.executionCount;
  }

  static resetExecutionCounts(): void {
    this.executionCount = 0;
    this.executionsByPaymentId.clear();
  }

  async executePayment(
    request: ProviderPaymentRequest,
    _config: ProviderConfigRecord
  ): Promise<ProviderPaymentResult> {
    // Increment provider execution counter
    MockPaymentProvider.executionCount++;
    const prevCount = MockPaymentProvider.executionsByPaymentId.get(request.paymentId) || 0;
    MockPaymentProvider.executionsByPaymentId.set(request.paymentId, prevCount + 1);

    const providerPaymentId = `mock_pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Deterministic simulation via metadata (for test scenarios):
    // metadata: { mock_outcome: 'succeeded' | 'failed' | 'unknown' }
    const forcedOutcome = (request.metadata?.mock_outcome as string)?.toLowerCase();

    let result: ProviderPaymentResult;

    if (forcedOutcome === 'unknown' || forcedOutcome === 'timeout') {
      // ⚠️ Financial Invariant Test: Ambiguous / Network timeout state
      result = {
        providerPaymentId,
        status: 'unknown',
        providerStatus: 'GATEWAY_TIMEOUT',
        errorCode: 'TIMEOUT',
        errorDescription: 'Provider did not respond within deadline. Transaction state uncertain.',
        rawResponse: {
          simulated: true,
          error: 'ETIMEDOUT',
          message: 'Connection timed out while querying banking switch.',
        },
      };
    } else if (forcedOutcome === 'failed') {
      result = {
        providerPaymentId,
        status: 'failed',
        providerStatus: 'DECLINED_BY_BANK',
        errorCode: 'INSUFFICIENT_FUNDS',
        errorDescription: 'Bank declined transaction: Insufficient balance or account limit exceeded.',
        rawResponse: {
          simulated: true,
          response_code: 'U16',
          status: 'FAILURE',
        },
      };
    } else {
      // Default: Succeeded
      result = {
        providerPaymentId,
        status: 'succeeded',
        providerStatus: 'SETTLED',
        settledAt: new Date().toISOString(),
        rawResponse: {
          simulated: true,
          rrn: `mock_rrn_${Date.now()}`,
          upi_trans_ref: `mock_upi_${crypto.randomBytes(6).toString('hex')}`,
          status: 'SUCCESS',
        },
      };
    }

    MockPaymentProvider.stateStore.set(providerPaymentId, result);
    return result;
  }

  async getPaymentStatus(
    providerPaymentId: string,
    _config: ProviderConfigRecord
  ): Promise<ProviderPaymentResult> {
    const existing = MockPaymentProvider.stateStore.get(providerPaymentId);
    if (existing) {
      // If the existing payment was UNKNOWN, reconciliation resolves it to SUCCEEDED or FAILED
      if (existing.status === 'unknown') {
        const resolved: ProviderPaymentResult = {
          ...existing,
          status: 'succeeded',
          providerStatus: 'SETTLED_AFTER_RECONCILIATION',
          settledAt: new Date().toISOString(),
          errorDescription: undefined,
          errorCode: undefined,
        };
        MockPaymentProvider.stateStore.set(providerPaymentId, resolved);
        return resolved;
      }
      return existing;
    }

    // Default simulated lookup
    return {
      providerPaymentId,
      status: 'succeeded',
      providerStatus: 'SETTLED',
      settledAt: new Date().toISOString(),
      rawResponse: { reconciled: true, status: 'SUCCESS' },
    };
  }

  verifyWebhookSignature(
    rawPayload: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): boolean {
    const signature = headers['x-frame-mock-signature'] || headers['x-provider-signature'];
    if (!signature || typeof signature !== 'string') {
      return false;
    }

    const expected = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  normalizeWebhookEvent(rawPayload: Record<string, unknown>): NormalizedWebhookEvent {
    const eventId = (rawPayload.event_id as string) || `evt_${Date.now()}`;
    const eventType = (rawPayload.event_type as string) || 'payment.updated';
    const providerPaymentId = (rawPayload.provider_payment_id as string) || (rawPayload.payment_id as string) || '';
    const rawStatus = ((rawPayload.status as string) || 'SUCCESS').toUpperCase();

    let status: 'succeeded' | 'failed' | 'unknown' = 'unknown';
    if (rawStatus === 'SUCCESS' || rawStatus === 'SUCCEEDED' || rawStatus === 'SETTLED' || rawStatus === 'CAPTURED') {
      status = 'succeeded';
    } else if (rawStatus === 'FAILED' || rawStatus === 'DECLINED' || rawStatus === 'ERROR') {
      status = 'failed';
    }

    return {
      eventId,
      eventType,
      providerPaymentId,
      status,
      providerStatus: rawStatus,
      amountPaise: typeof rawPayload.amount === 'number' ? rawPayload.amount : undefined,
      currency: (rawPayload.currency as string) || 'INR',
      rawPayload,
      timestamp: (rawPayload.created_at as string) || new Date().toISOString(),
    };
  }

  async refundPayment(
    request: ProviderRefundRequest,
    _config: ProviderConfigRecord
  ): Promise<ProviderRefundResult> {
    const refundId = `rfnd_${request.refundId || Date.now()}`;
    return {
      providerRefundId: refundId,
      providerPaymentId: request.providerPaymentId,
      status: 'succeeded',
      providerStatus: 'REFUNDED',
      amountPaise: request.amountPaise,
      currency: request.currency || 'INR',
      rawResponse: { id: refundId, entity: 'refund', amount: request.amountPaise },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Helper for tests to pre-seed or reset simulated provider states.
   */
  static setMockState(providerPaymentId: string, result: ProviderPaymentResult): void {
    this.stateStore.set(providerPaymentId, result);
  }

  static clearMockStates(): void {
    this.stateStore.clear();
  }
}
