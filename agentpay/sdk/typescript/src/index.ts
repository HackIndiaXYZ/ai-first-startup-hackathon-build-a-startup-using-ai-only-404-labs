import * as http from 'http';
import * as https from 'https';

export interface FrameClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface PaymentRequest {
  amount: number; // in standard currency units (e.g., INR 50.00)
  currency?: string;
  merchant: string;
  purpose: string;
  category?: string;
  merchantReference?: string;
  taskReference?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  expiresInSeconds?: number;
}

export interface PaymentDecision {
  id: string;
  status: 'PENDING' | 'EVALUATING' | 'AUTHORIZED' | 'PENDING_APPROVAL' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'DENIED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  amountPaise: number;
  currency: string;
  merchant: string;
  purpose: string;
  decision?: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  denialReason?: string;
  requiresApproval: boolean;
  approvalTaskId?: string;
  transactionId?: string;
  createdAt: string;
}

export class FramePaymentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'FramePaymentError';
  }
}

export class FrameClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: FrameClientOptions) {
    if (!options.apiKey) {
      throw new Error('FrameClient requires an apiKey (e.g. frm_live_... or frm_test_...)');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'http://localhost:3001').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs || 30000;
  }

  /**
   * Execute or request a payment on behalf of the agent.
   * If the transaction conforms to policy limits, it is auto-approved and executed.
   * If it exceeds approval thresholds, it enters PENDING_APPROVAL and alerts human reviewers.
   */
  async pay(request: PaymentRequest): Promise<PaymentDecision> {
    const amountPaise = Math.round(request.amount * 100);
    const idempotencyKey = request.idempotencyKey || `agent_pay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const payload = {
      amount_paise: amountPaise,
      currency: request.currency || 'INR',
      merchant: request.merchant,
      merchant_reference: request.merchantReference,
      purpose: request.purpose,
      task_reference: request.taskReference,
      idempotency_key: idempotencyKey,
      category: request.category,
      metadata: request.metadata,
      expires_in_seconds: request.expiresInSeconds || 3600,
    };

    const res = await this.request<{ data: any }>('/v1/payment-intents', {
      method: 'POST',
      body: payload,
    });

    const data = res.data;
    return {
      id: data.id,
      status: data.status,
      amountPaise: data.amount_paise,
      currency: data.currency,
      merchant: data.merchant,
      purpose: data.purpose,
      decision: data.decision,
      denialReason: data.denial_reason,
      requiresApproval: data.status === 'PENDING_APPROVAL',
      approvalTaskId: data.approval_task_id,
      transactionId: data.transaction_id,
      createdAt: data.created_at,
    };
  }

  /**
   * Check status of a previously requested payment intent
   */
  async getIntent(id: string): Promise<PaymentDecision> {
    const res = await this.request<{ data: any }>(`/v1/payment-intents/${id}`);
    const data = res.data;
    return {
      id: data.id,
      status: data.status,
      amountPaise: data.amount_paise,
      currency: data.currency,
      merchant: data.merchant,
      purpose: data.purpose,
      decision: data.decision,
      denialReason: data.denial_reason,
      requiresApproval: data.status === 'PENDING_APPROVAL',
      approvalTaskId: data.approval_task_id,
      transactionId: data.transaction_id,
      createdAt: data.created_at,
    };
  }

  /**
   * Explicitly trigger payment execution for an authorized or approved intent
   */
  async executeIntent(id: string, options?: { provider?: string }): Promise<any> {
    return this.request<{ data: any }>(`/v1/payment-intents/${id}/execute`, {
      method: 'POST',
      body: options || {},
    });
  }

  /**
   * Fetch payment record by payment ID
   */
  async getPayment(id: string): Promise<any> {
    return this.request<{ data: any }>(`/v1/payments/${id}`);
  }

  /**
   * List payment records
   */
  async listPayments(query?: { limit?: number; offset?: number; status?: string }): Promise<any> {
    const params = new URLSearchParams();
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    if (query?.status) params.set('status', query.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ data: any }>(`/v1/payments${qs}`);
  }

  /**
   * List authorities available to this agent or tenant
   */
  async listAuthorities(status?: string): Promise<any> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{ data: any }>(`/v1/payment-authorities${qs}`);
  }

  /**
   * Get specific authority details
   */
  async getAuthority(id: string): Promise<any> {
    return this.request<{ data: any }>(`/v1/payment-authorities/${id}`);
  }

  /**
   * Helper tool declaration compatible with LangChain / OpenAI Functions / Vercel AI SDK
   */
  asToolDefinition() {
    return {
      name: 'execute_payment',
      description: 'Make a real-world payment with spending limits, category guardrails, and audit logging.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Payment amount in INR (e.g. 250.00)' },
          merchant: { type: 'string', description: 'Name of the vendor/merchant' },
          purpose: { type: 'string', description: 'Business justification for this expense' },
          category: { type: 'string', description: 'Category (e.g. cloud, saas, compute, marketing)' },
        },
        required: ['amount', 'merchant', 'purpose'],
      },
    };
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const postData = options.body ? JSON.stringify(options.body) : null;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-API-Key': this.apiKey,
        'User-Agent': '@frame-pay/sdk-ts/1.0.0',
      };
      if (postData) {
        headers['Content-Length'] = Buffer.byteLength(postData).toString();
      }

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: options.method || 'GET',
          headers,
          timeout: this.timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            let parsed: any;
            try {
              parsed = JSON.parse(body);
            } catch {
              parsed = { raw: body };
            }

            if (res.statusCode && res.statusCode >= 400) {
              const errCode = parsed.error?.code || 'API_ERROR';
              const errMsg = parsed.error?.message || `Request failed with status ${res.statusCode}`;
              return reject(new FramePaymentError(errMsg, errCode, res.statusCode, parsed));
            }

            resolve(parsed as T);
          });
        }
      );

      req.on('error', (err) => reject(new FramePaymentError(err.message, 'NETWORK_ERROR')));
      req.on('timeout', () => {
        req.destroy();
        reject(new FramePaymentError('Request timed out', 'TIMEOUT_ERROR'));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }
}
