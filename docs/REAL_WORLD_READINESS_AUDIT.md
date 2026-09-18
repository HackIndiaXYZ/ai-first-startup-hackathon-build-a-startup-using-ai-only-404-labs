# Frame & AI Shopping Agent: Real-World Readiness Audit

**Audit Date**: September 19, 2026  
**Auditor**: Frame Core Systems Engineering  
**Scope**: Frame Financial Control Plane (`agentpay/`), AI Shopping Agent (`agent/`), Storefront Layer (`agentpay/backend/src/demo-merchant/`), and MCP Gateway.

---

## 1. Capability Classification Matrix

| Capability | Status | Evidence | Limitation |
|---|---|---|---|
| **AI Reasoning (Multi-turn ReAct)** | `REAL_PRODUCTION` | `agent/src/llm/openai-compatible.ts`, `agent/src/llm/anthropic-provider.ts`, `agent/src/core/react-loop.ts` | Requires valid external LLM API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). Deterministic provider preserved strictly for offline CI. |
| **Browser Automation** | `REAL_PRODUCTION` | `agent/src/browser/playwright-browser.ts` running real Google Chrome (`/Applications/Google Chrome.app`) via `playwright-core` | Requires local Chrome binary or Chromium container. |
| **Merchant Storefront Experience** | `REAL_SANDBOX` | `agentpay/backend/src/demo-merchant/server.ts` rendering HTML pages (`/store`, `/store/products/:id`, `/store/cart`, `/store/checkout`, `/store/orders/:id`) | Demo merchant running on port 3002. Third-party merchants require domain-specific selectors or standard schema.org microdata. |
| **Checkout Canonicalization** | `REAL_PRODUCTION` | `agent/src/checkout/checkout-extractor.ts`, `agent/src/browser/extraction.ts` extracting `data-subtotal`, `data-shipping`, `data-tax`, `data-total` | Extracts from standard semantic DOM attributes or microdata. |
| **Intent Binding & Budget Lock** | `REAL_PRODUCTION` | `agent/src/intent/validator.ts`, `agent/src/checkout/intent-binding.ts` with `Object.freeze()` | Immutable once parsed. Cannot be overridden by LLM, prompt injection, or merchant HTML. |
| **Frame MCP Connection** | `REAL_PRODUCTION` | `agent/src/frame/frame-mcp-client.ts`, `agentpay/backend/src/mcp/server.ts` via `@modelcontextprotocol/sdk` Stdio & HTTP | Discovers tools, validates schemas, parses structured output, reconnects safely. Zero direct DB bypass. |
| **Payment Authority Delegation** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/payment-authorities/`, PostgreSQL `payment_authorities` table | Enforces daily spend limits, per-transaction caps, category allowlist, merchant allowlist, expiry. |
| **Policy Firewall** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/policies/`, `agentpay/backend/src/modules/payment-intents/policy-evaluator.ts` | Multi-rule engine (`ALLOW`, `REQUIRE_APPROVAL`, `DENY`). Fail-closed design. |
| **Payment Execution (Orchestrator)** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/payments/orchestrator/payment-orchestrator.ts` | Idempotency keys, state transitions (`PENDING` -> `PROCESSING` -> `SUCCESS`), distributed locking. |
| **Razorpay Integration** | `REAL_SANDBOX` | `agentpay/backend/src/modules/payments/providers/razorpay-provider.ts` | Test keys (`rzp_test_...`). Real money transfer requires production Razorpay KYC & live keys. |
| **Webhook Ingestion & Signatures** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/payments/webhooks/webhook-handler.ts` with HMAC-SHA256 signature verification | Webhook secrets must be properly configured per environment. |
| **Order Fulfillment** | `REAL_SANDBOX` | `agentpay/backend/src/demo-merchant/server.ts` callback `/orders/:id/confirm` | Confirms order status to `PAID` upon authoritative payment verification. |
| **Human Approvals** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/approvals/`, Next.js Dashboard `/approvals` & `/agent-demo` | Principal approval updates intent; agent resumes paused run automatically without restarting. Zero agent self-approval. |
| **Refunds & Dispute Handling** | `REAL_SANDBOX` | `agentpay/backend/src/modules/payments/routes.ts` (`/v1/payments/:id/refund`) | Razorpay API sandbox refund and ledger double-entry reversal. |
| **Reconciliation & Ledger** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/payments/ledger/`, `agentpay/backend/src/modules/payments/reconciliation/` | Double-entry bookkeeping (debit/credit), imbalance detection, discrepancy reporting. |
| **Dashboard & Agent Control Center** | `REAL_PRODUCTION` | `agentpay/frontend/src/app/agent-demo/page.tsx`, Next.js 14 App Router | Clean UX, live trace timeline, interactive approval actions, no raw LLM chain-of-thought dumps. |
| **API Authentication & Tenant Isolation** | `REAL_PRODUCTION` | `agentpay/backend/src/middleware/auth.ts`, `agentpay/backend/src/modules/auth/` | Bearer keys (`frm_test_...` / `frm_live_...`) with PBKDF2 hashing, tenant scoping on all SQL queries. |
| **Secrets & Credential Scrubbing** | `REAL_PRODUCTION` | `agent/src/security/sensitive-data.ts`, `agent/src/observability/logger.ts` | Aborts immediately if UPI PIN, OTP, CVV, or passwords are detected in prompt or page. Zero logging/storage. |
| **Web Prompt Injection Defense** | `REAL_PRODUCTION` | `agent/src/security/prompt-injection.ts` | Sanitizes untrusted HTML inputs; browser content treated strictly as untrusted DATA, never instruction authority. |
| **SSRF & Network Restrictions** | `REAL_PRODUCTION` | `agent/src/security/domain-policy.ts` | Blocks private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`, `169.254.169.254`) except explicitly allowlisted local demo merchant. |
| **Cost & Runaway Controls** | `REAL_PRODUCTION` | `agent/src/core/cost-controller.ts` | Maximum 120s runtime, maximum 15 LLM iterations, maximum 25 tool calls. Auto-cancellation on breach. |
| **Persistent Agent State** | `REAL_PRODUCTION` | `agent/src/state/execution-store.ts` writing to `agent/data/runs.json` with synchronous atomic write | State survives process restart, crash, and network drops. |
| **Agent Identity & Attribution** | `REAL_PRODUCTION` | `agentpay/backend/src/modules/agents/`, `agent_id` tracking on all payment intents | Agent ID derived from authenticated API key; untrusted caller cannot spoof `agent_id` or `organization_id`. |
| **Autonomous UPI PIN Bypass** | `NOT_SUPPORTED` | **Zero-Trust Boundary**: Autonomous entry of UPI PIN or OTP is forbidden by RBI regulations and Frame security invariant. | Requires human intervention or pre-approved e-mandate rails. Frame does not fake UPI PIN bypass. |

---

## 2. Detailed Findings & Audit Verification Notes

### A. What Was Already Working
1. **Financial Control Plane**: Frame backend provides complete database models, migrations, authentication, policy evaluation, payment intent lifecycle, ledger double-entry bookkeeping, and Razorpay sandbox integration.
2. **MCP Architecture**: `@modelcontextprotocol/sdk` Stdio server exposes tools: `check_spending_limits`, `request_spending_authority`, `create_payment_intent`, `get_payment_intent_status`, `request_approval`, `list_authorities`.
3. **Intent Parsing & Validation**: Immutable parsing and freezing of user shopping budgets, quantities, and categories.
4. **Security Tests**: 20 rigorous security tests pass (zero credentials, prompt injection, category enforcement).

### B. What Required Real Implementation in This Phase
1. **Real Browser Automation**: Previously, the shopping agent relied on direct JSON fetch requests against the demo store. Upgraded to genuine Playwright browser automation driving Chrome to search, view products, select variants, update cart, and extract DOM checkout values.
2. **Realistic Storefront Pages**: The demo merchant originally had only a single static HTML page with JSON APIs. Upgraded with full HTML views: catalog search, product detail with variant picker, cart, semantic checkout with data attributes, and order confirmation.
3. **Agent Persistence**: Previously, `ExecutionStore` used an in-memory `Map`. Upgraded to durable atomic file-backed storage (`agent/data/runs.json`), ensuring state survives process restarts.
4. **Human Approval Resumption**: Added `POST /agent/runs/:id/resume` and agent polling so that when a human approves a `REQUIRE_APPROVAL` intent in the Frame dashboard, the agent automatically resumes and confirms the order without restarting.
5. **SSRF Guardrails & Cost Controller**: Added strict IP blocking (preventing navigation to internal cloud metadata or arbitrary local ports) and runaway agent limits (max runtime, max iterations, max tool calls).
