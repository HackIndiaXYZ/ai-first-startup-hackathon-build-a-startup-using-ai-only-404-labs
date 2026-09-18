import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertNoSensitiveData } from '../security/sensitive-data';
import { PaymentAuthorityConstraints } from '../checkout/intent-binding';

export interface FrameClientConfig {
  apiUrl?: string;
  agentApiKey?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
}

export interface CreatePaymentIntentResult {
  payment_intent_id: string;
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY' | 'UNKNOWN';
  status: string;
  amount: number;
  currency: string;
  merchant: string;
  next_action: 'PAYMENT_EXECUTION' | 'WAIT_FOR_APPROVAL' | 'DO_NOT_RETRY' | 'UNKNOWN';
  reason_code?: string;
  reasons?: string[];
  approval_task_id?: string;
}

export interface PaymentStatusResult {
  payment_intent_id: string;
  status: string;
  decision: string;
  amount: number;
  currency: string;
  merchant: string;
  is_terminal: boolean;
  next_action: string;
}

export class FrameMcpClient {
  private apiUrl: string;
  private agentApiKey: string;
  private mcpClient: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;

  constructor(config: FrameClientConfig = {}) {
    this.apiUrl = (config.apiUrl || process.env.FRAME_API_URL || 'https://frame-backend-868z.onrender.com/v1').replace(/\/$/, '');
    this.agentApiKey = config.agentApiKey || process.env.FRAME_AGENT_API_KEY || '';
  }

  setApiKey(key: string): void {
    this.agentApiKey = key.trim();
  }

  getApiKey(): string {
    return this.agentApiKey;
  }

  /**
   * Connects to the Frame MCP server via Stdio transport.
   */
  async connect(mcpEntryPath?: string): Promise<void> {
    if (this.isConnected && this.mcpClient) return;

    try {
      const backendDir = path.resolve(__dirname, '../../../agentpay/backend');
      this.transport = new StdioClientTransport({
        command: 'npm',
        args: ['--prefix', backendDir, 'run', 'mcp'],
        env: {
          ...process.env,
          FRAME_API_URL: this.apiUrl,
          FRAME_AGENT_API_KEY: this.agentApiKey,
        },
      });

      this.mcpClient = new Client(
        { name: 'frame-autonomous-shopping-agent', version: '1.0.0' },
        { capabilities: {} }
      );

      await this.mcpClient.connect(this.transport);
      this.isConnected = true;
    } catch {
      // If stdio transport setup fails (e.g. backend files path differs), fallback to direct REST API
      this.isConnected = false;
    }
  }

  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close().catch(() => null);
      this.mcpClient = null;
    }
    this.isConnected = false;
  }

  /**
   * Discovers available tools via MCP protocol.
   */
  async listTools(): Promise<string[]> {
    if (this.isConnected && this.mcpClient) {
      const tools = await this.mcpClient.listTools();
      return tools.tools.map((t) => t.name);
    }
    return [
      'frame_create_payment_intent',
      'frame_get_payment_status',
      'frame_get_payment_intent',
      'frame_request_approval',
      'frame_list_payment_authorities',
      'frame_get_payment_authority',
    ];
  }

  /**
   * 1. Inspect Payment Authorities
   */
  async listAuthorities(): Promise<PaymentAuthorityConstraints[]> {
    assertNoSensitiveData(this.agentApiKey);

    // Call via REST fallback or MCP tool
    const res = await fetch(`${this.apiUrl}/payment-authorities`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.agentApiKey,
      },
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 401) return [];
      throw new Error(`Failed to list authorities: HTTP ${res.status}`);
    }

    const body = (await res.json()) as any;
    const items = body.data || [];

    return items.map((a: any) => ({
      authority_id: a.id,
      max_transaction_amount_paise: a.max_transaction_amount_paise || 500000,
      daily_limit_paise: a.daily_limit_paise,
      remaining_daily_budget_paise: a.remaining_daily_budget_paise,
      monthly_limit_paise: a.monthly_limit_paise,
      requires_approval_above_paise: a.requires_approval_above_paise,
      allowed_merchants: a.allowed_merchants || [],
      blocked_merchants: a.blocked_merchants || [],
      allowed_categories: a.allowed_categories || [],
      blocked_categories: a.blocked_categories || [],
      status: a.status || 'ACTIVE',
    }));
  }

  /**
   * 2. Create Payment Intent through Frame Policy Firewall
   */
  async createPaymentIntent(params: {
    amount_paise: number;
    currency?: string;
    merchant: string;
    merchant_reference?: string;
    order_reference?: string;
    purpose: string;
    category?: string;
    idempotency_key: string;
    metadata?: Record<string, unknown>;
  }): Promise<CreatePaymentIntentResult> {
    assertNoSensitiveData(params);

    if (this.isConnected && this.mcpClient) {
      try {
        const toolRes = (await this.mcpClient.callTool({
          name: 'frame_create_payment_intent',
          arguments: {
            ...params,
            agent_api_key: this.agentApiKey,
          },
        })) as any;

        const content = toolRes.content?.[0]?.text;
        if (content) {
          return JSON.parse(content);
        }
      } catch (err: any) {
        // Fallback to REST endpoint on MCP transport error
      }
    }

    const payload = {
      amount_paise: params.amount_paise,
      currency: params.currency || 'INR',
      merchant: params.merchant,
      merchant_reference: params.merchant_reference || params.order_reference,
      purpose: params.purpose,
      category: params.category,
      idempotency_key: params.idempotency_key,
      metadata: params.metadata || {},
    };

    const res = await fetch(`${this.apiUrl}/payment-intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.agentApiKey,
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      const err = body?.error || {};
      throw new Error(err.message || `Frame payment intent failed: HTTP ${res.status}`);
    }

    const intent = body.data;
    const firewall = intent.firewall || {};
    const decision = firewall.decision || intent.decision || 'ALLOW';

    let nextAction: 'PAYMENT_EXECUTION' | 'WAIT_FOR_APPROVAL' | 'DO_NOT_RETRY' | 'UNKNOWN' = 'PAYMENT_EXECUTION';
    if (decision === 'REQUIRE_APPROVAL' || intent.status === 'PENDING_APPROVAL') {
      nextAction = 'WAIT_FOR_APPROVAL';
    } else if (decision === 'DENY' || intent.status === 'DENIED') {
      nextAction = 'DO_NOT_RETRY';
    }

    return {
      payment_intent_id: intent.id,
      decision,
      status: intent.status,
      amount: intent.amount_paise / 100,
      currency: intent.currency,
      merchant: intent.merchant,
      next_action: nextAction,
      reason_code: intent.denial_reason || undefined,
      reasons: firewall.reasons || (intent.denial_reason ? [intent.denial_reason] : []),
      approval_task_id: intent.approval_task_id || undefined,
    };
  }

  /**
   * 3. Poll Payment Status
   */
  async getPaymentStatus(paymentIntentId: string): Promise<PaymentStatusResult> {
    assertNoSensitiveData({ paymentIntentId });

    const res = await fetch(`${this.apiUrl}/payment-intents/${paymentIntentId}`, {
      method: 'GET',
      headers: { 'X-API-Key': this.agentApiKey },
    });

    if (!res.ok) {
      throw new Error(`Failed to query payment status: HTTP ${res.status}`);
    }

    const body = (await res.json()) as any;
    const intent = body.data;
    const status = intent.status;
    const decision = intent.firewall_decision || intent.decision || 'UNKNOWN';

    const isTerminal = ['SETTLED', 'COMPLETED', 'SUCCEEDED', 'DENIED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(
      status
    );

    let nextAction = 'IN_PROGRESS';
    if (['SETTLED', 'COMPLETED', 'SUCCEEDED'].includes(status)) {
      nextAction = 'NONE';
    } else if (status === 'PENDING_APPROVAL') {
      nextAction = 'WAIT_FOR_APPROVAL';
    } else if (['DENIED', 'REJECTED', 'FAILED'].includes(status)) {
      nextAction = 'DO_NOT_RETRY';
    }

    return {
      payment_intent_id: intent.id,
      status,
      decision,
      amount: intent.amount_paise / 100,
      currency: intent.currency,
      merchant: intent.merchant,
      is_terminal: isTerminal,
      next_action: nextAction,
    };
  }

  async getPaymentIntentStatus(paymentIntentId: string): Promise<PaymentStatusResult> {
    return this.getPaymentStatus(paymentIntentId);
  }

  /**
   * 4. Request Human Approval
   */
  async requestApproval(paymentIntentId: string, notes?: string): Promise<{ success: boolean; message: string }> {
    assertNoSensitiveData({ paymentIntentId, notes });

    const res = await fetch(`${this.apiUrl}/payment-intents/${paymentIntentId}/request-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.agentApiKey,
      },
      body: JSON.stringify({ notes }),
    });

    if (!res.ok) {
      return { success: false, message: `Failed to request approval: HTTP ${res.status}` };
    }

    return { success: true, message: 'Approval requested from human principal.' };
  }
}
