# Real Autonomous AI Agent Payment Journey

This document describes the exact execution flow from a human's natural language purchase instruction to settled payment and merchant order fulfillment under Frame's delegated financial control plane.

---

## 1. Complete End-to-End Sequence Diagram

```
HUMAN USER
    │  (1) "Buy me a mechanical keyboard under ₹3,000"
    ▼
AI SHOPPING AGENT
    │  (2) Parse & Object.freeze Intent:
    │      max_amount: ₹3,000, category: electronics, qty: 1
    │  (3) Launch Playwright & Navigate to Storefront
    ▼
MERCHANT STOREFRONT (Browser Automation)
    │  (4) Search "#search-input" -> Evaluate Product Cards
    │  (5) Select Product & Variant (Red Switches)
    │  (6) Add to Cart -> Proceed to Checkout
    │  (7) Extract DOM Data Attributes:
    │      data-subtotal="2499" data-shipping="0" data-total="2499"
    ▼
CANONICAL CHECKOUT & INTENT BINDING
    │  (8) Verify: total (₹2,499) <= budget (₹3,000)
    │  (9) Verify: category (electronics) == allowed category
    │  (10) Check active Payment Authority limits
    ▼
FRAME MCP GATEWAY
    │  (11) Call `frame_create_payment_intent` with idempotency_key
    ▼
FRAME POLICY FIREWALL
    │  (12) Evaluate rules:
    │       - Daily spend limit check
    │       - Per-transaction limit check
    │       - Category allowlist check
    │       - Velocity check
    │  (13) Decision: ALLOW / REQUIRE_APPROVAL / DENY
    ▼
DECISION BRANCH
    ├── [ALLOW]
    │       │
    │       ▼
    │   PAYMENT ORCHESTRATOR
    │       │  Dispatch to Razorpay Sandbox Provider
    │       │  Record Double-Entry Ledger Entry
    │       ▼
    │   PROVIDER WEBHOOK / SETTLEMENT STATUS
    │       │  Status -> SETTLED
    │       ▼
    │   MERCHANT ORDER FULFILLMENT
    │       │  POST /store/orders/:id/confirm
    │       │  Status -> PAID_AND_FULFILLED
    │       ▼
    │   HUMAN USER: "Purchase completed! Order #ORDER_... confirmed."
    │
    ├── [REQUIRE_APPROVAL]
    │       │
    │       ▼
    │   AGENT PAUSES: status = WAITING_FOR_HUMAN_APPROVAL
    │   DASHBOARD NOTIFICATION: Human principal notified
    │   HUMAN APPROVAL: Approved in Frame Dashboard
    │   AGENT RESUMES: POST /agent/runs/:id/resume -> Fulfills order
    │
    └── [DENY]
            │
            ▼
        AGENT HALTS: status = TERMINATED_BY_POLICY
        DO_NOT_RETRY: Zero retry evasion permitted
        HUMAN USER: "Transaction declined by Frame Policy Firewall."
```

---

## 2. Correlation & Trace Tracking

Every single purchase lifecycle is tracked by a unified ULID correlation identifier:
- **Trace ID**: `run_01M2TX0JSB7KN7T3XFBZP1SNDS`
- **Idempotency Key**: `agent_run_01M2TX0JSB7KN7T3XFBZP1SNDS_ORDER_1789756551980`
- **Frame Payment Intent**: `pi_01M2TWTYBA56BQX43CB76C5S16`
- **Merchant Order**: `ORDER_1789756551980_QJTTVV`

All log events emitted into the store contain this exact correlation ID:
1. `agent.started`
2. `intent.created`
3. `search.started`
4. `product.selected`
5. `cart.updated`
6. `checkout.canonicalized`
7. `intent.binding.checked`
8. `frame.authority.checked`
9. `frame.payment_intent.created`
10. `frame.decision.received`
11. `payment.started`
12. `payment.succeeded`
13. `order.completed`
14. `agent.completed`

---

## 3. Strict Invariants

1. **No Speculative Success**: The agent never reports success until Frame authoritatively confirms payment settlement and the merchant confirms order placement.
2. **Zero Direct DB Access**: The agent communicates with Frame exclusively over MCP tools or public REST endpoints.
3. **Fail-Closed Intent Binding**: If checkout totals diverge by even 1 paisa above the user budget, the agent halts immediately with `BUDGET_EXCEEDED`.
4. **Anti-Substitution**: If a merchant silently swaps an out-of-stock keyboard for an alternative item, intent binding detects the product discrepancy and halts with `PRODUCT_SUBSTITUTION_DETECTED`.
