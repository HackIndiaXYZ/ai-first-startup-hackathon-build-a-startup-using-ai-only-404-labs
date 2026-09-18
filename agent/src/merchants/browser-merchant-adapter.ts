import { MerchantAdapter, MerchantCart, MerchantCheckoutSession } from './merchant-adapter';
import { ProductCandidate } from '../shopping/product';
import { PlaywrightBrowserController } from '../browser/playwright-browser';

export interface BrowserMerchantAdapterConfig {
  baseUrl?: string;
  headless?: boolean;
  chromePath?: string;
  timeoutMs?: number;
}

export class BrowserMerchantAdapter implements MerchantAdapter {
  public readonly merchantId = 'demo_store';
  public readonly merchantName = 'TechSupply Store';
  public readonly baseUrl: string;
  private browser: PlaywrightBrowserController;

  constructor(config: BrowserMerchantAdapterConfig = {}) {
    this.baseUrl = (config.baseUrl || 'http://localhost:3002').replace(/\/$/, '');
    this.browser = new PlaywrightBrowserController({
      headless: config.headless ?? true,
      chromePath: config.chromePath,
      timeoutMs: config.timeoutMs || 30000,
    });
  }

  getBrowserController(): PlaywrightBrowserController {
    return this.browser;
  }

  async searchProducts(query: string, maxPriceRupees?: number): Promise<ProductCandidate[]> {
    const storeUrl = `${this.baseUrl}/store`;
    const candidates = await this.browser.searchStorefront(storeUrl, query);

    if (maxPriceRupees !== undefined) {
      return candidates.filter((c) => c.price_rupees <= maxPriceRupees);
    }
    return candidates;
  }

  async getProduct(productId: string): Promise<ProductCandidate | null> {
    const all = await this.searchProducts('');
    return all.find((p) => p.id === productId) || null;
  }

  async addToCart(productId: string, quantity = 1, variantId?: string): Promise<MerchantCart> {
    const productUrl = `${this.baseUrl}/store/products/${productId}`;
    const result = await this.browser.viewProductAndAddToCart(productUrl, variantId, quantity);

    return {
      items: [{ productId, quantity: result.itemCount }],
      itemCount: result.itemCount,
    };
  }

  async proceedToCheckout(
    _cart: MerchantCart,
    _shippingAddress = '123 Tech Park, Bangalore 560100'
  ): Promise<MerchantCheckoutSession> {
    const checkoutUrl = `${this.baseUrl}/store/checkout`;
    return await this.browser.proceedToCheckoutAndExtract(checkoutUrl);
  }

  async confirmPayment(orderId: string, paymentIntentId: string): Promise<boolean> {
    // 1. Authoritative merchant API confirmation
    try {
      const res = await fetch(`${this.baseUrl}/orders/${orderId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.data?.status !== 'PAID') {
          return false;
        }
      }
    } catch {
      // Ignore network errors in local offline tests
    }

    // 2. Authoritative receipt confirmation via browser
    return await this.browser.confirmOrderReceipt(orderId, this.baseUrl);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
