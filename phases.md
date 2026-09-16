# AgentPay India — Development Phases

## 0. Phase 0 — Validation and Compliance Gate

### Goal
Prove that the proposed payment flow is legally and technically executable before writing large amounts of production code.

### Tasks

- Read current NPCI UPI documentation.
- Track current Unified Agentic Protocol/UAP information.
- Identify PSP/provider with sandbox or partner API.
- Confirm what is actually available to startups.
- Determine whether our MVP is only orchestration software or requires regulated status.
- Get fintech/legal counsel before production money movement.

### Exit criteria

- One feasible payment execution path documented.
- One provider selected for MVP.
- Sandbox/test credentials available.
- Regulatory assumptions documented.
- No production money movement until counsel/provider approval.

---

# Phase 1 — Foundation

## Goal

Build the developer platform without real payment execution.

### Build

- repository
- authentication
- organizations
- users
- agents
- credentials
- PostgreSQL
- migrations
- API versioning
- logging
- audit framework
- dashboard shell

### Deliverable

A user can:

```text
Sign up
→ Create organization
→ Create agent
→ Generate credential
→ Disable agent
→ View audit events
```

---

# Phase 2 — Policy Firewall

## Goal

Make the core differentiator real.

### Build

- policy model
- policy versions
- transaction limits
- daily/monthly budgets
- merchant allowlist
- merchant blocklist
- categories
- approval thresholds
- expiry
- frequency controls
- deterministic evaluator

### Test scenarios

1. Valid payment → ALLOW
2. Transaction too large → DENY
3. Daily budget exceeded → DENY
4. Merchant blocked → DENY
5. Approval threshold exceeded → REQUIRE_APPROVAL
6. Expired policy → DENY
7. Disabled agent → DENY

### Exit criteria

The policy engine is independently testable.

---

# Phase 3 — Payment Intent Engine

## Goal

Turn agent requests into controlled payment intents.

### Build

- payment intent API
- intent hashing
- policy snapshot
- state machine
- idempotency
- expiration
- payment decision
- audit events

### Demo

```text
Agent
→ payment intent
→ firewall
→ ALLOW / DENY / APPROVAL
```

No real money required yet.

---

# Phase 4 — Human Approval

## Goal

Add human-in-the-loop control.

### Build

- approval tasks
- approver roles
- approval dashboard
- approve
- reject
- expiration
- audit trail
- notifications

### Demo

```text
Agent asks for ₹8,000
Policy says approval > ₹5,000
↓
Approval appears
↓
Admin approves
↓
Intent becomes AUTHORIZED
```

---

# Phase 5 — Provider Sandbox Integration

## Goal

Connect the platform to one real provider sandbox.

### Build

- provider adapter
- authorization
- payment creation
- status lookup
- webhook receiver
- signature validation
- retry mechanism
- provider event storage
- normalized status mapping

### Critical rule

Do not put provider-specific logic throughout the application.

Everything goes through the adapter.

---

# Phase 6 — Ledger + Reconciliation

## Goal

Make financial state reliable.

### Build

- payments
- payment attempts
- ledger entries
- provider references
- reconciliation
- mismatch detection
- immutable/tamper-evident audit chain

### Test

Simulate:

- success
- failure
- timeout
- duplicate webhook
- out-of-order webhook
- retry
- provider unknown state

---

# Phase 7 — End-to-End MVP

## Complete flow

```text
AI Agent
  ↓
Agent authentication
  ↓
Create payment intent
  ↓
Validate
  ↓
Policy Firewall
  ↓
ALLOW / DENY / APPROVAL
  ↓
Human approval if required
  ↓
Payment Provider Adapter
  ↓
UPI/provider sandbox
  ↓
Webhook
  ↓
Payment state
  ↓
Ledger
  ↓
Audit
  ↓
Agent webhook
```

### MVP demo must show

#### Scenario A — Automatic payment
₹1,000 AWS payment → allowed → executed.

#### Scenario B — Blocked payment
₹1,000 Nike payment → merchant not allowed → blocked.

#### Scenario C — Human approval
₹8,000 AWS payment → threshold exceeded → approval → execution.

#### Scenario D — Rogue/revoked agent
Agent disabled → payment rejected immediately.

#### Scenario E — Duplicate request
Same idempotency key → only one payment.

---

# Phase 8 — Security Hardening

### Build

- rate limits
- credential rotation
- KMS secrets
- RBAC review
- audit review
- dependency scanning
- OWASP checks
- webhook security
- tenant isolation testing
- backup restore test
- incident response document

### Exit criteria

No known critical vulnerability.

---

# Phase 9 — Pilot

## Target

First pilot should be:

**Indian AI-first startup with 3–20 employees and a technical founder/CTO.**

Use cases:
- cloud
- SaaS
- APIs
- domains
- procurement

Avoid high-risk financial use cases initially.

---

# Phase 10 — Production

Only after:

- legal review
- provider agreement
- compliance requirements confirmed
- security review
- operational monitoring
- support process
- incident process
- reconciliation tested

---

# Future Phases

## Phase 11
Second payment provider.

## Phase 12
Python SDK.

## Phase 13
Advanced risk engine.

## Phase 14
Enterprise approvals.

## Phase 15
Multiple payment rails.

## Phase 16
Agent registry interoperability.

## Phase 17
International expansion.

---

# What We Do NOT Do Early

- Kubernetes
- microservice explosion
- custom blockchain
- custom wallet
- custom UPI rail
- ML fraud model before transaction data
- 10 SDKs
- mobile apps
- consumer marketplace

The objective is:

**one complete reliable payment-control loop.**
