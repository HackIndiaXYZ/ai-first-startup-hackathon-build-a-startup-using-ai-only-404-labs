import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import fs from 'fs';
import { ProductCandidate } from '../shopping/product';
import { MerchantCheckoutSession } from '../merchants/merchant-adapter';
import { scanUntrustedContent } from '../security/prompt-injection';
import { assertAllowedMerchantDomain } from '../security/domain-policy';

export interface PlaywrightBrowserConfig {
  headless?: boolean;
  chromePath?: string;
  timeoutMs?: number;
  viewport?: { width: number; height: number };
}

const DEFAULT_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

export class PlaywrightBrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: PlaywrightBrowserConfig;

  constructor(config: PlaywrightBrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      timeoutMs: config.timeoutMs || 30000,
      viewport: config.viewport || { width: 1280, height: 800 },
      ...config,
    };
  }

  private resolveChromeExecutable(): string {
    if (this.config.chromePath && fs.existsSync(this.config.chromePath)) {
      return this.config.chromePath;
    }
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
      return process.env.CHROME_BIN;
    }
    for (const path of DEFAULT_CHROME_PATHS) {
      if (fs.existsSync(path)) {
        return path;
      }
    }
    throw new Error('Google Chrome binary not found for Playwright automation.');
  }

  async initialize(): Promise<Page> {
    if (this.page) return this.page;

    const executablePath = this.resolveChromeExecutable();
    this.browser = await chromium.launch({
      executablePath,
      headless: this.config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
      userAgent: 'Frame-Autonomous-AI-Agent/1.0 (Playwright Browser Layer)',
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeoutMs || 30000);
    return this.page;
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  /**
   * Navigates to merchant storefront, searches for products, and extracts candidate cards.
   */
  async searchStorefront(storeUrl: string, query: string): Promise<ProductCandidate[]> {
    assertAllowedMerchantDomain(storeUrl);
    const page = await this.initialize();

    await page.goto(storeUrl, { waitUntil: 'domcontentloaded' });

    // Untrusted content scan of initial page title and DOM
    const rawContent = await page.content();
    scanUntrustedContent(rawContent, false);

    // If search form exists, use it to query
    const hasSearchInput = await page.$('#search-input');
    if (hasSearchInput && query) {
      await page.fill('#search-input', query);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
        page.click('#search-submit-btn'),
      ]);
    }

    // Extract product cards from the DOM
    const rawCards = await page.$$eval('.product-card', (cards) => {
      return cards.map((card) => {
        const id = card.getAttribute('data-product-id') || '';
        const category = card.getAttribute('data-category') || '';
        const price = parseFloat(card.getAttribute('data-price') || '0');
        const titleEl = card.querySelector('h3');
        const descEl = card.querySelector('p');
        const linkEl = card.querySelector('a');

        return {
          id,
          category,
          price,
          name: titleEl?.textContent?.trim() || '',
          description: descEl?.textContent?.trim() || '',
          href: linkEl?.getAttribute('href') || '',
        };
      });
    });

    const merchantId = (await page.$eval('meta[name="merchant-id"]', (el) => el.getAttribute('content')).catch(() => 'demo_store')) || 'demo_store';
    const pageTitle = await page.title();

    return rawCards.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      price_rupees: c.price,
      price_paise: Math.round(c.price * 100),
      currency: 'INR',
      category: c.category,
      in_stock: true,
      merchant_id: merchantId,
      merchant_name: pageTitle.split('-')[0].trim() || 'TechSupply Store',
      url: c.href ? new URL(c.href, storeUrl).toString() : `${storeUrl}/products/${c.id}`,
    }));
  }

  /**
   * Opens product detail page, selects variant if required, and adds to cart.
   */
  async viewProductAndAddToCart(
    productPageUrl: string,
    variantId?: string,
    quantity = 1
  ): Promise<{ cartUrl: string; itemCount: number }> {
    assertAllowedMerchantDomain(productPageUrl);
    const page = await this.initialize();

    await page.goto(productPageUrl, { waitUntil: 'domcontentloaded' });

    // Select variant if option exists
    const variantSelect = await page.$('#variant-select');
    if (variantSelect && variantId) {
      await page.selectOption('#variant-select', variantId);
    }

    // Set quantity
    const qtyInput = await page.$('#quantity-input');
    if (qtyInput) {
      await page.fill('#quantity-input', String(Math.max(1, quantity)));
    }

    // Click Add to Cart and await navigation to Cart page
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('#add-to-cart-btn'),
    ]);

    return {
      cartUrl: page.url(),
      itemCount: quantity,
    };
  }

  /**
   * Navigates to checkout, submits or prepares order, and extracts authoritative DOM checkout state.
   */
  async proceedToCheckoutAndExtract(cartOrCheckoutUrl: string): Promise<MerchantCheckoutSession> {
    assertAllowedMerchantDomain(cartOrCheckoutUrl);
    const page = await this.initialize();

    if (!page.url().includes('/store/checkout')) {
      if (page.url().includes('/store/cart')) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
          page.click('#proceed-to-checkout-btn'),
        ]);
      } else {
        await page.goto(cartOrCheckoutUrl, { waitUntil: 'domcontentloaded' });
      }
    }

    // Wait for checkout summary card to be mounted
    await page.waitForSelector('#checkout-summary', { timeout: 10000 });

    // Extract semantic checkout data attributes from the live DOM
    const summaryData = await page.$eval('#checkout-summary', (el) => {
      return {
        merchantId: el.getAttribute('data-merchant-id') || '',
        merchantName: el.getAttribute('data-merchant-name') || '',
        orderId: el.getAttribute('data-order-id') || '',
        productId: el.getAttribute('data-product-id') || '',
        productName: el.getAttribute('data-product-name') || '',
        category: el.getAttribute('data-category') || '',
        quantity: parseInt(el.getAttribute('data-quantity') || '1', 10),
        subtotalRupees: parseFloat(el.getAttribute('data-subtotal') || '0'),
        shippingRupees: parseFloat(el.getAttribute('data-shipping') || '0'),
        taxRupees: parseFloat(el.getAttribute('data-tax') || '0'),
        discountRupees: parseFloat(el.getAttribute('data-discount') || '0'),
        totalRupees: parseFloat(el.getAttribute('data-total') || '0'),
        currency: el.getAttribute('data-currency') || 'INR',
      };
    });

    const subtotalPaise = Math.round(summaryData.subtotalRupees * 100);
    const shippingPaise = Math.round(summaryData.shippingRupees * 100);
    const taxPaise = Math.round(summaryData.taxRupees * 100);
    const totalPaise = Math.round(summaryData.totalRupees * 100);

    return {
      orderId: summaryData.orderId,
      merchantId: summaryData.merchantId,
      merchantName: summaryData.merchantName,
      items: [
        {
          productId: summaryData.productId,
          productName: summaryData.productName,
          quantity: summaryData.quantity,
          priceRupees: summaryData.subtotalRupees / summaryData.quantity,
          pricePaise: Math.round(subtotalPaise / summaryData.quantity),
          category: summaryData.category,
        },
      ],
      subtotalRupees: summaryData.subtotalRupees,
      subtotalPaise,
      shippingRupees: summaryData.shippingRupees,
      shippingPaise,
      taxRupees: summaryData.taxRupees,
      taxPaise,
      totalRupees: summaryData.totalRupees,
      totalPaise,
      currency: summaryData.currency,
      checkoutUrl: page.url(),
      status: 'AWAITING_PAYMENT',
    };
  }

  /**
   * Confirms payment receipt on merchant storefront.
   */
  async confirmOrderReceipt(orderId: string, baseUrl: string): Promise<boolean> {
    const page = await this.initialize();
    const receiptUrl = `${baseUrl}/store/orders/${orderId}`;
    assertAllowedMerchantDomain(receiptUrl);

    await page.goto(receiptUrl, { waitUntil: 'domcontentloaded' });
    const receipt = await page.$('#order-receipt');
    return receipt !== null;
  }
}
