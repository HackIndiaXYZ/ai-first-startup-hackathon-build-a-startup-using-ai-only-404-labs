// Provider Registry & Factory
// Dynamically resolves and manages payment provider adapters.

import { IPaymentProvider, ProviderConfigRecord } from './provider.interface';
import { MockPaymentProvider } from './mock-provider';
import { RazorpayPaymentProvider } from './razorpay-provider';
import { db } from '../../../db';

export class ProviderNotFoundError extends Error {
  constructor(public readonly providerType: string) {
    super(`Payment provider "${providerType}" is not registered in the system.`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderRegistry {
  private static readonly providers = new Map<string, IPaymentProvider>();

  static {
    // Register built-in providers
    this.register(new MockPaymentProvider());
    this.register(new RazorpayPaymentProvider());
  }

  static register(provider: IPaymentProvider): void {
    this.providers.set(provider.providerType.toLowerCase(), provider);
  }

  static get(providerType: string): IPaymentProvider {
    const provider = this.providers.get(providerType.toLowerCase());
    if (!provider) {
      throw new ProviderNotFoundError(providerType);
    }
    return provider;
  }

  static listAvailable(): Array<{ providerType: string; name: string; supportedRails: readonly string[] }> {
    return Array.from(this.providers.values()).map(p => ({
      providerType: p.providerType,
      name: p.name,
      supportedRails: p.supportedRails,
    }));
  }

  /**
   * Resolves the active provider adapter and configuration for a given organization.
   * If the organization has not explicitly configured a production/sandbox provider,
   * cleanly falls back to the deterministic MockPaymentProvider.
   */
  static async resolveActiveProvider(
    organizationId: string
  ): Promise<{ provider: IPaymentProvider; config: ProviderConfigRecord }> {
    const { rows } = await db.query(
      `SELECT * FROM provider_configs
       WHERE organization_id = $1 AND status = 'active'
       ORDER BY is_default DESC, created_at DESC
       LIMIT 1`,
      [organizationId]
    );

    if (rows.length > 0) {
      const config: ProviderConfigRecord = rows[0];
      const provider = this.get(config.provider_type);
      return { provider, config };
    }

    // Default Fallback: Organization uses the default configured provider (mock or razorpay)
    const defaultType = (process.env.DEFAULT_PAYMENT_PROVIDER || 'mock').toLowerCase();
    const defaultProvider = this.get(defaultType);
    const fallbackConfig: ProviderConfigRecord = {
      id: `default_${defaultType}_${organizationId}`,
      organization_id: organizationId,
      provider_type: defaultType,
      name: defaultType === 'razorpay' ? 'Default Razorpay Sandbox Provider' : 'System Default Mock Provider',
      is_default: true,
      status: 'active',
      api_key: process.env.RAZORPAY_KEY_ID || null,
      api_secret: process.env.RAZORPAY_KEY_SECRET || null,
      webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret_default',
      settings: {},
    };

    return { provider: defaultProvider, config: fallbackConfig };
  }
}
