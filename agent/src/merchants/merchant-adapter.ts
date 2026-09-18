import { ProductCandidate } from '../shopping/product';

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface MerchantCart {
  items: CartItem[];
  itemCount: number;
}

export interface MerchantCheckoutSession {
  orderId: string;
  merchantId: string;
  merchantName: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    priceRupees: number;
    pricePaise: number;
    category: string;
  }[];
  subtotalRupees: number;
  subtotalPaise: number;
  shippingRupees: number;
  shippingPaise: number;
  taxRupees: number;
  taxPaise: number;
  totalRupees: number;
  totalPaise: number;
  currency: string;
  checkoutUrl?: string;
  status: 'AWAITING_PAYMENT' | 'PAID' | 'FULFILLED' | 'CANCELLED';
}

export interface MerchantAdapter {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly baseUrl: string;

  searchProducts(query: string, maxPriceRupees?: number): Promise<ProductCandidate[]>;
  getProduct(productId: string): Promise<ProductCandidate | null>;
  addToCart(productId: string, quantity?: number): Promise<MerchantCart>;
  proceedToCheckout(cart: MerchantCart, shippingAddress?: string): Promise<MerchantCheckoutSession>;
  confirmPayment(orderId: string, paymentIntentId: string): Promise<boolean>;
}
