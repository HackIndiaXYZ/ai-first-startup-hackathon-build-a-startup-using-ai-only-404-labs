import { ulid } from 'ulid';
import { AgentExecutionState, AgentExecutionStatus } from './state';
import { StructuredUserIntent } from '../intent/schema';
import { parseUserIntent } from '../intent/parser';
import { ProductCandidate } from '../shopping/product';
import { selectBestProduct } from '../shopping/ranking';
import { MerchantAdapter } from '../merchants/merchant-adapter';
import { DemoStoreMerchantAdapter } from '../merchants/demo-store-adapter';
import { BrowserMerchantAdapter } from '../merchants/browser-merchant-adapter';
import { canonicalizeCheckout, CanonicalCheckout } from '../checkout/checkout-extractor';
import { verifyIntentBinding } from '../checkout/intent-binding';
import { FrameMcpClient, CreatePaymentIntentResult } from '../frame/frame-mcp-client';
import { AgentEventBus } from '../observability/events';
import { AgentLogger } from '../observability/logger';
import { defaultExecutionStore, ExecutionStore } from '../state/execution-store';
import { LLMProvider } from '../llm/provider';
import { DeterministicRuleProvider } from '../llm/deterministic';
import { OpenAICompatibleProvider } from '../llm/openai-compatible';
import { AnthropicProvider } from '../llm/anthropic-provider';
import { scanUntrustedContent } from '../security/prompt-injection';
import { assertNoSensitiveData } from '../security/sensitive-data';
import { CostController } from './cost-controller';

export interface ShoppingAgentConfig {
  merchantAdapter?: MerchantAdapter;
  frameClient?: FrameMcpClient;
  llmProvider?: LLMProvider;
  executionStore?: ExecutionStore;
  useBrowserAutomation?: boolean;
}

export function createDefaultLLMProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider();
  }
  if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
    return new OpenAICompatibleProvider();
  }
  return new DeterministicRuleProvider();
}

export class ShoppingAgent {
  private merchant: MerchantAdapter;
  private frame: FrameMcpClient;
  private llm: LLMProvider;
  private store: ExecutionStore;

  constructor(config: ShoppingAgentConfig = {}) {
    if (config.merchantAdapter) {
      this.merchant = config.merchantAdapter;
    } else if (config.useBrowserAutomation) {
      this.merchant = new BrowserMerchantAdapter();
    } else {
      this.merchant = new DemoStoreMerchantAdapter();
    }

    this.frame = config.frameClient || new FrameMcpClient();
    this.llm = config.llmProvider || createDefaultLLMProvider();
    this.store = config.executionStore || defaultExecutionStore;
  }

  setFrameApiKey(apiKey: string): void {
    this.frame.setApiKey(apiKey);
  }

  getFrameApiKey(): string {
    return this.frame.getApiKey();
  }

  /**
   * Resumes an execution that was paused in WAITING_FOR_HUMAN_APPROVAL or WAITING_FOR_HUMAN.
   */
  async resumeRun(runId: string): Promise<AgentExecutionState> {
    const state = this.store.getRun(runId);
    if (!state) {
      throw new Error(`Run ${runId} not found in execution store`);
    }

    const bus = new AgentEventBus(runId);
    const logger = new AgentLogger({ runId, prefix: 'FrameShoppingAgent' });

    if (state.status !== 'WAITING_FOR_HUMAN_APPROVAL' && state.status !== 'WAITING_FOR_HUMAN') {
      logger.info(`Run ${runId} is not in a paused state (current: ${state.status}). No resumption required.`);
      return state;
    }

    const paymentIntentId = state.framePaymentIntent?.payment_intent_id;
    if (!paymentIntentId || !state.canonicalCheckout) {
      throw new Error(`Cannot resume run ${runId}: missing payment intent or checkout snapshot.`);
    }

    logger.info(`Checking approval status for payment intent ${paymentIntentId}…`);
    bus.emitEvent('approval.checked', `Querying Frame for approval status of payment intent ${paymentIntentId}`);

    const statusResult = await this.frame.getPaymentIntentStatus(paymentIntentId);

    // If human principal approved in Frame dashboard
    if (statusResult.status === 'SUCCESS' || statusResult.status === 'AUTHORIZED' || statusResult.status === 'SETTLED') {
      bus.emitEvent('approval.granted', `Human principal approved payment intent ${paymentIntentId}. Resuming execution…`);

      state.status = 'EXECUTING_PAYMENT';
      state.updatedAt = new Date().toISOString();
      this.store.saveRun(state);

      bus.emitEvent('payment.started', `Payment intent ${paymentIntentId} authorized. Confirming merchant order…`);

      const merchantConfirmed = await this.merchant.confirmPayment(
        state.canonicalCheckout.order_id,
        paymentIntentId
      );

      if (!merchantConfirmed) {
        throw new Error(`Merchant failed to confirm payment for order ${state.canonicalCheckout.order_id}`);
      }

      state.orderConfirmation = {
        orderId: state.canonicalCheckout.order_id,
        merchant: state.canonicalCheckout.merchant_name,
        amount: state.canonicalCheckout.total_rupees,
        currency: state.canonicalCheckout.currency,
        status: 'PAID_AND_FULFILLED',
        confirmedAt: new Date().toISOString(),
      };

      bus.emitEvent('payment.succeeded', `Payment executed and settled for ₹${state.canonicalCheckout.total_rupees}`);
      bus.emitEvent('order.completed', `Order ${state.canonicalCheckout.order_id} successfully confirmed with ${state.canonicalCheckout.merchant_name}`);

      state.status = 'SUCCEEDED';
      state.completedAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      this.store.saveRun(state);

      bus.emitEvent('agent.completed', 'Autonomous shopping purchase successfully resumed and completed!');
      return state;
    }

    // If rejected or cancelled
    if (statusResult.status === 'REJECTED' || statusResult.status === 'CANCELLED' || statusResult.status === 'DENIED') {
      state.status = 'TERMINATED_BY_POLICY';
      state.completedAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      state.error = {
        code: 'APPROVAL_REJECTED',
        message: 'Transaction was rejected by human principal in Frame.',
        step: 'TERMINATED_BY_POLICY',
      };
      this.store.saveRun(state);
      bus.emitEvent('approval.rejected', 'Payment intent was rejected by human principal.');
      return state;
    }

    // Still pending
    bus.emitEvent('approval.pending', `Payment intent ${paymentIntentId} is still awaiting human authorization.`);
    return state;
  }

  /**
   * Cancels a running or paused agent run.
   */
  async cancelRun(runId: string, reason = 'Cancelled by user'): Promise<AgentExecutionState> {
    const state = this.store.getRun(runId);
    if (!state) {
      throw new Error(`Run ${runId} not found.`);
    }

    const bus = new AgentEventBus(runId);
    state.status = 'CANCELLED';
    state.completedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    state.error = {
      code: 'USER_CANCELLED',
      message: reason,
      step: 'CANCELLED',
    };
    this.store.saveRun(state);
    bus.emitEvent('agent.cancelled', `Agent execution cancelled: ${reason}`);
    return state;
  }

  /**
   * Executes a complete autonomous shopping purchase workflow from natural language.
   */
  async execute(rawInstruction: string, options: { runId?: string; agentApiKey?: string } = {}): Promise<AgentExecutionState> {
    const runId = options.runId || `run_${ulid()}`;
    const conversationId = `conv_${ulid()}`;
    const bus = new AgentEventBus(runId);
    const logger = new AgentLogger({ runId, prefix: 'FrameShoppingAgent' });
    const costController = new CostController();

    if (options.agentApiKey) {
      this.frame.setApiKey(options.agentApiKey);
    }

    const state: AgentExecutionState = {
      runId,
      conversationId,
      rawInstruction,
      status: 'INITIALIZING',
      discoveredProducts: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Forward events to execution store
    bus.on('*', (event) => {
      this.store.addEvent(runId, event);
    });

    const updateStatus = (status: AgentExecutionStatus) => {
      costController.checkLiveness();
      state.status = status;
      state.updatedAt = new Date().toISOString();
      this.store.saveRun(state);
    };

    try {
      // ── STEP 1: INITIALIZE & AUDIT INPUT ─────────────────────────────────
      logger.info('Initializing Autonomous Shopping Agent', { instruction: rawInstruction });
      bus.emitEvent('agent.started', `Autonomous shopping agent started for instruction: "${rawInstruction}"`);

      // Security Check: Ensure user instruction has zero sensitive credentials
      assertNoSensitiveData(rawInstruction, 'user_instruction');

      // ── STEP 2: PARSE INTENT INTO IMMUTABLE STRUCTURE ────────────────────
      updateStatus('PARSING_INTENT');
      costController.recordLlmIteration();
      logger.info('Parsing user natural-language intent into structured constraints');
      const userIntent = await parseUserIntent(rawInstruction, this.llm);
      state.userIntent = userIntent;

      bus.emitEvent('intent.created', `Extracted intent: "${userIntent.product_type}" under ₹${userIntent.max_amount_rupees}`, {
        product_type: userIntent.product_type,
        max_budget_rupees: userIntent.max_amount_rupees,
        currency: userIntent.currency,
      });
      bus.emitEvent('intent.validated', 'User intent verified and locked against mutation');

      // ── STEP 3: SEARCH PRODUCTS VIA MERCHANT ─────────────────────────────
      updateStatus('SEARCHING_CATALOG');
      costController.recordBrowserAction();
      logger.info(`Searching merchant catalog for "${userIntent.product_type}" up to ₹${userIntent.max_amount_rupees}`);
      bus.emitEvent('search.started', `Querying merchant "${this.merchant.merchantName}" catalog for "${userIntent.product_type}"`);

      const products = await this.merchant.searchProducts(userIntent.product_type, userIntent.max_amount_rupees);
      state.discoveredProducts = products;

      for (const p of products) {
        bus.emitEvent('product.found', `Discovered product: ${p.name} (₹${p.price_rupees})`, p);
      }

      if (products.length === 0) {
        throw new Error(`No products matching "${userIntent.product_type}" found within budget ₹${userIntent.max_amount_rupees}`);
      }

      // ── STEP 4: COMPARE PRODUCTS & SELECT BEST MATCH ─────────────────────
      updateStatus('COMPARING_PRODUCTS');
      logger.info(`Evaluating ${products.length} candidate products transparently`);
      const selection = selectBestProduct(products, userIntent);

      if (!selection) {
        throw new Error(`No products satisfied budget, stock, and preference criteria.`);
      }

      state.selectedProduct = selection.selected;
      state.selectionReason = selection.reason;
      updateStatus('PRODUCT_SELECTED');

      logger.info(`Product selected: ${selection.selected.name}`, { reason: selection.reason });
      bus.emitEvent('product.selected', `Selected ${selection.selected.name} (₹${selection.selected.price_rupees})`, {
        product: selection.selected,
        reason: selection.reason,
      });

      // ── STEP 5: ADD TO CART & PROCEED TO CHECKOUT ─────────────────────────
      updateStatus('CARTING_ITEM');
      costController.recordBrowserAction();
      bus.emitEvent('cart.updated', `Added ${selection.selected.name} to cart`);
      const cart = await this.merchant.addToCart(selection.selected.id, userIntent.quantity);

      updateStatus('CHECKING_OUT');
      costController.recordBrowserAction();
      bus.emitEvent('checkout.started', `Initiating merchant checkout session at ${this.merchant.merchantName}`);
      const checkoutSession = await this.merchant.proceedToCheckout(cart);

      // ── STEP 6: CANONICALIZE CHECKOUT TOTALS ──────────────────────────────
      updateStatus('CANONICALIZING_CHECKOUT');
      const canonical = canonicalizeCheckout(checkoutSession);
      state.canonicalCheckout = canonical;

      bus.emitEvent(
        'checkout.canonicalized',
        `Canonical checkout extracted: Total ₹${canonical.total_rupees} (Subtotal: ₹${canonical.subtotal_paise / 100}, Shipping: ₹${canonical.shipping_paise / 100})`,
        canonical
      );

      // ── STEP 7: INTENT BINDING VERIFICATION ───────────────────────────────
      updateStatus('BINDING_VERIFICATION');
      logger.info('Verifying Intent Binding against original immutable constraints');

      // Fetch payment authorities to inspect constraints
      updateStatus('CHECKING_FRAME_AUTHORITY');
      costController.recordToolCall();
      bus.emitEvent('frame.authority.checked', 'Querying Frame for active delegated payment authorities');
      const authorities = await this.frame.listAuthorities();
      const activeAuthority = authorities.find((a) => a.status === 'ACTIVE');

      // Strict fail-closed intent binding check
      verifyIntentBinding(userIntent, canonical, activeAuthority);
      bus.emitEvent('intent.binding.checked', 'Intent binding verified: purchase strictly adheres to user budget and authority');

      // ── STEP 8: CREATE PAYMENT INTENT VIA FRAME POLICY FIREWALL ───────────
      updateStatus('CREATING_PAYMENT_INTENT');
      costController.recordToolCall();
      const idempotencyKey = `agent_run_${runId}_${canonical.order_id}`;

      bus.emitEvent(
        'frame.payment_intent.created',
        `Submitting Payment Intent to Frame Policy Firewall for ₹${canonical.total_rupees}`,
        { idempotencyKey, amountPaise: canonical.total_paise }
      );

      const paymentResult = await this.frame.createPaymentIntent({
        amount_paise: canonical.total_paise,
        currency: canonical.currency,
        merchant: canonical.merchant_name,
        merchant_reference: canonical.order_id,
        order_reference: canonical.order_id,
        purpose: canonical.purpose,
        category: canonical.category,
        idempotency_key: idempotencyKey,
        metadata: {
          run_id: runId,
          agent: 'Frame Autonomous Shopping Agent v1.0',
          product_id: canonical.product_id,
        },
      });

      state.framePaymentIntent = paymentResult;
      bus.emitEvent(
        'frame.decision.received',
        `Frame Policy Firewall Decision: ${paymentResult.decision}`,
        paymentResult
      );

      // ── STEP 9: RESPECT FRAME POLICY DECISION ─────────────────────────────
      if (paymentResult.decision === 'DENY' || paymentResult.status === 'DENIED') {
        updateStatus('TERMINATED_BY_POLICY');
        const reasons = paymentResult.reasons?.join(', ') || paymentResult.reason_code || 'Policy violation';
        bus.emitEvent('payment.failed', `Payment denied by Frame Policy Firewall: ${reasons}`);
        state.error = { code: 'FRAME_POLICY_DENIAL', message: reasons, step: 'TERMINATED_BY_POLICY' };
        state.completedAt = new Date().toISOString();
        this.store.saveRun(state);
        return state;
      }

      if (paymentResult.decision === 'REQUIRE_APPROVAL' || paymentResult.status === 'PENDING_APPROVAL') {
        updateStatus('WAITING_FOR_HUMAN_APPROVAL');
        const reasons = paymentResult.reasons?.join(', ') || 'Transaction requires human authorization';

        // Notify Frame approval system
        await this.frame.requestApproval(
          paymentResult.payment_intent_id,
          `Autonomous agent shopping purchase for ${canonical.product_name}. Order: ${canonical.order_id}`
        );

        state.humanInterventionRequired = {
          reason: reasons,
          paymentIntentId: paymentResult.payment_intent_id,
          requestedAt: new Date().toISOString(),
        };

        bus.emitEvent('approval.requested', `Human approval required: ${reasons}`, {
          paymentIntentId: paymentResult.payment_intent_id,
          amount: canonical.total_rupees,
          merchant: canonical.merchant_name,
        });
        bus.emitEvent('human.intervention.required', 'Execution paused awaiting human principal authorization');

        this.store.saveRun(state);
        return state;
      }

      // ── STEP 10: EXECUTE AUTHORIZED PAYMENT & CONFIRM ORDER ───────────────
      updateStatus('EXECUTING_PAYMENT');
      costController.recordBrowserAction();
      bus.emitEvent('payment.started', `Payment intent ${paymentResult.payment_intent_id} authorized. Confirming merchant order…`);

      const merchantConfirmed = await this.merchant.confirmPayment(
        canonical.order_id,
        paymentResult.payment_intent_id
      );

      if (!merchantConfirmed) {
        throw new Error(`Merchant failed to confirm payment for order ${canonical.order_id}`);
      }

      state.orderConfirmation = {
        orderId: canonical.order_id,
        merchant: canonical.merchant_name,
        amount: canonical.total_rupees,
        currency: canonical.currency,
        status: 'PAID_AND_FULFILLED',
        confirmedAt: new Date().toISOString(),
      };

      bus.emitEvent('payment.succeeded', `Payment executed and settled for ₹${canonical.total_rupees}`);
      bus.emitEvent('order.completed', `Order ${canonical.order_id} successfully confirmed with ${canonical.merchant_name}`);

      updateStatus('SUCCEEDED');
      state.completedAt = new Date().toISOString();
      bus.emitEvent('agent.completed', 'Autonomous shopping purchase successfully completed!');
      this.store.saveRun(state);
      return state;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Agent execution halted on error', { error: msg, status: state.status });

      const isSecurityError = msg.includes('Security') || msg.includes('prohibited') || msg.includes('injection') || msg.includes('SSRF');
      const isCostError = msg.includes('limit') || msg.includes('Halting runaway');
      const finalStatus: AgentExecutionStatus = isSecurityError ? 'TERMINATED_BY_SECURITY' : 'FAILED';

      state.status = finalStatus;
      state.error = {
        code: isSecurityError ? 'SECURITY_VIOLATION' : isCostError ? 'COST_LIMIT_EXCEEDED' : 'EXECUTION_ERROR',
        message: msg,
        step: state.status,
      };
      state.completedAt = new Date().toISOString();

      bus.emitEvent('agent.failed', `Execution failed: ${msg}`, { error: msg, status: finalStatus });
      this.store.saveRun(state);
      return state;
    }
  }
}
