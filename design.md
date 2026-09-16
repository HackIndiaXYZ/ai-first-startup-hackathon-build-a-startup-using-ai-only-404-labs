# AgentPay India — Product & Technical Design

## 1. Design Philosophy

The product should feel like developer infrastructure, not a traditional banking dashboard.

Core experience:

```text
Create Agent
→ Give Authority
→ Agent Requests Payment
→ Firewall Decides
→ Payment Executes
→ Audit Everything
```

---

## 2. Design System

### Visual direction

- minimal
- technical
- trustworthy
- enterprise
- high information density
- clear status hierarchy
- no unnecessary animations

Primary status colors should communicate:
- safe
- pending
- blocked
- failed
- successful

Accessibility is mandatory.

---

## 3. Dashboard Information Architecture

```text
Dashboard
├── Overview
├── Agents
│   ├── All Agents
│   └── Agent Details
├── Policies
├── Payments
├── Approvals
├── Audit
├── Integrations
└── Settings
```

---

## 4. Overview

Display:

- total agent spend
- today's spend
- active agents
- pending approvals
- blocked attempts
- payment success rate
- recent payments
- security alerts

The dashboard should immediately answer:

> "What are my agents doing with money?"

---

## 5. Agent Creation

Fields:

- Agent name
- Description
- Owner/team
- Environment
- Purpose
- Credential
- Status

After creation:

```text
Agent created
↓
Configure policy
↓
Generate credential
↓
Test in sandbox
```

Do not allow production payment execution before policy configuration.

---

## 6. Policy Editor

Policy structure:

```text
Identity
  Agent

Budget
  Monthly limit
  Daily limit
  Transaction limit

Merchant
  Allowlist
  Blocklist

Category
  Allowed categories
  Restricted categories

Approval
  Automatic below ₹X
  Human approval above ₹X

Time
  Start
  Expiry

Frequency
  Max payments/hour
  Max payments/day
```

Every edit creates a new immutable policy version.

Never overwrite policy history.

---

## 7. Payment Intent UX

Display:

```text
Payment Intent #PI_123

Agent
DevOps-Agent

Merchant
AWS

Amount
₹2,400

Purpose
Production infrastructure

Policy
Cloud Infrastructure v3

Decision
✓ Authorized

Payment
Executing...

Provider
[Provider name]

Audit
View event history
```

---

## 8. Approval UX

Approval card:

```text
⚠ Approval Required

Agent:
Procurement-Agent

Merchant:
Vendor XYZ

Amount:
₹18,500

Purpose:
Purchase replacement server

Policy:
Transaction limit ₹10,000

Reason:
Amount exceeds automatic threshold

[Approve] [Reject]
```

The approval UI must show enough context for a human to make a decision.

---

## 9. Audit UX

Each event:

```text
14:21:02
Agent created

14:23:14
Payment intent created

14:23:14
Policy evaluated

14:23:14
Decision: REQUIRE_APPROVAL

14:24:03
Approval granted by Finance Admin

14:24:05
Payment submitted

14:24:08
Provider confirmed payment

14:24:08
Ledger updated
```

---

## 10. API Design

Use REST initially.

Rules:

- version APIs
- consistent error format
- pagination
- idempotency
- request IDs
- typed schemas
- OpenAPI documentation

Example error:

```text
{
  "error": {
    "code": "POLICY_LIMIT_EXCEEDED",
    "message": "Payment exceeds the agent transaction limit.",
    "request_id": "req_123"
  }
}
```

Never expose internal stack traces.

---

## 11. Agent SDK Design

Initial TypeScript SDK:

```text
agentpay.agents.create()
agentpay.paymentIntents.create()
agentpay.paymentIntents.get()
agentpay.approvals.get()
```

Example conceptual usage:

```text
payment = agentpay.paymentIntents.create({
  amount: 2400,
  currency: "INR",
  merchant: "AWS",
  purpose: "production infrastructure"
})
```

SDK should hide:
- authentication headers
- retries where safe
- request IDs
- serialization

SDK must NOT hide business decisions.

---

## 12. Payment Intent Design

Required properties:

```text
id
organization_id
agent_id
policy_version_id
amount
currency
merchant
merchant_reference
purpose
task_reference
intent_hash
status
decision
expires_at
idempotency_key
created_at
updated_at
```

---

## 13. Approval Design

Approval object:

```text
id
payment_intent_id
required_role
requested_at
expires_at
approved_by
approved_at
rejected_by
rejected_at
decision
comment
```

Approver must have explicit permission.

---

## 14. Risk Design

MVP risk engine should be deterministic.

Signals:

- agent status
- policy
- amount
- spend velocity
- merchant
- category
- repeated attempts
- recent policy changes
- unusual frequency

Output:

```text
LOW_RISK
MEDIUM_RISK
HIGH_RISK
```

But final authorization still comes from policy.

Future ML can enhance risk scoring.

---

## 15. Reconciliation

Payment lifecycle:

```text
Intent
→ Authorized
→ Provider Attempt
→ Provider Result
→ Internal Payment
→ Ledger
→ Reconciliation
```

A reconciliation job compares:
- our payment records
- provider events
- provider transaction references

Any mismatch becomes:

```text
RECONCILIATION_EXCEPTION
```

Never silently mark it successful.

---

## 16. Notifications

MVP:

- email
- dashboard

Later:

- Slack
- Microsoft Teams
- webhook
- SMS
- WhatsApp where appropriate

Events:

- approval requested
- payment succeeded
- payment failed
- agent disabled
- unusual activity

---

## 17. Failure Design

Every external call must assume failure.

Examples:

Provider timeout:
→ mark `UNKNOWN`
→ query provider
→ reconcile

Duplicate webhook:
→ ignore after deduplication

Worker crash:
→ retry safely

Approval expires:
→ payment cannot execute

Agent revoked:
→ new intent denied

Policy changes:
→ payment uses the policy version evaluated for that intent.

---

## 18. Privacy Design

Store minimum necessary information.

Use:
- encryption
- retention policies
- tenant isolation
- access logs

Do not expose one company's agents or payments to another company.

---

## 19. Tenant Isolation

Every business object must belong to an organization.

Every query must enforce:

```text
organization_id = authenticated_organization
```

Never trust organization IDs supplied by clients without authorization checks.

---

## 20. Design Rule

The most important UI should be:

> **Why did this payment happen, and why was it allowed?**

Every payment must answer that question.
