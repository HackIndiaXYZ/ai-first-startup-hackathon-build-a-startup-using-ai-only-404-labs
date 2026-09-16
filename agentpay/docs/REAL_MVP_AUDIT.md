# Frame — Complete System Audit (Phase 1)
**Date**: September 11, 2026  
**Document Version**: 1.0.0  
**Status**: Audited against live codebase & real provider contracts  

---

## 1. System Audit Table

| Feature / Subsystem | Current Implementation | Environment | Real? | Missing / Gaps to Working MVP |
| :--- | :--- | :--- | :--- | :--- |
| **1. Frontend** | Next.js 14 App Router dashboard with views for Authorities, Payments, Approvals, Ledger/Transactions, Agents, Policies, Audit, Settings | `REAL_SANDBOX` / `REAL_PRODUCTION` | Yes | Needs end-to-end integration test against live backend running concurrently. |
| **2. Backend API** | Fastify 4 TypeScript REST API with JWT user auth, API keys, JSON schema validation, error handlers | `REAL_SANDBOX` / `REAL_PRODUCTION` | Yes | Need provider-level refund API endpoint and explicit environment configuration guards. |
| **3. Database & Migrations** | PostgreSQL 16 schema (`001_initial.sql`, `002_payment_infrastructure.sql`, `003_payment_authorities.sql`) with row locks, check constraints, foreign keys | `REAL_PRODUCTION` | Yes | Complete. Supports atomic spend reset and tamper-evident ledger chaining. |
| **4. MCP Server** | Model Context Protocol v1.30.0 Stdio server with 6 agent tools (`frame_create_payment_intent`, `frame_get_payment_status`, `frame_request_human_approval`, `frame_get_intent_details`, `frame_list_payment_authorities`, `frame_get_payment_authority`) | `REAL_SANDBOX` / `REAL_PRODUCTION` | Yes | Complete. Fully integrated with Policy Firewall and agent token authentication. |
| **5. Payment Intent Lifecycle** | Strict state machine: `CREATED` -> `EVALUATING` -> `AUTHORIZED` / `DENIED` -> `EXECUTING` -> `SUCCEEDED` / `FAILED` with SHA-256 canonical hash verification | `REAL_PRODUCTION` | Yes | Complete. Database tampering immediately detected and blocked. |
| **6. Payment Authority** | Bounded spend authority entity: per-transaction limit, daily limit, monthly limit, allowed/blocked categories & merchants, purpose, temporal validity, approval thresholds | `REAL_PRODUCTION` | Yes | Complete. Atomic spend tracking and calendar-based reset semantics enforced. |
| **7. Policy Firewall** | Multi-tiered deterministic firewall (`firewall.ts`) evaluating authority bounds, org policies, risk rules, and threshold escalation | `REAL_PRODUCTION` | Yes | Complete. Enforces `REMAINING BUDGET != PERMISSION`. |
| **8. Payment Orchestrator** | Central coordinator (`payment-orchestrator.ts`) with CAS lease acquisition, crash recovery, terminal state immutability, zero-debit on failure | `REAL_PRODUCTION` | Yes | Add explicit provider refund dispatch and error mapping normalization. |
| **9. Provider Registry** | Provider abstraction registry (`provider-registry.ts`) resolving active provider configs and enforcing explicit capability checks | `REAL_PRODUCTION` | Yes | Add refund capability check to provider interface methods. |
| **10. Razorpay Adapter** | Official REST API adapter (`razorpay-provider.ts`) communicating with `api.razorpay.com/v1/orders`, validating HMAC signatures, normalizing events | `REAL_SANDBOX` | Yes | Add `refundPayment` method and provider idempotency header propagation. |
| **11. Webhook System** | Webhook receiver (`webhook-receiver.ts`) with raw body preservation, HMAC-SHA256 verification via `crypto.timingSafeEqual`, deduplication via `webhook_events` | `REAL_SANDBOX` | Yes | Local tunnel configuration documentation and live webhook replay tests. |
| **12. Reconciliation** | Background reconciliation service (`reconciliation.service.ts`) querying remote provider status for `unknown`/`processing` states | `REAL_SANDBOX` | Yes | Add scheduled sweep worker for automatic recovery of stale payments. |
| **13. Ledger** | Tamper-evident double-entry ledger (`ledger.service.ts`) with SHA-256 hash chaining, idempotency guard on `(payment_id, entry_type)` | `REAL_PRODUCTION` | Yes | Add `REFUND` reversal entry handling when refunds are executed. |
| **14. Audit System** | Structured audit logging (`lib/audit.ts`) recording actor types, resource IDs, state diffs, timestamps in `audit_events` | `REAL_PRODUCTION` | Yes | Complete. Emits immutable audit trails on all decisions and mutations. |
| **15. Approval System** | Human review workflow (`modules/approvals`) with pending task queue, approve/reject actions, and authority revocation safety checks | `REAL_PRODUCTION` | Yes | Complete. Revocation of authority during pending approval blocks execution. |
| **16. Agent Authentication** | SHA-256 salted API key hashing (`middleware/auth.ts`), agent status validation, tenant isolation | `REAL_PRODUCTION` | Yes | Complete. Agents cannot access cross-tenant resources. |
| **17. Idempotency** | Redis/PostgreSQL idempotency cache (`idempotency.service.ts`) preventing duplicate executions and race conditions | `REAL_PRODUCTION` | Yes | Complete. Concurrent requests with identical idempotency keys return identical results. |
| **18. Queue / Worker** | BullMQ on Redis (`queue/payment-execution.*`) for durable async job dispatch, retry backoff, and worker crash recovery | `REAL_PRODUCTION` | Yes | Complete. Worker failure leaves transaction in safe `UNKNOWN` state with 0 debit. |
| **19. Dashboard** | Next.js web application exposing real backend data with responsive UI, dark theme, and real-time state displays | `REAL_SANDBOX` / `REAL_PRODUCTION` | Yes | Verified build passing with 0 errors. |
| **20. SDKs & Client** | Fully typed API client (`frontend/src/lib/api.ts`) and MCP client tools | `REAL_PRODUCTION` | Yes | Complete. Covers all API surfaces. |
| **21. E2E Tests** | Test suite covering acceptance, live sandbox, security isolation, queue async, MCP server, agent checkout, payment authority, real rails | `REAL_SANDBOX` / `REAL_PRODUCTION` | Yes | Add master canonical `tests/e2e-real-agent-payment.test.ts`. |

---

## 2. Invariant & Regulatory Analysis

1. **Zero Secret Exposure**:
   - Frame neither accepts nor stores interactive PINs, SMS OTPs, or CVVs.
   - Any attempt to pass these fields via API or MCP tools is deterministically rejected with `SENSITIVE_CREDENTIAL_REJECTED`.
2. **Deterministic Status Truth**:
   - MOCK providers are tagged strictly as `MOCK`.
   - Razorpay Sandbox is tagged strictly as `SANDBOX`.
   - No mock success responses are permitted in `SANDBOX` or `REAL_PRODUCTION` modes.
3. **Ledger Invariant**:
   - Payment failed = exactly 0 debit entries.
   - Payment timeout = exactly 0 debit entries until verified via remote inquiry or webhook.
   - Payment succeeded = exactly 1 debit entry.
   - Webhook replay = 0 duplicate debits.
