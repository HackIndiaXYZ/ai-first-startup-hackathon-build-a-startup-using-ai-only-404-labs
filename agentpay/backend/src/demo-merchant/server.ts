import http from 'http';
import { ulid } from 'ulid';

export interface ProductVariant {
  id: string;
  name: string;
  priceModifierPaise?: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // in rupees
  pricePaise: number; // in paise
  category: string;
  inStock: boolean;
  variants?: ProductVariant[];
}

export interface OrderItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  price: number;
  pricePaise: number;
  quantity: number;
  category: string;
}

export interface MerchantOrder {
  orderId: string;
  merchantId: string;
  merchantName: string;
  items: OrderItem[];
  subtotalRupees: number;
  shippingRupees: number;
  taxRupees: number;
  discountRupees: number;
  totalRupees: number;
  totalPaise: number;
  currency: string;
  status: 'AWAITING_PAYMENT' | 'PAID' | 'FULFILLED' | 'CANCELLED';
  paymentIntentId?: string;
  createdAt: string;
  shippingAddress?: string;
}

export interface CartItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export const DEMO_PRODUCTS: Product[] = [
  {
    id: 'prod_kbd_01',
    name: 'Keychron C3 Mechanical Keyboard',
    description: 'Hot-swappable tactile RGB mechanical keyboard with switch choices',
    price: 2499,
    pricePaise: 249900,
    category: 'electronics',
    inStock: true,
    variants: [
      { id: 'sw_red', name: 'Red Switches (Linear & Quiet)' },
      { id: 'sw_brown', name: 'Brown Switches (Tactile)' },
      { id: 'sw_blue', name: 'Blue Switches (Clicky)' },
    ],
  },
  {
    id: 'prod_mouse_03',
    name: 'Logitech Precision Wireless Mouse',
    description: 'Ergonomic 4000 DPI multi-device wireless laser mouse',
    price: 1499,
    pricePaise: 149900,
    category: 'electronics',
    inStock: true,
    variants: [
      { id: 'clr_graphite', name: 'Graphite Black' },
      { id: 'clr_white', name: 'Off-White' },
    ],
  },
  {
    id: 'prod_stand_06',
    name: 'Aluminium Ergonomic Laptop Stand',
    description: 'Premium ventilated aircraft-grade aluminium riser for 11-17 inch laptops',
    price: 1899,
    pricePaise: 189900,
    category: 'electronics',
    inStock: true,
    variants: [
      { id: 'mat_grey', name: 'Space Grey Aluminium' },
      { id: 'mat_silver', name: 'Silver Aluminium' },
    ],
  },
  {
    id: 'prod_chair_02',
    name: 'Ergonomic Office Chair Pro',
    description: 'High-back mesh ergonomic lumbar support desk chair',
    price: 2799,
    pricePaise: 279900,
    category: 'office',
    inStock: true,
  },
  {
    id: 'prod_chips_04',
    name: 'Casino Royale VIP Chips Pack',
    description: 'High-stakes gaming chips set with aluminum carrying case',
    price: 2499,
    pricePaise: 249900,
    category: 'gambling',
    inStock: true,
  },
  {
    id: 'prod_server_05',
    name: 'Enterprise GPU Server Rack',
    description: 'High density compute server rack unit for AI workloads',
    price: 9999,
    pricePaise: 999900,
    category: 'infrastructure',
    inStock: true,
  },
];

export class DemoMerchantStore {
  public readonly merchantId = 'demo_store';
  public readonly merchantName = 'TechSupply Store';
  private orders = new Map<string, MerchantOrder>();
  private carts = new Map<string, CartItem[]>();
  private server: http.Server | null = null;

  constructor() {
    // Default session cart
    this.carts.set('default', []);
  }

  getCart(sessionId = 'default'): CartItem[] {
    return this.carts.get(sessionId) || [];
  }

  addToCart(item: CartItem, sessionId = 'default'): CartItem[] {
    const current = this.getCart(sessionId);
    const existingIndex = current.findIndex(
      (c) => c.productId === item.productId && c.variantId === item.variantId
    );
    if (existingIndex >= 0) {
      current[existingIndex].quantity += item.quantity;
    } else {
      current.push({ ...item });
    }
    this.carts.set(sessionId, current);
    return current;
  }

  clearCart(sessionId = 'default'): void {
    this.carts.set(sessionId, []);
  }

  createOrder(
    items: { productId: string; variantId?: string; quantity: number }[],
    shippingAddress?: string
  ): MerchantOrder {
    const orderItems: OrderItem[] = [];
    let subtotalPaise = 0;

    for (const item of items) {
      const product = DEMO_PRODUCTS.find((p) => p.id === item.productId);
      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }
      const qty = Math.max(1, item.quantity || 1);
      const variant = product.variants?.find((v) => v.id === item.variantId);
      const variantModifier = variant?.priceModifierPaise || 0;
      const unitPricePaise = product.pricePaise + variantModifier;

      orderItems.push({
        productId: product.id,
        productName: product.name,
        variantId: variant?.id,
        variantName: variant?.name,
        price: unitPricePaise / 100,
        pricePaise: unitPricePaise,
        quantity: qty,
        category: product.category,
      });
      subtotalPaise += unitPricePaise * qty;
    }

    const shippingPaise = 0; // Free shipping over ₹1000
    const taxPaise = 0; // Included in price
    const discountPaise = 0;
    const totalPaise = subtotalPaise + shippingPaise + taxPaise - discountPaise;

    const orderId = `ORDER_${Date.now()}_${ulid().slice(-6)}`;
    const order: MerchantOrder = {
      orderId,
      merchantId: this.merchantId,
      merchantName: this.merchantName,
      items: orderItems,
      subtotalRupees: subtotalPaise / 100,
      shippingRupees: shippingPaise / 100,
      taxRupees: taxPaise / 100,
      discountRupees: discountPaise / 100,
      totalRupees: totalPaise / 100,
      totalPaise,
      currency: 'INR',
      status: 'AWAITING_PAYMENT',
      createdAt: new Date().toISOString(),
      shippingAddress: shippingAddress || '123 Tech Park, Bangalore 560100',
    };

    this.orders.set(orderId, order);
    return order;
  }

  getOrder(orderId: string): MerchantOrder | undefined {
    return this.orders.get(orderId);
  }

  confirmOrderPayment(orderId: string, paymentIntentId: string): MerchantOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    order.status = 'PAID';
    order.paymentIntentId = paymentIntentId;
    return order;
  }

  async start(port = 3002): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const sessionId = (req.headers['x-session-id'] as string) || url.searchParams.get('session') || 'default';

        const readBody = async (): Promise<any> => {
          return new Promise((resolveBody) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
              try {
                resolveBody(body ? JSON.parse(body) : {});
              } catch {
                resolveBody({});
              }
            });
          });
        };

        try {
          // 1. Health
          if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', merchantId: this.merchantId, name: this.merchantName }));
            return;
          }

          // 2. JSON Catalog API
          if (url.pathname === '/products' && req.method === 'GET') {
            const query = url.searchParams.get('q')?.toLowerCase() || '';
            const maxPrice = parseFloat(url.searchParams.get('max_price') || '0');
            let filtered = DEMO_PRODUCTS;
            if (query) {
              filtered = filtered.filter(
                (p) =>
                  p.name.toLowerCase().includes(query) ||
                  p.description.toLowerCase().includes(query) ||
                  p.category.toLowerCase().includes(query)
              );
            }
            if (maxPrice > 0) {
              filtered = filtered.filter((p) => p.price <= maxPrice);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: filtered }));
            return;
          }

          // 3. JSON Checkout API
          if (url.pathname === '/checkout' && req.method === 'POST') {
            const body = await readBody();
            const order = this.createOrder(body.items || [], body.shippingAddress);
            this.clearCart(sessionId);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: order }));
            return;
          }

          // 4. JSON Order Details
          if (url.pathname.startsWith('/orders/') && !url.pathname.endsWith('/confirm') && req.method === 'GET') {
            const orderId = url.pathname.replace('/orders/', '');
            const order = this.getOrder(orderId);
            if (!order) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Order not found' } }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: order }));
            return;
          }

          // 5. JSON Confirm Payment
          if (url.pathname.startsWith('/orders/') && url.pathname.endsWith('/confirm') && req.method === 'POST') {
            const orderId = url.pathname.split('/')[2];
            const body = await readBody();
            const updated = this.confirmOrderPayment(orderId, body.payment_intent_id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: updated }));
            return;
          }

          // ── REAL BROWSER HTML STOREFRONT ────────────────────────────────────

          // 6. Storefront Catalog & Search: GET / or GET /store
          if (url.pathname === '/' || url.pathname === '/store') {
            const query = (url.searchParams.get('q') || '').trim();
            let products = DEMO_PRODUCTS;
            if (query) {
              const qLower = query.toLowerCase();
              products = DEMO_PRODUCTS.filter(
                (p) =>
                  p.name.toLowerCase().includes(qLower) ||
                  p.description.toLowerCase().includes(qLower) ||
                  p.category.toLowerCase().includes(qLower)
              );
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <title>${this.merchantName} - Official Storefront</title>
                <meta name="merchant-id" content="${this.merchantId}">
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
                  .container { max-width: 960px; margin: 0 auto; }
                  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
                  h1 { margin: 0; font-size: 1.75rem; color: #1e293b; }
                  .search-box { display: flex; gap: 8px; margin-bottom: 24px; }
                  .search-box input { flex: 1; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 1rem; }
                  .search-box button { padding: 10px 20px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
                  .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
                  .product-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
                  .product-card h3 { margin-top: 0; font-size: 1.2rem; color: #0f172a; }
                  .price { font-size: 1.35rem; font-weight: 700; color: #059669; margin: 12px 0 6px 0; }
                  .category-tag { display: inline-block; background: #e0f2fe; color: #0369a1; font-size: 0.75rem; font-weight: 600; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; margin-bottom: 8px; }
                  .view-btn { display: inline-block; text-align: center; background: #0f172a; color: #fff; padding: 10px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 14px; }
                  .cart-badge { background: #f1f5f9; padding: 8px 14px; border-radius: 6px; text-decoration: none; color: #0f172a; font-weight: 600; }
                </style>
              </head>
              <body>
                <div class="container">
                  <header>
                    <div>
                      <h1>${this.merchantName}</h1>
                      <small>Verified Merchant: <code>${this.merchantId}</code></small>
                    </div>
                    <a id="nav-cart-link" class="cart-badge" href="/store/cart">🛒 View Cart</a>
                  </header>

                  <form class="search-box" method="GET" action="/store">
                    <input id="search-input" name="q" type="text" placeholder="Search keyboards, mouse, laptop stand..." value="${query.replace(/"/g, '&quot;')}" />
                    <button id="search-submit-btn" type="submit">Search</button>
                  </form>

                  <div id="products-container" class="products-grid">
                    ${
                      products.length === 0
                        ? '<p id="no-products-msg">No products found matching your search.</p>'
                        : products
                            .map(
                              (p) => `
                        <div class="product-card" id="card-${p.id}" data-product-id="${p.id}" data-category="${p.category}" data-price="${p.price}">
                          <div>
                            <span class="category-tag">${p.category}</span>
                            <h3>${p.name}</h3>
                            <p>${p.description}</p>
                          </div>
                          <div>
                            <div class="price">₹${p.price.toLocaleString('en-IN')}</div>
                            <a id="view-product-${p.id}" class="view-btn" href="/store/products/${p.id}">View Details & Buy</a>
                          </div>
                        </div>
                      `
                            )
                            .join('')
                    }
                  </div>
                </div>
              </body>
              </html>
            `);
            return;
          }

          // 7. Storefront Product Detail Page: GET /store/products/:id
          if (url.pathname.startsWith('/store/products/')) {
            const prodId = url.pathname.replace('/store/products/', '');
            const product = DEMO_PRODUCTS.find((p) => p.id === prodId);

            if (!product) {
              res.writeHead(404, { 'Content-Type': 'text/html' });
              res.end(`<h1>Product Not Found</h1><p><a href="/store">Back to Store</a></p>`);
              return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <title>${product.name} - ${this.merchantName}</title>
                <meta name="merchant-id" content="${this.merchantId}">
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
                  .container { max-width: 800px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
                  .breadcrumb { margin-bottom: 20px; font-size: 0.9rem; }
                  .breadcrumb a { color: #2563eb; text-decoration: none; }
                  h1 { margin: 0 0 12px 0; font-size: 2rem; }
                  .price { font-size: 2rem; font-weight: 700; color: #059669; margin: 16px 0; }
                  .form-group { margin-bottom: 20px; }
                  label { display: block; font-weight: 600; margin-bottom: 6px; }
                  select, input { padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 1rem; width: 100%; max-width: 300px; box-sizing: border-box; }
                  .btn-add { background: #2563eb; color: #fff; padding: 14px 28px; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 600; cursor: pointer; }
                  .btn-add:hover { background: #1d4ed8; }
                </style>
              </head>
              <body>
                <div class="container" id="product-detail" data-product-id="${product.id}" data-category="${product.category}" data-price="${product.price}">
                  <div class="breadcrumb"><a href="/store">← Back to Catalog</a></div>
                  <span style="text-transform: uppercase; font-size: 0.8rem; font-weight: bold; color: #0284c7;">${product.category}</span>
                  <h1 id="product-name">${product.name}</h1>
                  <p id="product-description" style="font-size: 1.1rem; color: #475569;">${product.description}</p>
                  <div class="price" id="product-price">₹${product.price.toLocaleString('en-IN')}</div>

                  <form method="POST" action="/store/cart/add">
                    <input type="hidden" name="productId" value="${product.id}" />
                    ${
                      product.variants && product.variants.length > 0
                        ? `
                      <div class="form-group">
                        <label for="variant-select">Select Option / Variant:</label>
                        <select id="variant-select" name="variantId">
                          ${product.variants
                            .map((v) => `<option value="${v.id}">${v.name}</option>`)
                            .join('')}
                        </select>
                      </div>
                    `
                        : ''
                    }
                    <div class="form-group">
                      <label for="quantity-input">Quantity:</label>
                      <input id="quantity-input" name="quantity" type="number" value="1" min="1" max="10" />
                    </div>
                    <button id="add-to-cart-btn" class="btn-add" type="submit">Add to Shopping Cart</button>
                  </form>
                </div>
              </body>
              </html>
            `);
            return;
          }

          // 8. Add to Cart Form Handler: POST /store/cart/add
          if (url.pathname === '/store/cart/add' && req.method === 'POST') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
              const params = new URLSearchParams(body);
              const productId = params.get('productId') || '';
              const variantId = params.get('variantId') || undefined;
              const quantity = parseInt(params.get('quantity') || '1', 10);

              if (productId) {
                this.addToCart({ productId, variantId, quantity }, sessionId);
              }

              res.writeHead(302, { Location: '/store/cart' });
              res.end();
            });
            return;
          }

          // 9. Storefront Cart Page: GET /store/cart
          if (url.pathname === '/store/cart' && req.method === 'GET') {
            const cart = this.getCart(sessionId);
            let subtotal = 0;
            const enriched = cart.map((item) => {
              const product = DEMO_PRODUCTS.find((p) => p.id === item.productId);
              const unitPrice = product ? product.price : 0;
              const lineTotal = unitPrice * item.quantity;
              subtotal += lineTotal;
              const variant = product?.variants?.find((v) => v.id === item.variantId);
              return {
                ...item,
                productName: product?.name || 'Unknown Item',
                variantName: variant?.name || '',
                unitPrice,
                lineTotal,
              };
            });

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <title>Shopping Cart - ${this.merchantName}</title>
                <meta name="merchant-id" content="${this.merchantId}">
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
                  .container { max-width: 800px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }
                  h1 { margin-top: 0; }
                  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                  th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e2e8f0; }
                  .total-row { font-size: 1.25rem; font-weight: bold; color: #059669; }
                  .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; }
                  .btn-checkout { background: #059669; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1.1rem; }
                  .btn-continue { color: #2563eb; text-decoration: none; font-weight: 600; }
                </style>
              </head>
              <body>
                <div class="container" id="cart-container">
                  <h1>Your Shopping Cart</h1>
                  ${
                    enriched.length === 0
                      ? '<p id="empty-cart-msg">Your cart is currently empty. <a href="/store">Start shopping</a></p>'
                      : `
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Qty</th>
                          <th>Price</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${enriched
                          .map(
                            (it) => `
                          <tr class="cart-item" data-product-id="${it.productId}">
                            <td>
                              <strong>${it.productName}</strong>
                              ${it.variantName ? `<br><small style="color:#64748b;">${it.variantName}</small>` : ''}
                            </td>
                            <td>${it.quantity}</td>
                            <td>₹${it.unitPrice.toLocaleString('en-IN')}</td>
                            <td>₹${it.lineTotal.toLocaleString('en-IN')}</td>
                          </tr>
                        `
                          )
                          .join('')}
                        <tr class="total-row">
                          <td colspan="3">Subtotal</td>
                          <td id="cart-subtotal">₹${subtotal.toLocaleString('en-IN')}</td>
                        </tr>
                      </tbody>
                    </table>

                    <div class="actions">
                      <a class="btn-continue" href="/store">← Continue Shopping</a>
                      <a id="proceed-to-checkout-btn" class="btn-checkout" href="/store/checkout">Proceed to Checkout →</a>
                    </div>
                  `
                  }
                </div>
              </body>
              </html>
            `);
            return;
          }

          // 10. Storefront Checkout Page: GET /store/checkout
          if (url.pathname === '/store/checkout' && req.method === 'GET') {
            const cart = this.getCart(sessionId);
            if (cart.length === 0) {
              res.writeHead(302, { Location: '/store' });
              res.end();
              return;
            }

            // Create preliminary order to yield authoritative order ID & totals
            const order = this.createOrder(cart);

            const primaryItem = order.items[0];

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <title>Checkout - ${this.merchantName}</title>
                <meta name="merchant-id" content="${this.merchantId}">
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
                  .container { max-width: 800px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
                  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
                  h2 { margin-top: 0; }
                  .line-item { display: flex; justify-content: space-between; margin: 8px 0; }
                  .total-line { border-top: 2px solid #e2e8f0; margin-top: 16px; padding-top: 16px; font-size: 1.3rem; font-weight: 700; color: #059669; }
                  .btn-pay { width: 100%; background: #059669; color: #fff; padding: 14px; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 700; cursor: pointer; margin-top: 20px; }
                  .badge { background: #dcfce7; color: #166534; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="card">
                    <h2>Shipping Details</h2>
                    <p>Address: <strong>123 Tech Park, Bangalore 560100</strong></p>
                    <p>Rail Integration: <span class="badge">Frame Financial Control Plane</span></p>
                    <p style="font-size:0.85rem; color:#64748b;">Payments on this storefront are authorized and verified via Frame delegated payment authority.</p>
                  </div>

                  <div class="card" 
                       id="checkout-summary"
                       data-merchant-id="${this.merchantId}"
                       data-merchant-name="${this.merchantName}"
                       data-order-id="${order.orderId}"
                       data-product-id="${primaryItem.productId}"
                       data-product-name="${primaryItem.productName}"
                       data-category="${primaryItem.category}"
                       data-quantity="${primaryItem.quantity}"
                       data-subtotal="${order.subtotalRupees}"
                       data-shipping="${order.shippingRupees}"
                       data-tax="${order.taxRupees}"
                       data-discount="${order.discountRupees}"
                       data-total="${order.totalRupees}"
                       data-currency="${order.currency}">
                    <h2>Order Summary</h2>
                    <div class="line-item">
                      <span>Order Reference:</span>
                      <strong id="summary-order-id">${order.orderId}</strong>
                    </div>
                    <div class="line-item">
                      <span>${primaryItem.productName} (x${primaryItem.quantity}):</span>
                      <span>₹${order.subtotalRupees.toLocaleString('en-IN')}</span>
                    </div>
                    <div class="line-item">
                      <span>Shipping:</span>
                      <span>₹${order.shippingRupees.toLocaleString('en-IN')}</span>
                    </div>
                    <div class="line-item total-line">
                      <span>Total Amount:</span>
                      <span id="summary-total-amount">₹${order.totalRupees.toLocaleString('en-IN')}</span>
                    </div>

                    <a id="order-confirmation-link" href="/store/orders/${order.orderId}" style="display:none;">View Confirmation</a>
                    <button id="checkout-confirm-btn" class="btn-pay" onclick="window.location.href='/store/orders/${order.orderId}'">Authorise Payment</button>
                  </div>
                </div>
              </body>
              </html>
            `);
            return;
          }

          // 11. Storefront Order Receipt Page: GET /store/orders/:id
          if (url.pathname.startsWith('/store/orders/')) {
            const orderId = url.pathname.replace('/store/orders/', '');
            const order = this.getOrder(orderId);

            if (!order) {
              res.writeHead(404, { 'Content-Type': 'text/html' });
              res.end(`<h1>Order ${orderId} not found</h1>`);
              return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <title>Order ${order.orderId} - Receipt</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px; }
                  .container { max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }
                  .status-pill { display: inline-block; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; }
                  .status-paid { background: #dcfce7; color: #15803d; }
                  .status-awaiting { background: #fef3c7; color: #b45309; }
                </style>
              </head>
              <body>
                <div class="container" id="order-receipt" data-order-id="${order.orderId}" data-status="${order.status}">
                  <h1>Receipt: ${order.orderId}</h1>
                  <p>Status: <span id="order-status-badge" class="status-pill ${order.status === 'PAID' ? 'status-paid' : 'status-awaiting'}">${order.status}</span></p>
                  <p>Total: <strong>₹${order.totalRupees.toLocaleString('en-IN')}</strong></p>
                  <p>Merchant: ${order.merchantName} (<code>${order.merchantId}</code>)</p>
                  <hr>
                  <a href="/store">Return to Storefront</a>
                </div>
              </body>
              </html>
            `);
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: err.message } }));
        }
      });

      this.server.listen(port, () => {
        resolve(port);
      });

      this.server.on('error', (err) => reject(err));
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

// Standalone execution
if (require.main === module) {
  const store = new DemoMerchantStore();
  store
    .start(3002)
    .then((port) => console.log(`🏪 Real Demo Merchant Store running at http://localhost:${port}/store`))
    .catch((err) => {
      console.error('Failed to start demo merchant store:', err);
      process.exit(1);
    });
}
