# Frame Autonomous AI Shopping Agent — Architecture

## 1. System Overview

The Frame Autonomous AI Shopping Agent is a genuine purchasing agent designed to act as an external autonomous buyer governed strictly by Frame's financial control plane.

```
+-----------------------------------------------------------------------------------+
|                            AI SHOPPING AGENT (Client)                            |
|                                                                                   |
|  +-------------------------+    +-----------------------+    +-----------------+  |
|  | Natural Language Intent | -> |  Immutable Intent     | -> |  Transparent    |  |
|  | Extraction (LLM/Regex)  |    |  Binding Lock         |    |  Product Ranker |  |
|  +-------------------------+    +-----------------------+    +-----------------+  |
|                                                                       |           |
|  +-------------------------+    +-----------------------+             |           |
|  | Canonical Checkout      | <- |  Merchant Checkout    | <-----------+           |
|  | Extraction              |    |  & Cart Controller    |                         |
|  +-------------------------+    +-----------------------+                         |
|               |                                                                   |
|               v                                                                   |
|  +-------------------------+                                                      |
|  | Intent Binding          |                                                      |
|  | Verification (Fail-Safe)|                                                      |
|  +-------------------------+                                                      |
+---------------|-------------------------------------------------------------------+
                | Model Context Protocol (Stdio / SSE Transport)
                v
+-----------------------------------------------------------------------------------+
|                        FRAME FINANCIAL CONTROL PLANE                              |
|                                                                                   |
|  +---------------------+   +---------------------+   +-------------------------+  |
|  | Agent Identity      |   | Payment Authority   |   | Deterministic Policy    |  |
|  | Verification        |   | Budget & Limits     |   | Firewall (ALLOW / DENY) |  |
|  +---------------------+   +---------------------+   +-------------------------+  |
|                                                                   |               |
|  +---------------------+   +---------------------+                |               |
|  | Ledger & Audit Log  |   | Approval Escalation | <--------------+               |
|  | (Cryptographic Ch.) |   | Workflow (Human)    | (if REQUIRE_APPROVAL)          |
|  +---------------------+   +---------------------+                                |
|                                       | (if ALLOW)                                |
+---------------------------------------|-------------------------------------------+
                                        v
+-----------------------------------------------------------------------------------+
|                            PAYMENT RAILS / PROVIDER                               |
|                  Razorpay Sandbox / Real Banking Rails / Settlement               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Separation of Responsibilities

| Responsibility | Owner | Invariants |
|---|---|---|
| Natural Language Understanding | AI Shopping Agent | Decomposes raw prompt into structured constraints |
| Product Search & Comparison | AI Shopping Agent | Discovers products, ranks candidates transparently |
| Merchant Navigation & Cart | AI Shopping Agent | Interacts with merchant checkout pages |
| Checkout Canonicalization | AI Shopping Agent | Extracts subtotal, shipping, tax, discounts, total |
| Intent Binding Verification | AI Shopping Agent | Fails closed if checkout total > user budget or substituted |
| **Financial Authorization** | **Frame Control Plane** | **Authoritative financial decision maker** |
| **Spend Limit Enforcement** | **Frame Control Plane** | **Enforces per-tx, daily, monthly, category caps** |
| **Policy Firewall** | **Frame Control Plane** | **Evaluates ALLOW, REQUIRE_APPROVAL, DENY** |
| **Human Approvals** | **Frame Control Plane** | **Agent cannot self-approve; only human principals approve** |
| **Settlement & Rails** | **Payment Rail Provider** | **Real payment execution (Razorpay / Banking rails)** |

---

## 3. Directory Layout

The agent service is organized in `/agent`:

```
agent/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── core/
│   │   ├── agent.ts                  # Main ShoppingAgent facade
│   │   ├── agent-loop.ts             # LLM tool-calling execution loop
│   │   └── state.ts                  # Execution state machine
│   ├── llm/
│   │   ├── provider.ts               # LLMProvider abstract interface
│   │   ├── deterministic.ts          # Reproducible rule-based provider for CI
│   │   ├── openai-compatible.ts      # OpenAI / Gemini / Ollama adapter
│   │   └── anthropic.ts              # Anthropic Claude adapter
│   ├── intent/
│   │   ├── schema.ts                 # Zod schema for StructuredUserIntent
│   │   ├── parser.ts                 # Intent extraction & immutability lock
│   │   └── validator.ts              # Constraint validation
│   ├── shopping/
│   │   ├── product.ts                # ProductCandidate model
│   │   ├── search.ts                 # Search coordinator
│   │   └── ranking.ts                # Transparent product ranking
│   ├── browser/
│   │   ├── browser-manager.ts        # Browser controller
│   │   ├── page-controller.ts        # Navigation and action dispatcher
│   │   └── extraction.ts             # Semantic product & checkout extractor
│   ├── merchants/
│   │   ├── merchant-adapter.ts       # Base MerchantAdapter interface
│   │   ├── demo-store-adapter.ts     # TechSupply Store adapter
│   │   └── generic-browser-adapter.ts# Generic store adapter
│   ├── checkout/
│   │   ├── checkout-extractor.ts     # Canonical checkout model
│   │   ├── checkout-validator.ts     # Completeness checker
│   │   └── intent-binding.ts         # Intent Binding & fail-closed engine
│   ├── frame/
│   │   ├── frame-mcp-client.ts       # Real @modelcontextprotocol/sdk client
│   │   ├── authority.ts              # Authority inspection
│   │   └── payment.ts                # Payment intent lifecycle
│   ├── approvals/
│   │   └── approval-manager.ts       # Human handoff coordinator
│   ├── security/
│   │   ├── prompt-injection.ts       # Untrusted content scanner
│   │   ├── sensitive-data.ts         # Zero-trust credential blocker (UPI PIN/OTP)
│   │   └── domain-policy.ts          # Merchant and category safety rules
│   ├── state/
│   │   └── execution-store.ts        # In-memory execution store
│   ├── observability/
│   │   ├── events.ts                 # Typed event bus
│   │   └── logger.ts                 # Structured logger with correlation ID
│   ├── api/
│   │   └── server.ts                 # Fastify HTTP API for /agent/runs
│   └── cli/
│       └── index.ts                  # Interactive terminal streaming CLI
└── tests/
    ├── unit/                         # 6 unit test suites
    ├── security/                     # 20 mandatory security test scenarios
    ├── integration/                  # MCP SDK Stdio client integration
    └── e2e/                          # Full autonomous purchasing lifecycle
```
