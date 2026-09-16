# AgentPay India — Engineering & Product Rules

## 1. Fundamental Rule

**The AI agent never gets unrestricted payment authority.**

Every payment must pass through the AgentPay authorization layer.

---

## 2. Deterministic Authorization

Never allow an LLM to directly decide:

> "Should this payment happen?"

LLMs may:
- extract intent
- classify merchant/category
- summarize
- explain decisions

LLMs may NOT be the final authorization mechanism.

The final decision is deterministic.

---

## 3. Payment Rules

Every payment must have:

- authenticated agent
- active policy
- policy version
- amount
- currency
- merchant
- purpose
- idempotency key
- expiration
- audit trail

---

## 4. No Secret Exposure

Never expose:

- database credentials
- provider secrets
- private signing keys
- webhook secrets
- user passwords
- UPI PINs
- bank authentication credentials

Secrets belong in a managed secret store.

---

## 5. No Direct Provider Calls from UI

Frontend must never directly execute payments.

Flow:

```text
Frontend
→ Backend
→ Policy
→ Provider
```

---

## 6. No Direct Provider Calls from Agent

Agent:

```text
Agent
→ AgentPay API
→ Firewall
→ Provider
```

Never:

```text
Agent → Provider
```

---

## 7. Every Payment Is Idempotent

Payment creation without idempotency is prohibited.

Retries must not create duplicate payments.

---

## 8. Every State Transition Is Audited

At minimum:

- actor
- organization
- timestamp
- request ID
- previous state
- new state
- reason
- policy version

---

## 9. Policy Versioning

Never mutate historical policy meaning.

When a policy changes:

```text
v1
v2
v3
```

Existing payment intents retain the policy version under which they were evaluated.

---

## 10. Agent Revocation

Disabling an agent must immediately prevent new payment intents.

Existing in-flight payments follow a clearly defined cancellation policy.

Never silently cancel external payments without provider support.

---

## 11. Human Approval Security

Only authorized users can approve.

An approver cannot approve a payment if:

- they lack the required role
- approval has expired
- payment is already terminal
- payment hash/state does not match
- policy version changed in an incompatible way

---

## 12. Tenant Isolation

Every database access must be scoped to the organization.

Never trust client-supplied organization IDs.

---

## 13. Webhook Security

Always:

1. verify provider signature
2. persist raw event
3. deduplicate
4. validate event
5. transition state
6. record audit
7. acknowledge

Never process an unverified webhook.

---

## 14. Provider Independence

Business logic must not depend directly on:

- Razorpay-specific fields
- Cashfree-specific states
- Pine Labs-specific states

Normalize them.

---

## 15. No Premature Microservices

Start with a modular monolith.

Extract services only when there is a measurable reason.

---

## 16. No Blockchain in MVP

Tamper-evident audit logging is enough.

Blockchain adds complexity without solving the core MVP problem.

---

## 17. Financial Correctness Over UI Polish

Priority:

```text
Correctness
Security
Idempotency
Auditability
Reliability
UX
Visual polish
```

---

## 18. Never Fake Production Payments

Sandbox/demo mode must be visibly different from production.

Never represent a simulated payment as a real transaction.

---

## 19. Provider Unknown State

If provider response is uncertain:

```text
UNKNOWN
```

Do not assume failure.

Do not retry blindly.

First query/reconcile.

---

## 20. Amount Handling

Never use floating-point numbers for money.

Represent monetary amounts as integer minor units where appropriate, or use a decimal-safe money type.

For INR:

```text
₹100.50
→ 10050 paise
```

---

## 21. Time

Store timestamps in UTC.

Convert to local timezone only at presentation.

---

## 22. Audit Integrity

Audit events should be append-only.

For stronger tamper evidence:

```text
event_hash =
SHA256(previous_hash + canonical_event)
```

---

## 23. API Compatibility

Breaking API changes require a new API version.

Never silently change response semantics.

---

## 24. Documentation

Every public API must have:

- request example
- response example
- errors
- authentication
- idempotency behavior
- webhook behavior
- rate limits

---

## 25. Testing

Every critical payment workflow needs:

- unit test
- integration test
- state-machine test
- idempotency test
- authorization test
- webhook test
- failure/retry test

---

## 26. AI Coding Agent Rules

When using an AI coding agent:

1. Read relevant `.md` files before editing.
2. Never invent architecture.
3. Never remove security controls to make tests pass.
4. Never change database schema without migration.
5. Never modify payment state transitions casually.
6. Never add a dependency without justification.
7. Never hardcode secrets.
8. Never skip tests because the UI works.
9. Never claim payment integration works without a verified provider response.
10. Update documentation when architecture changes.

---

## 27. Definition of Done

A feature is complete only when:

- implementation exists
- tests exist
- error handling exists
- audit exists where required
- documentation exists
- security implications are reviewed
- migration exists if schema changed
- staging test passes

---

## 28. Golden Rule

**Make the unsafe thing impossible, not merely unlikely.**
