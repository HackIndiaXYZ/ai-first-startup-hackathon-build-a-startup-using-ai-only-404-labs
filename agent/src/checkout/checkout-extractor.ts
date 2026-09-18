import { MerchantCheckoutSession } from '../merchants/merchant-adapter';

export interface CanonicalCheckout {
  merchant_id: string;
  merchant_name: string;
  order_id: string;
  product_id: string;
  product_name: string;
  category: string;
  quantity: number;
  subtotal_paise: number;
  shipping_paise: number;
  tax_paise: number;
  discount_paise: number;
  total_paise: number;
  total_rupees: number;
  currency: string;
  checkout_url?: string;
  purpose: string;
  extracted_at: string;
}

export function canonicalizeCheckout(
  session: MerchantCheckoutSession,
  overridePurpose?: string
): CanonicalCheckout {
  if (!session.items || session.items.length === 0) {
    throw new Error('Cannot canonicalize empty checkout session');
  }

  const primaryItem = session.items[0];
  const subtotalPaise = session.subtotalPaise;
  const shippingPaise = session.shippingPaise || 0;
  const taxPaise = session.taxPaise || 0;
  const discountPaise = 0;
  const totalPaise = subtotalPaise + shippingPaise + taxPaise - discountPaise;

  return {
    merchant_id: session.merchantId,
    merchant_name: session.merchantName,
    order_id: session.orderId,
    product_id: primaryItem.productId,
    product_name: primaryItem.productName,
    category: primaryItem.category,
    quantity: primaryItem.quantity,
    subtotal_paise: subtotalPaise,
    shipping_paise: shippingPaise,
    tax_paise: taxPaise,
    discount_paise: discountPaise,
    total_paise: totalPaise,
    total_rupees: totalPaise / 100,
    currency: session.currency || 'INR',
    checkout_url: session.checkoutUrl,
    purpose: overridePurpose || `Purchase ${primaryItem.productName} from ${session.merchantName}`,
    extracted_at: new Date().toISOString(),
  };
}
