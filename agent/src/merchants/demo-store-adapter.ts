import { MerchantAdapter, MerchantCart, MerchantCheckoutSession } from './merchant-adapter';
import { ProductCandidate } from '../shopping/product';
import { scanUntrustedContent } from '../security/prompt-injection';

const FALLBACK_PRODUCTS = [
  { id: 'prod_kbd_01', name: 'Keychron C3 Mechanical Keyboard', description: 'Hot-swappable RGB mechanical keyboard', price: 2499, pricePaise: 249900, category: 'electronics', inStock: true },
  { id: 'prod_chair_02', name: 'Ergonomic Office Chair Pro', description: 'High-back mesh ergonomic lumbar support desk chair', price: 2799, pricePaise: 279900, category: 'office', inStock: true },
  { id: 'prod_mouse_03', name: 'Logitech Precision Wireless Mouse', description: 'Ergonomic 4000 DPI multi-device wireless laser mouse', price: 1499, pricePaise: 149900, category: 'electronics', inStock: true },
  { id: 'prod_chips_04', name: 'Casino Royale VIP Chips Pack', description: 'High-stakes gaming chips set with aluminum carrying case', price: 2499, pricePaise: 249900, category: 'gambling', inStock: true },
  { id: 'prod_server_05', name: 'Enterprise GPU Server Rack', description: 'High density compute server rack unit for AI workloads', price: 9999, pricePaise: 999900, category: 'infrastructure', inStock: true },
];

export class DemoStoreMerchantAdapter implements MerchantAdapter {
  public readonly merchantId = 'demo_store';
  public readonly merchantName = 'TechSupply Store';
  public readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:3002') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async searchProducts(query: string, maxPriceRupees?: number): Promise<ProductCandidate[]> {
    let rawProducts: any[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/products`);
      if (res.ok) {
        const json = (await res.json()) as any;
        rawProducts = json.data || [];
      } else {
        rawProducts = FALLBACK_PRODUCTS;
      }
    } catch {
      rawProducts = FALLBACK_PRODUCTS;
    }

    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

    return rawProducts
      .map((p) => {
        // Untrusted content scan
        scanUntrustedContent(p.description || '', false);

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          price_rupees: p.price,
          price_paise: p.pricePaise || p.price * 100,
          currency: 'INR',
          category: p.category,
          in_stock: p.inStock ?? true,
          merchant_id: this.merchantId,
          merchant_name: this.merchantName,
          url: `${this.baseUrl}/products/${p.id}`,
        };
      })
      .filter((p) => {
        if (maxPriceRupees !== undefined && p.price_rupees > maxPriceRupees) {
          return false;
        }
        if (queryTerms.length === 0) return true;
        const text = `${p.name} ${p.description} ${p.category}`.toLowerCase();
        return queryTerms.some((t) => text.includes(t));
      });
  }

  async getProduct(productId: string): Promise<ProductCandidate | null> {
    const products = await this.searchProducts('');
    return products.find((p) => p.id === productId) || null;
  }

  async addToCart(productId: string, quantity = 1): Promise<MerchantCart> {
    return {
      items: [{ productId, quantity: Math.max(1, quantity) }],
      itemCount: Math.max(1, quantity),
    };
  }

  async proceedToCheckout(
    cart: MerchantCart,
    shippingAddress = '123 Tech Park, Bangalore 560100'
  ): Promise<MerchantCheckoutSession> {
    try {
      const res = await fetch(`${this.baseUrl}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.items,
          shippingAddress,
        }),
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        const order = json.data;
        const subtotalPaise = order.totalPaise;
        const shippingPaise = 0;
        const taxPaise = 0;
        const totalPaise = subtotalPaise + shippingPaise + taxPaise;

        return {
          orderId: order.orderId,
          merchantId: this.merchantId,
          merchantName: this.merchantName,
          items: order.items.map((i: any) => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            priceRupees: i.price,
            pricePaise: i.pricePaise,
            category: i.category,
          })),
          subtotalRupees: subtotalPaise / 100,
          subtotalPaise,
          shippingRupees: 0,
          shippingPaise: 0,
          taxRupees: 0,
          taxPaise: 0,
          totalRupees: totalPaise / 100,
          totalPaise,
          currency: 'INR',
          checkoutUrl: `${this.baseUrl}/orders/${order.orderId}`,
          status: order.status,
        };
      }
    } catch {
      // Fallback
    }

    // Local deterministic order creation
    const item = cart.items[0];
    const product = FALLBACK_PRODUCTS.find((p) => p.id === item?.productId) || FALLBACK_PRODUCTS[0];
    const qty = item?.quantity || 1;
    const subtotalPaise = product.pricePaise * qty;
    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    return {
      orderId,
      merchantId: this.merchantId,
      merchantName: this.merchantName,
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity: qty,
          priceRupees: product.price,
          pricePaise: product.pricePaise,
          category: product.category,
        },
      ],
      subtotalRupees: subtotalPaise / 100,
      subtotalPaise,
      shippingRupees: 0,
      shippingPaise: 0,
      taxRupees: 0,
      taxPaise: 0,
      totalRupees: subtotalPaise / 100,
      totalPaise: subtotalPaise,
      currency: 'INR',
      checkoutUrl: `${this.baseUrl}/orders/${orderId}`,
      status: 'AWAITING_PAYMENT',
    };
  }

  async confirmPayment(orderId: string, paymentIntentId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/orders/${orderId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        return json.data?.status === 'PAID';
      }
    } catch {
      // Offline fallback confirms order
      return true;
    }
    return true;
  }
}
