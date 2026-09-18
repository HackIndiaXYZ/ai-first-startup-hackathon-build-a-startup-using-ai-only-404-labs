import { ProductCandidate } from '../shopping/product';
import { scanUntrustedContent } from '../security/prompt-injection';

export interface SemanticPageData {
  title: string;
  merchantId?: string;
  merchantName?: string;
  products: ProductCandidate[];
  isCheckoutPage: boolean;
  checkoutTotals?: {
    subtotal: number;
    shipping: number;
    tax: number;
    total: number;
    currency: string;
  };
}

/**
 * Extracts semantic shopping data from raw HTML without dumping arbitrary messy text.
 */
export function extractSemanticPageData(html: string, pageUrl?: string): SemanticPageData {
  const scan = scanUntrustedContent(html);

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Storefront';

  // Extract merchant ID meta
  const merchantIdMatch = html.match(/<meta\s+name=["']merchant-id["']\s+content=["']([^"']+)["']/i);
  const merchantId = merchantIdMatch ? merchantIdMatch[1] : 'unknown_merchant';

  const products: ProductCandidate[] = [];

  // Match standard semantic product cards: data-product-id, data-price, data-category
  const cardRegex = /<div[^>]*class=["'][^"']*product-card[^"']*["'][^>]*data-product-id=["']([^"']+)["'][^>]*data-category=["']([^"']+)["'][^>]*data-price=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const id = match[1];
    const category = match[2];
    const priceRupees = parseFloat(match[3]);
    const inner = match[4];

    const nameMatch = inner.match(/<h[234][^>]*>([^<]+)<\/h[234]>/i);
    const descMatch = inner.match(/<p[^>]*>([^<]+)<\/p>/i);

    const name = nameMatch ? nameMatch[1].trim() : 'Product';
    const description = descMatch ? descMatch[1].trim() : '';

    products.push({
      id,
      name,
      description,
      price_rupees: priceRupees,
      price_paise: Math.round(priceRupees * 100),
      currency: 'INR',
      category,
      in_stock: true,
      merchant_id: merchantId,
      merchant_name: title,
      url: pageUrl,
    });
  }

  const isCheckoutPage = /checkout|cart-summary|order-summary/i.test(html);

  return {
    title,
    merchantId,
    merchantName: title,
    products,
    isCheckoutPage,
  };
}
