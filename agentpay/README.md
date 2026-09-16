# Frame (AgentPay) — Autonomous Agent Payments with Policy Guardrails

**Frame** is the financial firewall and programmable transaction layer built specifically for autonomous AI agents. Frame allows LLMs and autonomous agents (LangChain, CrewAI, AutoGen, LlamaIndex, OpenAI Assistants) to execute real-world payments safely under strict organizational spend policies, risk tiers, and human-in-the-loop approval workflows.

---

## 🚀 Key Features

- 🛡️ **Policy Engine & Guardrails**:
  - Max per-transaction spend limits
  - Daily & monthly rolling velocity budgets
  - Merchant allowlists & blocklists
  - Category filtering (`cloud`, `saas`, `compute`, etc.)
  - Frequency throttling (max payments/hour, max payments/day)
- 💳 **Production-Grade Asynchronous Payment Orchestration**:
  - Asynchronous non-blocking HTTP 202 Accepted ingestion (`POST /v1/payment-intents/:id/execute`)
  - Resilient BullMQ + Redis job queue (`payment-execution`) with deterministic deduplication keys
  - Background worker consuming jobs under PostgreSQL row locks (`FOR UPDATE`) to prevent race conditions
  - In-flight worker crash detection and recovery (flagged as `unknown`, preserved for reconciliation)
  - Provider-agnostic `IPaymentProvider` contract ready for real UPI/Bank rails
  - Deterministic `MockPaymentProvider` with controllable latency, failure, and timeout simulation
  - `PaymentOrchestrator` coordinating intent authorization, state transitions, and provider calls
  - Atomic PostgreSQL row-level idempotency locks preventing double execution
  - Cryptographic canonical intent hashing ensuring authorized intents cannot be tampered with
- 🔔 **Webhook & Reconciliation Architecture**:
  - Webhook ingestion engine with provider-specific HMAC signature verification
  - Raw event persistence (`provider_events`) and deduplication
  - Non-destructive status reconciliation service for resolving `unknown` and `processing` payments
- 🔒 **Financial Safety Invariants**:
  - **UNKNOWN remains UNKNOWN**: Never coerces provider timeouts or worker crashes into `failed`
  - **No blind retries**: Preserves ambiguous payments for reconciliation
  - **Strict double-entry ledger**: Never creates ledger debits for unconfirmed payments; unique constraint index `(payment_id, entry_type)` guarantees idempotent settlement
- 👨‍💼 **Human-in-the-Loop (HITL) Approvals**:
  - Configurable approval thresholds (e.g. any payment > ₹1,000 requires human sign-off)
  - Real-time approval dashboard with reason codes, risk scores, and one-click approve/reject
  - Automatic escalation and promotion to asynchronous payment queue upon approval
- 🔐 **Zero-Trust Agent Credentials**:
  - Scoped agent API keys (`frm_live_...`, `frm_test_...`)
  - Cryptographically hashed with bcrypt, indexed with key prefixes
  - Single-use disclosure on generation
- 📜 **Tamper-Evident Merkle Audit Log**:
  - Every transaction, policy change, key issuance, and approval decision is SHA-256 hashed into a cryptographic ledger
- 💻 **Modern Next.js Dashboard**:
  - Dark mode fintech UI built with Next.js 14, Tailwind CSS, Lucide icons
  - Dedicated pages for Agents, Spend Policies, Payment Intents, Pending Approvals, Transactions, and Audit Trail
- 📦 **Multi-Language SDKs**:
  - TypeScript / JavaScript SDK (`@frame-pay/sdk`)
  - Python SDK (`frame-pay`) with native LangChain StructuredTool integrations

---

## 🏛️ Architecture Overview

```mermaid
graph TD
    Agent["Autonomous Agent (LangChain / CrewAI)"] -->|1. Request Payment (X-API-Key)| Gateway["Frame API Gateway (:3001)"]
    Gateway --> Auth["Agent Credential Verifier"]
    Auth --> Firewall["Policy Engine & Spend Guardrails"]
    
    Firewall -->|Under threshold & ALLOW| Prep["Prepare Execution (PostgreSQL)"]
    Firewall -->|Exceeds threshold| HITL["Approval Queue (PENDING_APPROVAL)"]
    Firewall -->|Policy violation| Deny["Blocked (DENIED with audit log)"]
    
    HITL --> Admin["Dashboard Admin (:3000)"]
    Admin -->|Approve| Prep
    Admin -->|Reject| Deny
    
    Prep -->|Enqueue pay_job_...| Queue["BullMQ / Redis Queue"]
    Prep -->|Return 202 Accepted| Gateway
    
    Queue --> Worker["Frame Background Worker"]
    Worker -->|Lock Row (FOR UPDATE)| DB[(PostgreSQL)]
    Worker --> Orch["Payment Orchestrator"]
    Orch --> ProviderRegistry["Provider Registry"]
    ProviderRegistry --> MockProvider["Mock / Sandbox / UPI Provider"]
    MockProvider --> Rail["Payment Rail (UPI / Card / NetBanking)"]
    
    MockProvider -->|Result| Orch
    Orch -->|Success| Ledger["Double-Entry Ledger (DEBIT)"]
    Orch -->|Audit Event| Audit["Merkle-Chained Audit Trail"]
    
    Webhook["Provider Webhook"] --> WhReceiver["Webhook Receiver"]
    WhReceiver --> SigCheck["HMAC Signature Verification"]
    SigCheck --> EventStore["Raw Event Persistence & Deduplication"]
    EventStore --> Orch
    
    Recon["Reconciliation Service"] --> ProviderStatus["Check Provider Status"]
    ProviderStatus -->|Resolve Unknown| Orch
```

---

## ⚡ Quick Start

### 1. Start Services
The backend uses PostgreSQL and Redis. Both are configured in `docker-compose.yml`:
```bash
cd /Users/dev/Desktop/Frame/agentpay
docker compose up -d postgres redis
```

### 2. Backend API & Async Worker
```bash
cd backend
npm install
npm run migrate
npm run dev
# Running on http://localhost:3001 with BullMQ worker active
```

### 3. Web Dashboard
```bash
cd frontend
npm install
npm run dev
# Running on http://localhost:3000
```

### 4. Run Automated Test Suites
```bash
cd backend

# Run Complete Suite (Master Acceptance + Razorpay Contract + Security Isolation + Async Worker):
npm test

# Run individual test suites:
npm run test:worker        # 15 Asynchronous BullMQ worker & safety scenarios
npm run test:acceptance    # Deterministic engine acceptance (7 scenarios)
npm run test:provider      # Razorpay contract & adapter verification (Simulated webhooks)
npm run test:security      # Multi-tenant isolation & boundary security audit
npm run test:live-sandbox   # Live network probe & real sandbox execution against api.razorpay.com
```

> **Integration Status**: Frame successfully communicates with the Razorpay sandbox Orders API using the official Razorpay API contract. Payment settlement remains dependent on the sandbox-supported payment flow. See [`docs/provider-integration.md`](./docs/provider-integration.md) for full Razorpay sandbox capabilities, limitations, and operational runbook.

---

## 📦 SDK Quickstarts

### TypeScript / JavaScript
```typescript
import { FrameClient } from '@frame-pay/sdk';

const frame = new FrameClient({
  apiKey: process.env.FRAME_API_KEY!,
  baseUrl: 'http://localhost:3001',
});

// Execute guarded payment
const payment = await frame.pay({
  amount: 250.00, // ₹250.00
  currency: 'INR',
  merchant: 'HuggingFace Inc',
  purpose: 'Inference endpoint top-up',
  category: 'cloud',
});

console.log(payment.status); // 'EXECUTING' or 'PENDING_APPROVAL'
```

### Python (LangChain Agent Tool)
```python
from frame_pay import FrameClient

client = FrameClient(api_key="frm_test_...", base_url="http://localhost:3001")

# Use directly as a LangChain tool
payment_tool = client.as_langchain_tool()

agent = create_openai_tools_agent(llm, [payment_tool], prompt)
```

---

## 🧪 Validated E2E Scenarios

| Scenario | Expected Behavior | Verification Status |
|---|---|---|
| Agent Registration & Key Issuance | Cryptographic prefix lookup, bcrypt storage | ✅ Verified (201) |
| Small payment under threshold | Immediate auto-approval and execution | ✅ Verified (`EXECUTING`) |
| Large payment exceeding ₹1,000 | Guardrail activates `PENDING_APPROVAL` | ✅ Verified (`PENDING_APPROVAL`) |
| Human-in-the-Loop Admin Approval | Admin review -> Payment promoted to execution | ✅ Verified (`200 OK -> EXECUTING`) |
| Category Violation (`entertainment`) | Policy Firewall blocks payment | ✅ Verified (`DENIED`) |
| Tamper-Evident Audit Logging | SHA-256 Merkle chain persisted across all events | ✅ Verified (13 entries chained) |
