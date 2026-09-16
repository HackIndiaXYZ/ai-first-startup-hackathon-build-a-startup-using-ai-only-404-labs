// Payment Provider Abstraction Interface
// Frame owns this contract. No provider-specific types leak into the core engine.

import { PaymentExecutionStatus, PaymentRail } from '../domain/payment.entity';

export interface ProviderPaymentRequest {
  paymentId: string;
  intentId: string;
  organizationId: string;
  amountPaise: number;
  currency: string;
  merchant: string;
  merchantReference?: string | null;
  purpose: string;
  taskReference?: string | null;
  rail: PaymentRail;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderPaymentResult {
  providerPaymentId: string;
  status: PaymentExecutionStatus;
  providerStatus: string;
  errorCode?: string | null;
  errorDescription?: string | null;
  rawResponse: Record<string, unknown>;
  settledAt?: Date | string | null;
  metadata?: Record<string, unknown>;
}

export interface NormalizedWebhookEvent {
  eventId: string;
  eventType: string;
  providerPaymentId: string;
  status: PaymentExecutionStatus;
  providerStatus: string;
  amountPaise?: number;
  currency?: string;
  rawPayload: Record<string, unknown>;
  timestamp: Date | string;
}

export interface ProviderConfigRecord {
  id: string;
  organization_id: string;
  provider_type: string;
  name: string;
  is_default: boolean;
  status: 'active' | 'disabled';
  api_key?: string | null;
  api_secret?: string | null;
  credentials_encrypted?: string | null;
  webhook_secret?: string | null;
  settings?: Record<string, unknown>;
}

export interface PaymentProviderCapabilities {
  supportsAgentInitiatedPayment: boolean;
  supportsDelegatedAuthorization: boolean;
  supportsPreAuthorization: boolean;
  supportsUPI: boolean;
  supportsCards: boolean;
  supportsRefund: boolean;
  supportsWebhook: boolean;
  supportsReconciliation: boolean;
  requiresUserInteraction: boolean;
  supportsSandbox: boolean;
  railEnvironment: 'MOCK' | 'SANDBOX' | 'REAL_PRODUCTION';
}

export interface IPaymentProvider {
  readonly name: string;
  readonly providerType: string;
  readonly supportedRails: readonly PaymentRail[];

  /**
   * Returns the explicit capabilities supported by this payment provider.
   */
  getCapabilities(): PaymentProviderCapabilities;

  /**
   * Dispatches payment execution to the payment rail / provider API.
   * If network timeout or ambiguous response occurs, MUST return status: 'unknown'.
   */
  executePayment(
    request: ProviderPaymentRequest,
    config: ProviderConfigRecord
  ): Promise<ProviderPaymentResult>;

  /**
   * Inquires provider for the current ground-truth status of a transaction.
   */
  getPaymentStatus(
    providerPaymentId: string,
    config: ProviderConfigRecord
  ): Promise<ProviderPaymentResult>;

  /**
   * Cryptographically verifies inbound webhook signature.
   */
  verifyWebhookSignature(
    rawPayload: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): boolean;

  /**
   * Translates raw provider-specific webhook payload into Frame's normalized event model.
   */
  normalizeWebhookEvent(
    rawPayload: Record<string, unknown>
  ): NormalizedWebhookEvent;

  /**
   * Dispatches refund for a settled payment to the payment provider.
   */
  refundPayment?(
    request: ProviderRefundRequest,
    config: ProviderConfigRecord
  ): Promise<ProviderRefundResult>;
}

export interface ProviderRefundRequest {
  refundId: string;
  paymentId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
  reason?: string;
  idempotencyKey: string;
  notes?: Record<string, string>;
}

export interface ProviderRefundResult {
  providerRefundId: string;
  providerPaymentId: string;
  status: 'succeeded' | 'failed' | 'processing' | 'unknown';
  providerStatus: string;
  amountPaise: number;
  currency: string;
  errorCode?: string | null;
  errorDescription?: string | null;
  rawResponse: Record<string, unknown>;
  createdAt?: Date | string | null;
}
