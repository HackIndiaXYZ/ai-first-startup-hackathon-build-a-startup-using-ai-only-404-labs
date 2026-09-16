# AgentPay India — Project Memory

## 1. Project Identity

Working name:

**AgentPay India**

Mission:

> Build infrastructure that allows AI agents to safely execute payments in India.

Initial focus:

**UPI**

Long-term:

**Autonomous payment infrastructure across multiple rails.**

---

## 2. Core Thesis

AI agents are moving from generating information to taking actions.

The next infrastructure problem is:

> How can an AI agent spend money without receiving unrestricted access to a bank account?

AgentPay answers this with:

- agent identity
- authorization
- programmable policies
- intent-bound payment requests
- risk checks
- human approval
- payment orchestration
- auditability
- reconciliation

---

## 3. Positioning

Do not position the company as:

- another UPI app
- another wallet
- another consumer checkout
- another payment gateway
- another AI shopping assistant

Position it as:

> **Payment infrastructure for AI agents.**

Supporting statement:

> **Give agents budgets, not bank accounts.**

---

## 4. Differentiator

### Agent Payment Firewall

The Agent Payment Firewall sits between an AI agent and the payment rail.

It evaluates:

```text
WHO
WHAT
HOW MUCH
WHERE
WHY
WHEN
UNDER WHICH POLICY
```

before execution.

---

## 5. Killer Feature

### Intent-Bound Payments

A payment is authorized against the agent's intended task and policy.

Example:

```text
Task:
Maintain production cloud infrastructure

Allowed:
AWS
GCP
Cloudflare

Budget:
₹50,000/month

Transaction:
₹3,000

Merchant:
AWS

Result:
ALLOW
```

Same amount:

```text
Merchant:
Nike

Result:
DENY
```

The agent having unused budget is not sufficient.

---

## 6. Competitive Understanding

The market is moving quickly.

Relevant ecosystem directions include:

- NPCI Unified Agentic Protocol
- UPI Circle
- Reserve Pay / SBMD
- Pine Labs P3P
- Razorpay agentic payments
- Cashfree agentic payments
- Amazon Pay Smart Wallet
- Setu agentic bill payments

These players make the basic payment rail increasingly available.

Therefore our advantage should be:

**control + interoperability + developer infrastructure + enterprise policy.**

---

## 7. Current NPCI Context

NPCI has already extended UPI Circle to software/IoT profiles, including AI profiles in limited-user contexts, with defined limits and security requirements.

Current reporting indicates NPCI is developing a Unified Agentic Protocol and an AI-agent registry to identify/authorize agents.

This is not a reason to abandon the project.

It validates the underlying infrastructure market.

It means our architecture must be:

**protocol-aware and provider-agnostic.**

---

## 8. Regulatory Memory

Do not assume we can legally operate as an unrestricted payment processor.

Initial strategy:

**build the software/control layer and integrate through regulated payment providers/partners.**

Before production:

- obtain fintech legal advice
- determine exact regulatory classification
- confirm PSP/PA/TPAP requirements
- confirm permitted UPI agent flows
- confirm data-storage requirements
- confirm liability/dispute responsibilities
- sign required provider agreements

Never infer regulatory permission from a technical API.

---

## 9. Product Boundary

AgentPay controls:

- identity
- permission
- policy
- payment intent
- approval
- provider routing
- audit
- reconciliation

Partner infrastructure controls:

- regulated payment execution
- bank authentication
- settlement
- network-level UPI processing

---

## 10. MVP Technical Memory

Stack:

```text
Frontend:
Next.js + React + TypeScript

Backend:
Node.js + TypeScript + Fastify

Database:
PostgreSQL

Cache:
Redis

Queue:
Redis-backed queue initially

Cloud:
AWS

Secrets:
AWS Secrets Manager

Crypto:
AWS KMS

Observability:
OpenTelemetry + managed logs

Deployment:
Docker

CI/CD:
GitHub Actions
```

---

## 11. Architecture Memory

Start:

**Modular monolith**

Internal modules:

```text
Auth
Organizations
Agents
Credentials
Policies
Payment Intents
Approvals
Payment Orchestrator
Provider Adapter
Ledger
Audit
Webhooks
Reconciliation
```

Do not start with microservices.

---

## 12. Data Model Memory

Core entities:

```text
Organization
User
Role
Agent
AgentCredential
Policy
PolicyVersion
PaymentIntent
PaymentDecision
ApprovalTask
Payment
PaymentAttempt
ProviderEvent
LedgerEntry
AuditEvent
WebhookDelivery
IdempotencyKey
```

---

## 13. Critical Security Memory

Never:

- store UPI PIN
- store unnecessary bank credentials
- trust frontend authorization
- let agents call providers directly
- allow LLMs to make final payment decisions
- retry unknown payments blindly
- skip idempotency
- delete audit records

---

## 14. Product Roadmap Memory

```text
Foundation
↓
Agent Identity
↓
Policy Firewall
↓
Payment Intent Engine
↓
Human Approval
↓
Provider Sandbox
↓
Ledger/Reconciliation
↓
End-to-End MVP
↓
Security Hardening
↓
Pilot
↓
Production
```

---

## 15. First Customer Memory

Ideal early customer:

**Indian AI-first startup with a technical founder/CTO.**

Best initial payment use cases:

- AWS/GCP
- SaaS
- API credits
- domains
- software licenses
- approved procurement

Avoid high-risk use cases initially.

---

## 16. Business Model Memory

Preferred model:

```text
SaaS platform fee
+
usage/transaction fee where economically and legally appropriate
+
enterprise integrations
```

Do not build the business plan around capturing a large percentage of UPI volume.

The valuable asset is the control infrastructure.

---

## 17. Moat Memory

Potential moat sequence:

### Early
- excellent developer experience
- reliable API
- provider abstraction
- policy engine
- agent identity

### Growing
- transaction/risk data
- policy intelligence
- enterprise integrations
- audit/compliance workflows
- developer ecosystem

### Later
- agent identity network
- interoperable authorization layer
- risk graph
- industry standards participation
- multi-rail orchestration
- enterprise switching costs

The moat is not:

> "We can send a UPI payment."

The moat is:

> **"Companies trust us to control autonomous money movement."**

---

## 18. North Star

The ultimate goal:

```text
Any AI agent
      ↓
AgentPay
      ↓
Safe authorization
      ↓
Any supported payment rail
```

The developer should not need to understand every payment-rail detail.

---

## 19. Founder Decision Rule

When choosing a feature ask:

1. Does it increase agent payment capability?
2. Does it improve safety/control?
3. Does it make integration easier?
4. Does it create infrastructure-level defensibility?
5. Can a small team build it reliably?

If not, defer it.

---

## 20. Final Product Principle

The company is not trying to make AI agents more autonomous at any cost.

The company exists to make **financial autonomy controllable**.

That is the trust layer.
