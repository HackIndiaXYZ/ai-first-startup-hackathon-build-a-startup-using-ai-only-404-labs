import { FrameMcpTools } from '../mcp/tools';
import { McpCreateIntentResponse, McpPaymentStatusResponse } from '../mcp/types';
import { Product, MerchantOrder } from './server';

export interface AgentCheckoutConfig {
  merchantBaseUrl: string;
  frameMcpTools: FrameMcpTools;
  agentApiKey: string;
}

export interface AgentCheckoutResult {
  step: string;
  productSelected?: Product;
  merchantOrder?: MerchantOrder;
  paymentResponse?: McpCreateIntentResponse;
  paymentStatus?: McpPaymentStatusResponse;
  orderFulfilled?: boolean;
  tamperedAmount?: number;
  error?: string;
}

export class ShoppingAgent {
  private merchantUrl: string;
  private mcpTools: FrameMcpTools;
  private agentApiKey: string;

  constructor(config: AgentCheckoutConfig) {
    this.merchantUrl = config.merchantBaseUrl.replace(/\/$/, '');
    this.mcpTools = config.frameMcpTools;
    this.agentApiKey = config.agentApiKey;
  }

  /**
   * Step 1: Agent queries merchant product catalog.
   */
  async searchCatalog(keyword: string, maxPriceRupees?: number): Promise<Product[]> {
    const res = await fetch(`${this.merchantUrl}/products`);
    const data = (await res.json()) as { data: Product[] };
    const products = data.data || [];

    const lowerKeyword = keyword.toLowerCase();
    return products.filter((p) => {
      const matchesKeyword =
        p.name.toLowerCase().includes(lowerKeyword) ||
        p.description.toLowerCase().includes(lowerKeyword) ||
        p.category.toLowerCase().includes(lowerKeyword);
      const matchesPrice = maxPriceRupees !== undefined ? p.price <= maxPriceRupees : true;
      return matchesKeyword && matchesPrice;
    });
  }

  /**
   * Step 2: Agent carts the product and triggers merchant checkout.
   */
  async proceedToCheckout(productId: string, quantity = 1, shippingAddress?: string): Promise<MerchantOrder> {
    const res = await fetch(`${this.merchantUrl}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId, quantity }],
        shippingAddress,
      }),
    });

    if (!res.ok) {
      throw new Error(`Merchant checkout failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { data: MerchantOrder };
    return data.data;
  }

  /**
   * Step 3: Agent executes complete checkout flow using Frame MCP.
   * Options allow testing edge cases such as amount tampering.
   */
  async executePurchase(options: {
    keyword: string;
    maxBudgetRupees?: number;
    idempotencyKey: string;
    tamperAmountRupees?: number; // For security testing
    overrideCategory?: string; // For security testing
    overrideMerchant?: string; // For security testing
  }): Promise<AgentCheckoutResult> {
    // 1. Search merchant catalog
    const matches = await this.searchCatalog(options.keyword, options.maxBudgetRupees);
    if (matches.length === 0) {
      return {
        step: 'PRODUCT_SEARCH',
        error: `No products matching "${options.keyword}" found under budget ₹${options.maxBudgetRupees || 'any'}`,
      };
    }

    const selectedProduct = matches[0];

    // 2. Proceed to merchant checkout
    const merchantOrder = await this.proceedToCheckout(selectedProduct.id, 1);

    // 3. Extract canonical merchant checkout details
    // The merchant checkout amount is the source of truth
    const payableAmountRupees = options.tamperAmountRupees !== undefined ? options.tamperAmountRupees : merchantOrder.totalRupees;
    const category = options.overrideCategory || selectedProduct.category;
    const merchant = options.overrideMerchant || merchantOrder.merchantId;

    // 4. Call Frame MCP frame_create_payment_intent
    let paymentResponse: McpCreateIntentResponse;
    try {
      paymentResponse = await this.mcpTools.createPaymentIntent({
        amount: payableAmountRupees,
        currency: merchantOrder.currency,
        merchant,
        merchant_reference: merchantOrder.orderId,
        purpose: selectedProduct.name,
        category,
        idempotency_key: options.idempotencyKey,
        metadata: {
          merchant_order_id: merchantOrder.orderId,
          product_id: selectedProduct.id,
          tampered: options.tamperAmountRupees !== undefined,
        },
        agent_api_key: this.agentApiKey,
      });
    } catch (err: any) {
      return {
        step: 'FRAME_MCP_AUTHORIZE',
        productSelected: selectedProduct,
        merchantOrder,
        tamperedAmount: options.tamperAmountRupees,
        error: err.message || err.code || 'MCP authorization failed',
      };
    }

    // 5. Handle Policy Decision
    if (paymentResponse.decision === 'DENY') {
      return {
        step: 'POLICY_DENIED',
        productSelected: selectedProduct,
        merchantOrder,
        paymentResponse,
        orderFulfilled: false,
      };
    }

    if (paymentResponse.decision === 'REQUIRE_APPROVAL') {
      // Agent queues approval request and waits
      await this.mcpTools.requestApproval({
        payment_intent_id: paymentResponse.payment_intent_id,
        notes: `Agent purchase for ${selectedProduct.name} (Order: ${merchantOrder.orderId})`,
        agent_api_key: this.agentApiKey,
      });

      return {
        step: 'WAITING_HUMAN_APPROVAL',
        productSelected: selectedProduct,
        merchantOrder,
        paymentResponse,
        orderFulfilled: false,
      };
    }

    // 6. If ALLOW, poll/check payment status
    const statusResponse = await this.mcpTools.getPaymentStatus({
      payment_intent_id: paymentResponse.payment_intent_id,
      agent_api_key: this.agentApiKey,
    });

    // 7. If payment succeeded / settled, notify merchant to fulfill order
    let orderFulfilled = false;
    if (['SUCCEEDED', 'COMPLETED', 'SETTLED', 'AUTHORIZED', 'EXECUTING'].includes(statusResponse.status)) {
      const confirmRes = await fetch(`${this.merchantUrl}/orders/${merchantOrder.orderId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentResponse.payment_intent_id }),
      });
      orderFulfilled = confirmRes.ok;
    }

    return {
      step: 'COMPLETED',
      productSelected: selectedProduct,
      merchantOrder,
      paymentResponse,
      paymentStatus: statusResponse,
      orderFulfilled,
    };
  }
}
