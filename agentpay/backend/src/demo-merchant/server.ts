import http from 'http';
import { ulid } from 'ulid';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // in rupees
  pricePaise: number; // in paise
  category: string;
  inStock: boolean;
}

export interface OrderItem {
  productId: string;
  productName: string;
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
  totalRupees: number;
  totalPaise: number;
  currency: string;
  status: 'AWAITING_PAYMENT' | 'PAID' | 'FULFILLED' | 'CANCELLED';
  paymentIntentId?: string;
  createdAt: string;
  shippingAddress?: string;
}

export const DEMO_PRODUCTS: Product[] = [
  {
    id: 'prod_kbd_01',
    name: 'Keychron C3 Mechanical Keyboard',
    description: 'Hot-swappable tactile RGB mechanical keyboard with red switches',
    price: 2499,
    pricePaise: 249900,
    category: 'electronics',
    inStock: true,
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
    id: 'prod_mouse_03',
    name: 'Logitech Precision Wireless Mouse',
    description: 'Ergonomic 4000 DPI multi-device wireless laser mouse',
    price: 1499,
    pricePaise: 149900,
    category: 'electronics',
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
  private server: http.Server | null = null;

  constructor() {}

  createOrder(items: { productId: string; quantity: number }[], shippingAddress?: string): MerchantOrder {
    const orderItems: OrderItem[] = [];
    let totalPaise = 0;

    for (const item of items) {
      const product = DEMO_PRODUCTS.find((p) => p.id === item.productId);
      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }
      const qty = Math.max(1, item.quantity || 1);
      orderItems.push({
        productId: product.id,
        productName: product.name,
        price: product.price,
        pricePaise: product.pricePaise,
        quantity: qty,
        category: product.category,
      });
      totalPaise += product.pricePaise * qty;
    }

    const orderId = `ORDER_${Date.now()}_${ulid().slice(-6)}`;
    const order: MerchantOrder = {
      orderId,
      merchantId: this.merchantId,
      merchantName: this.merchantName,
      items: orderItems,
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
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        // Helper to read JSON body
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
          // Health
          if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', merchantId: this.merchantId, name: this.merchantName }));
            return;
          }

          // Catalog
          if (url.pathname === '/products' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: DEMO_PRODUCTS }));
            return;
          }

          // Checkout
          if (url.pathname === '/checkout' && req.method === 'POST') {
            const body = await readBody();
            const order = this.createOrder(body.items || [], body.shippingAddress);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: order }));
            return;
          }

          // Order details
          if (url.pathname.startsWith('/orders/') && req.method === 'GET') {
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

          // Confirm Payment
          if (url.pathname.startsWith('/orders/') && url.pathname.endsWith('/confirm') && req.method === 'POST') {
            const orderId = url.pathname.split('/')[2];
            const body = await readBody();
            const updated = this.confirmOrderPayment(orderId, body.payment_intent_id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: updated }));
            return;
          }

          // HTML Storefront for Browser / Computer-Use AI Agents
          if (url.pathname === '/' || url.pathname === '/store') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>${this.merchantName}</title>
                <meta name="merchant-id" content="${this.merchantId}">
                <style>
                  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
                  .product-card { border: 1px solid #ddd; padding: 16px; margin-bottom: 16px; border-radius: 8px; }
                  .price { font-size: 1.25rem; font-weight: bold; color: #2e7d32; }
                  .badge { background: #eee; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
                </style>
              </head>
              <body>
                <h1>${this.merchantName}</h1>
                <p>Merchant Identifier: <code>${this.merchantId}</code></p>
                <div id="products">
                  ${DEMO_PRODUCTS.map(
                    (p) => `
                    <div class="product-card" data-product-id="${p.id}" data-category="${p.category}" data-price="${p.price}">
                      <h3>${p.name}</h3>
                      <p>${p.description}</p>
                      <p class="price">₹${p.price.toLocaleString('en-IN')}</p>
                      <span class="badge">${p.category}</span>
                    </div>
                  `
                  ).join('')}
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

// CLI standalone runner
if (require.main === module) {
  const store = new DemoMerchantStore();
  store
    .start(3002)
    .then((port) => console.log(`🏪 Demo Merchant Store running at http://localhost:${port}`))
    .catch((err) => {
      console.error('Failed to start demo merchant store:', err);
      process.exit(1);
    });
}
