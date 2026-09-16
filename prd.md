# AgentPay India — Product Requirements Document (PRD)

## 1. Product Identity

**Working name:** AgentPay India  
**Category:** AI-agent payment infrastructure  
**Initial rail:** UPI  
**Primary differentiator:** Agent Payment Firewall + Intent-Bound Payments  
**Initial customer:** Indian startups/SMBs/fintechs building AI agents that need controlled payment execution.

### Product thesis

> AI agents should receive programmable payment authority, not unrestricted access to a company bank account.

AgentPay provides the infrastructure layer between an AI agent and payment rails. It gives every agent an identity, permissions, budget, payment intent, policy evaluation, approval workflow, execution status, and audit trail.

The product must remain **payment infrastructure**, not become merely an expense-management dashboard.

---

## 2. Problem

AI agents are becoming capable of taking actions rather than only generating text. Once an agent can spend money, companies need answers to:

- Which agent initiated this payment?
- Who authorized that agent?
- What task was the agent supposed to perform?
- Is this merchant allowed?
- Is this amount within budget?
- Does this payment match the agent's intended task?
- Should a human approve it?
- What happens if the agent is compromised?
- How can finance audit every action?
- Which payment provider/UPI mechanism actually executed it?
- How can the company revoke an agent immediately?

Existing agentic payment initiatives are rapidly making **payment execution** possible. AgentPay focuses on the control, orchestration, authorization, policy and audit layer around execution.

---

## 3. Market Context

UPI processed 24,508.96 million transactions worth ₹29,82,355.95 crore in August 2026, across 752 live banks according to NPCI statistics.

NPCI is actively developing/rolling out infrastructure for AI-agent payments. Current reporting indicates a Unified Agentic Protocol direction involving identification/authorization of AI agents, while NPCI's existing UPI Circle framework already supports delegated payment authority for software profiles. NPCI also extended UPI Circle to permitted IoT/software profiles in 2025.

This validates the market timing but also means the basic ability to execute an AI-initiated UPI payment will become increasingly commoditized.

Therefore:

**We do not compete with NPCI on the rail. We build above it.**

---

## 4. Product Vision

Build the default developer infrastructure for autonomous payments in India.

### Long-term stack

AI Agent
→ AgentPay SDK/API
→ Agent Identity
→ Payment Intent
→ Policy Firewall
→ Risk Checks
→ Human Approval when required
→ Payment Orchestrator
→ UPI / future payment rails
→ Bank / PSP
→ Merchant

---

## 5. Core USP

### Intent-Bound Payments

A payment is not authorized merely because an agent has enough money left in its budget.

A payment must satisfy:

1. Agent identity
2. Agent status
3. Active authorization
4. Payment amount limits
5. Merchant/vendor rules
6. Category rules
7. Frequency rules
8. Time/expiry rules
9. Task/intent constraints
10. Approval requirements

Example:

```text
Agent: DevOps Agent
Task: Maintain production infrastructure
Budget: ₹50,000/month
Daily limit: ₹5,000
Transaction limit: ₹10,000
Allowed vendors: AWS, GCP, Cloudflare
Approval above: ₹3,000
Expiry: 24 hours
```

A ₹2,000 AWS payment can pass automatically.

A ₹2,000 Nike payment must be blocked even if the budget is available.

---

## 6. Primary Personas

### Developer / AI Engineer
Needs:
- Simple API
- SDK
- Sandbox
- Webhooks
- predictable payment states

### CTO
Needs:
- agent management
- security
- integration
- reliability
- provider abstraction

### CFO / Finance Lead
Needs:
- spend limits
- approval workflows
- reconciliation
- audit logs
- reports

### Security / Compliance
Needs:
- agent identity
- revocation
- immutable/tamper-evident audit
- access control
- incident history

---

## 7. Initial Use Cases

### P0 — Agent-controlled business purchases
Examples:
- cloud infrastructure
- SaaS renewals
- APIs
- domains
- software licenses

### P0 — Procurement agents
Agent purchases approved business supplies/vendors under budget.

### P1 — Recurring subscriptions
Agent pays only when invoice/vendor/amount matches policy.

### P1 — Automated bill payment
Agent retrieves bill, validates it, and executes payment if policy allows.

### P2 — Travel/expense agents
Corporate travel and employee expense workflows.

### P2 — Consumer agents
Potential later expansion after B2B infrastructure is validated.

---

## 8. MVP Goals

The MVP must demonstrate a complete payment-control lifecycle:

1. Create company.
2. Create agent.
3. Give agent credentials.
4. Create policy.
5. Agent submits payment intent.
6. Firewall evaluates policy.
7. System automatically approves safe intents.
8. System sends risky/large intents to human approval.
9. Human approves/rejects.
10. Payment execution is requested through a payment-provider adapter.
11. Provider callback updates payment state.
12. Ledger records final result.
13. Agent receives result through API/webhook.
14. Admin can inspect the entire audit trail.

### MVP success criteria

- No payment can execute without a valid agent identity.
- Every payment has a policy decision.
- Every payment has an auditable lifecycle.
- Duplicate requests cannot create duplicate payments.
- Failed provider callbacks can be retried safely.
- Revoked agents cannot initiate new payments.
- Human approval cannot be bypassed.
- A demo can show both successful and blocked payments.

---

## 9. MVP Non-Goals

Do NOT build initially:

- our own UPI rail
- our own bank
- our own wallet/PPI
- credit products
- card issuing
- global payment rails
- AI model training
- complex autonomous merchant discovery
- blockchain
- Kubernetes
- dozens of PSP integrations
- consumer marketplace
- complex ML fraud scoring

---

## 10. Product Requirements

### Agent Management
- Create agent
- Disable agent
- Rotate credentials
- View status
- View spend
- View policy

### Policy Management
Support:
- transaction limit
- daily limit
- monthly limit
- merchant allowlist
- merchant blocklist
- category restrictions
- approval threshold
- expiry
- maximum transaction frequency

### Payment Intent
Required:
- agent ID
- amount
- currency
- merchant
- merchant reference
- purpose
- idempotency key
- intent/task reference
- metadata

### Decision
Possible:
- ALLOW
- DENY
- REQUIRE_APPROVAL

### Payment State Machine

```text
CREATED
→ EVALUATING
→ AUTHORIZED
→ EXECUTING
→ SUCCEEDED

Alternative:
EVALUATING
→ DENIED

EVALUATING
→ PENDING_APPROVAL
→ APPROVED
→ EXECUTING

PENDING_APPROVAL
→ REJECTED

EXECUTING
→ FAILED
```

Terminal states must never silently change.

---

## 11. Core API Contract

The exact public API can evolve, but MVP should support:

```text
POST /v1/agents
GET /v1/agents
POST /v1/agents/{id}/disable
POST /v1/agents/{id}/rotate-key

POST /v1/policies
GET /v1/policies/{id}
PATCH /v1/policies/{id}

POST /v1/payment-intents
GET /v1/payment-intents/{id}

GET /v1/approvals
POST /v1/approvals/{id}/approve
POST /v1/approvals/{id}/reject

GET /v1/transactions
GET /v1/audit-events

POST /v1/webhooks/provider
POST /v1/webhooks/test
```

---

## 12. Dashboard

MVP screens:

1. Overview
2. Agents
3. Agent details
4. Policies
5. Payment intents
6. Pending approvals
7. Transactions
8. Audit log
9. Integrations
10. Settings

Keep the dashboard operational, not decorative.

---

## 13. Business Model

Recommended initial model:

### Developer
Free sandbox.

### Startup
₹1,999–₹4,999/month + usage.

### Growth
₹10,000–₹30,000/month + negotiated transaction pricing.

### Enterprise
Custom pricing based on:
- transaction volume
- number of agents
- approval workflows
- integrations
- SLA
- support

Do not rely solely on a percentage of UPI volume. UPI economics and regulatory constraints can make payment-margin assumptions unreliable.

The durable monetization layer should be:
**infrastructure + control + compliance + enterprise software.**

---

## 14. North-Star Metrics

- Active companies
- Active agents
- Payment intents/day
- Successful payment volume
- Auto-approval rate
- Approval latency
- Blocked unsafe intents
- Payment success rate
- Duplicate-payment incidents
- Monthly recurring revenue
- Net revenue retention

---

## 15. Product Principle

The agent may **request** a payment.

The policy engine decides whether the agent is **authorized**.

The payment rail executes only an **authorized** payment.

The human remains able to revoke authority.

That separation is fundamental to the product.
