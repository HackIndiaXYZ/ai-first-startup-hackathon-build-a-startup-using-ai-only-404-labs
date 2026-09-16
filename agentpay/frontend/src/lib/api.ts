const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('frame_token');
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    if (options.body || ['POST', 'PUT', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    let data: Record<string, unknown> | null = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { message: text } };
      }
    }

    if (!res.ok) {
      const errPayload = data as { error?: { message?: string; code?: string } } | null;
      const err = new Error(errPayload?.error?.message || 'Request failed');
      (err as Error & { code?: string; status?: number }).code = errPayload?.error?.code;
      (err as Error & { code?: string; status?: number }).status = res.status;
      throw err;
    }

    return data as T;
  }

  get<T>(path: string) { return this.request<T>(path); }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }
  patch<T>(path: string, body: unknown = {}) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  }
  delete<T>(path: string) { return this.request<T>(path, { method: 'DELETE' }); }
}

export const api = new ApiClient(`${API_BASE}/v1`);
export const healthApi = new ApiClient(API_BASE);

// ── Auth ──────────────────────────────────────────────

export interface LoginPayload { email: string; password: string; }
export interface RegisterPayload { email: string; password: string; name: string; organization_name: string; }

export const authApi = {
  login: (body: LoginPayload) => api.post<{ data: { token: string; user: User; organization: Organization } }>('/auth/login', body),
  register: (body: RegisterPayload) => api.post<{ data: { token: string; user: User; organization: Organization } }>('/auth/register', body),
  me: () => api.get<{ data: { user: User; organization: Organization } }>('/auth/me'),
};

// ── Agents ────────────────────────────────────────────

export const agentsApi = {
  list: () => api.get<{ data: Agent[] }>('/agents'),
  get: (id: string) => api.get<{ data: Agent }>(`/agents/${id}`),
  create: (body: Partial<Agent>) => api.post<{ data: Agent }>('/agents', body),
  update: (id: string, body: Partial<Agent>) => api.patch<{ data: Agent }>(`/agents/${id}`, body),
  disable: (id: string, reason?: string) => api.post<{ data: Agent }>(`/agents/${id}/disable`, { reason }),
  enable: (id: string) => api.post<{ data: Agent }>(`/agents/${id}/enable`),
  revoke: (id: string, reason?: string) => api.post<{ data: Agent }>(`/agents/${id}/revoke`, { reason }),
  createCredential: (id: string) => api.post<{ data: Credential }>(`/agents/${id}/credentials`),
  rotateCredential: (id: string) => api.post<{ data: Credential }>(`/agents/${id}/credentials/rotate`),
  listCredentials: (id: string) => api.get<{ data: Credential[] }>(`/agents/${id}/credentials`),
  revokeCredential: (agentId: string, credId: string) => api.post(`/agents/${agentId}/credentials/${credId}/revoke`),
};

// ── Policies ──────────────────────────────────────────

export const policiesApi = {
  list: (agentId?: string) => api.get<{ data: Policy[] }>(`/policies${agentId ? `?agent_id=${agentId}` : ''}`),
  get: (id: string) => api.get<{ data: Policy }>(`/policies/${id}`),
  create: (body: Partial<Policy> & { agent_id: string }) => api.post<{ data: Policy }>('/policies', body),
  update: (id: string, body: Partial<Policy>) => api.patch<{ data: Policy }>(`/policies/${id}`, body),
};

// ── Payment Intents ───────────────────────────────────

export const intentsApi = {
  list: (params?: { status?: string; agent_id?: string; page?: number; per_page?: number; limit?: number }) => {
    const qs = params ? '?' + new URLSearchParams(params as unknown as Record<string, string>).toString() : '';
    return api.get<{ data: PaymentIntent[]; meta: Meta }>(`/payment-intents${qs}`);
  },
  get: (id: string) => api.get<{ data: PaymentIntent }>(`/payment-intents/${id}`),
  create: (body: Partial<PaymentIntent>) => api.post<{ data: PaymentIntent }>('/payment-intents', body),
};

// ── Payment Authorities ───────────────────────────────

export const authoritiesApi = {
  list: (params?: { agent_id?: string; status?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return api.get<{ data: PaymentAuthority[] }>(`/payment-authorities${qs}`);
  },
  get: (id: string) => api.get<{ data: PaymentAuthority }>(`/payment-authorities/${id}`),
  create: (body: Record<string, unknown>) => api.post<{ data: PaymentAuthority }>('/payment-authorities', body),
  revoke: (id: string, reason?: string) => api.post<{ data: PaymentAuthority }>(`/payment-authorities/${id}/revoke`, { reason }),
  suspend: (id: string, reason?: string) => api.post<{ data: PaymentAuthority }>(`/payment-authorities/${id}/suspend`, { reason }),
  resume: (id: string) => api.post<{ data: PaymentAuthority }>(`/payment-authorities/${id}/resume`, {}),
};

// ── Approvals ─────────────────────────────────────────

export const approvalsApi = {
  list: (status = 'pending') => api.get<{ data: ApprovalTask[] }>(`/approvals?status=${status}`),
  get: (id: string) => api.get<{ data: ApprovalTask }>(`/approvals/${id}`),
  approve: (id: string, comment?: string) => api.post(`/approvals/${id}/approve`, { comment }),
  reject: (id: string, comment?: string) => api.post(`/approvals/${id}/reject`, { comment }),
};

// ── Transactions ──────────────────────────────────────

export const txApi = {
  list: (params?: { status?: string; agent_id?: string; page?: number; per_page?: number }) => {
    const qs = params ? '?' + new URLSearchParams(params as unknown as Record<string, string>).toString() : '';
    return api.get<{ data: Transaction[]; meta: Meta }>(`/transactions${qs}`);
  },
  get: (id: string) => api.get<{ data: Transaction }>(`/transactions/${id}`),
  refund: (id: string, reason?: string) => api.post<{ data: Record<string, unknown>; status: string; message: string }>(`/transactions/${id}/refund`, { reason }),
};

// ── Webhooks ──────────────────────────────────────────

export const webhooksApi = {
  list: () => api.get<{ data: WebhookEvent[] }>('/webhooks/events'),
};

// ── Audit ─────────────────────────────────────────────

export const auditApi = {
  list: (params?: { resource_type?: string; resource_id?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return api.get<{ data: AuditEvent[]; meta: Meta }>(`/audit-events${qs}`);
  },
};

// ── Overview ──────────────────────────────────────────

export const overviewApi = {
  get: () => api.get<{ data: Overview }>('/overview'),
};

// ── Providers ─────────────────────────────────────────

export const providersApi = {
  list: () => api.get<{
    data: {
      available_providers: Array<{ providerType: string; name: string; supportedRails: string[] }>;
      configured_providers: Array<{ id: string; provider_type: string; name: string; is_default: boolean; status: string; created_at: string }>;
    }
  }>('/providers'),
  configure: (body: { provider_type: string; name: string; is_default?: boolean; webhook_secret?: string; settings?: Record<string, unknown> }) =>
    api.post('/providers', body),
};

// ── Types ─────────────────────────────────────────────

export interface User { id: string; email: string; name: string; role: string; }
export interface Organization { id: string; name: string; slug: string; frame_env: string; }
export interface Agent {
  id: string; name: string; description?: string; owner_team?: string; purpose?: string;
  status: 'active' | 'disabled' | 'revoked'; frame_env: string;
  credential_count?: number; total_payments?: number; total_spend_paise?: number;
  last_used_at?: string;
  created_at: string; updated_at: string;
}
export interface Credential {
  id: string; agent_id: string; key_prefix: string; api_key?: string;
  status: 'active' | 'revoked'; last_used_at?: string; created_at: string;
}
export interface Policy {
  id: string; agent_id: string; name: string; status: string;
  version_number?: number; transaction_limit_paise?: number;
  daily_limit_paise?: number; monthly_limit_paise?: number;
  approval_threshold_paise?: number;
  merchant_allowlist?: string[]; merchant_blocklist?: string[];
  created_at: string; updated_at: string;
}
export interface PaymentAuthority {
  id: string;
  organization_id: string;
  agent_id: string;
  agent_name?: string;
  user_id: string;
  provider: string;
  rail: string;
  currency: string;
  max_transaction_amount_paise: number;
  daily_limit_paise: number;
  monthly_limit_paise: number;
  requires_approval_above_paise?: number | null;
  allowed_categories?: string[];
  blocked_categories?: string[];
  allowed_merchants?: string[];
  blocked_merchants?: string[];
  spent_today_paise: number;
  spent_this_month_paise: number;
  remaining_today_paise: number;
  remaining_month_paise: number;
  purpose?: string | null;
  valid_from: string;
  valid_until: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
  revocation_reason?: string | null;
  created_at: string;
  updated_at: string;
}
export interface PaymentIntent {
  id: string; agent_id: string; agent_name?: string;
  amount_paise: number; currency: string; merchant: string; purpose: string;
  status: string; decision?: string; denial_reason?: string;
  firewall?: { decision: string; reasons: string[]; risk_level: string };
  created_at: string; updated_at: string;
}
export interface ApprovalTask {
  id: string; payment_intent_id: string; organization_id: string;
  status: string; requested_at: string; expires_at: string;
  decided_by?: string; decided_at?: string; comment?: string;
  amount_paise?: number; merchant?: string; purpose?: string;
  agent_id?: string; agent_name?: string;
  reasons?: string[]; risk_level?: string;
}
export interface Transaction {
  id: string; payment_intent_id: string; provider: string;
  provider_payment_id?: string; amount_paise: number; currency: string;
  status: string; merchant?: string; purpose?: string; agent_name?: string;
  created_at: string; updated_at: string;
}
export interface AuditEvent {
  id: string; organization_id: string; actor_type: string; actor_id?: string;
  action: string; resource_type?: string; resource_id?: string;
  decision?: string; occurred_at: string;
}
export interface WebhookEvent {
  id: string; provider: string; event_id: string; event_type: string;
  verified: boolean; processed: boolean; processed_at?: string;
  payment_id?: string; payment_status?: string;
  amount_paise?: number; currency?: string;
  created_at: string;
}
export interface Overview {
  active_agents: number; pending_approvals: number; blocked_payments: number;
  total_spend_paise: number; today_spend_paise: number;
  payment_success_rate: number;
  payment_intents_by_status: Record<string, number>;
}
export interface Meta { total: number; page: number; per_page: number; total_pages: number; }
