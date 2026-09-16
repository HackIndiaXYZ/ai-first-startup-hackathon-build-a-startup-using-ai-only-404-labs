# AgentPay India — System Architecture

## 1. Architecture Principle

Build a **modular monolith first**, not microservices.

The MVP needs strong boundaries but does not need operational complexity.

Recommended:

- Backend: TypeScript + Node.js + Fastify
- Database: PostgreSQL
- Cache/short-lived state: Redis
- Queue/jobs: Redis-backed queue initially
- Frontend: Next.js + React + TypeScript
- SDK: TypeScript first; Python after validation
- Cloud: AWS
- Containers: Docker
- Secrets: AWS Secrets Manager
- Encryption/key operations: AWS KMS
- Observability: OpenTelemetry + managed logs
- CI/CD: GitHub Actions

Use clear internal modules so services can be extracted later.

---

## 2. High-Level Architecture

```text
                 ┌────────────────────┐
                 │      AI Agent      │
                 └─────────┬──────────┘
                           │ HTTPS
                           ▼
                 ┌────────────────────┐
                 │   API Gateway      │
                 │ Auth + Rate Limits │
                 └─────────┬──────────┘
                           ▼
              ┌──────────────────────────┐
              │     AgentPay Backend     │
              │                          │
              │ Agent Identity           │
              │ Payment Intent Service   │
              │ Policy Firewall          │
              │ Approval Service         │
              │ Payment Orchestrator     │
              │ Ledger                   │
              │ Audit                    │
              │ Webhooks                 │
              └───────┬─────────┬────────┘
                      │         │
                ┌─────▼───┐ ┌──▼─────────┐
                │Postgres │ │   Redis    │
                └─────────┘ └────────────┘
                      │
                      ▼
              ┌──────────────────┐
              │ Payment Adapter  │
              └────────┬─────────┘
                       ▼
               PSP / UPI Provider
                       │
                       ▼
                    UPI Rail
```

---

## 3. Module Boundaries

### Identity Module
Responsibilities:
- company authentication
- user roles
- agent credentials
- key rotation
- agent status
- revocation

### Agent Module
Responsibilities:
- agent registration
- metadata
- owner
- lifecycle
- capabilities

### Policy Module
Responsibilities:
- policies
- rules
- limits
- allowlists
- approval thresholds
- policy versions

### Payment Intent Module
Responsibilities:
- create intent
- validate input
- idempotency
- state machine
- policy invocation

### Policy Firewall
Responsibilities:
- deterministic authorization
- budget checks
- merchant checks
- category checks
- frequency checks
- approval decision

### Approval Module
Responsibilities:
- approval tasks
- approver authorization
- approve/reject
- expiration
- escalation

### Payment Orchestrator
Responsibilities:
- select provider
- create execution request
- handle retries
- provider state mapping
- provider callbacks

### Ledger
Responsibilities:
- financial event records
- debit/credit representation
- provider reference
- reconciliation status

### Audit
Responsibilities:
- every security-sensitive event
- actor
- timestamp
- action
- before/after
- request ID
- policy version
- decision

---

## 4. Payment Intent State Machine

Never use a simple boolean such as `paid=true`.

Use explicit states.

```text
CREATED
  ↓
EVALUATING
  ├── DENIED
  ├── PENDING_APPROVAL
  │      ├── REJECTED
  │      └── APPROVED
  ↓
AUTHORIZED
  ↓
EXECUTING
  ├── FAILED
  └── SUCCEEDED
```

Add `EXPIRED` where applicable.

Every transition must be:
- validated
- logged
- idempotent
- timestamped

---

## 5. Provider Abstraction

Define an internal interface:

```text
PaymentProvider
  createAuthorization()
  executePayment()
  getPaymentStatus()
  cancelPayment()
  handleWebhook()
```

The business logic must never directly depend on one provider.

MVP should implement exactly one provider adapter.

Future adapters:

```text
UPIProvider
RazorpayProvider
CashfreeProvider
PineLabsProvider
BankProvider
CardProvider
```

The adapter translates provider-specific behavior into AgentPay's normalized payment state model.

---

## 6. Policy Evaluation

Policy evaluation must be deterministic.

Do not ask an LLM:

> "Should we allow this payment?"

Instead:

```text
Agent valid?
AND
Agent active?
AND
Policy active?
AND
Amount <= transaction limit?
AND
Daily spend + amount <= daily limit?
AND
Monthly spend + amount <= monthly limit?
AND
Merchant allowed?
AND
Category allowed?
AND
Frequency allowed?
AND
Intent authorization valid?
```

Then:

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

LLMs can help classify or explain, but cannot be the final authorization authority.

---

## 7. Intent Binding

Each payment intent should contain:

- agent ID
- task ID
- purpose
- merchant
- amount
- policy version
- expiry
- nonce
- idempotency key

Create a canonical representation and hash it.

Store:

```text
intent_hash
policy_version
agent_key_id
created_at
expires_at
```

For MVP, intent binding should mean:

**the payment must remain within a pre-authorized task/policy scope.**

Do not claim that semantic LLM matching alone proves authorization.

---

## 8. Agent Authentication

MVP:

- human dashboard authentication: session/OAuth-compatible auth
- server-to-server agent authentication: API key or signed JWT
- each credential belongs to one agent
- credential rotation
- immediate revocation

Future:

- asymmetric agent keys
- signed intents
- certificate-backed identities
- external agent registries
- hardware-backed keys

Never store plaintext long-lived secrets.

---

## 9. Database

PostgreSQL is the source of truth.

Core tables:

```text
organizations
users
roles
agents
agent_credentials
policies
policy_versions
payment_intents
payment_decisions
approval_tasks
payments
payment_attempts
provider_events
ledger_entries
audit_events
webhook_deliveries
idempotency_keys
```

Use:
- UUID/ULID identifiers
- timestamps in UTC
- foreign keys
- unique constraints
- database transactions

---

## 10. Ledger

MVP ledger is a tamper-evident relational ledger.

Every financial event should record:

- organization
- payment intent
- payment
- amount
- currency
- event type
- provider reference
- timestamp
- previous event hash
- event hash

Do NOT add blockchain.

---

## 11. Idempotency

Every payment-creating request requires:

```text
Idempotency-Key
```

The same organization + key must return the original result.

Never execute a provider payment twice because of:
- network timeout
- retry
- webhook duplication
- worker crash

Provider reference IDs must also be unique.

---

## 12. Webhooks

Webhook handling:

```text
Provider
  ↓
Webhook endpoint
  ↓
Authenticate signature
  ↓
Store raw event
  ↓
Deduplicate
  ↓
Update payment state
  ↓
Create ledger event
  ↓
Emit internal event
  ↓
Notify customer
```

Never trust a webhook without signature verification where supported.

---

## 13. Queue / Async Work

Use a queue for:
- payment execution
- webhook processing
- retries
- approval notifications
- reconciliation
- outbound webhooks

The API request should not depend on long-running background work.

---

## 14. Security

Mandatory MVP controls:

- TLS
- encrypted secrets
- KMS-managed encryption
- RBAC
- rate limiting
- request validation
- webhook signature validation
- credential rotation
- audit logging
- database backups
- least privilege
- separate sandbox/production environments

Never store:
- UPI PIN
- bank passwords
- raw authentication secrets
- unnecessary card data

Use regulated providers for sensitive payment operations.

---

## 15. Deployment

Initial production:

```text
AWS
├── Load balancer
├── Containerized Node.js backend
├── Next.js frontend
├── RDS PostgreSQL
├── ElastiCache Redis
├── S3
├── KMS
├── Secrets Manager
├── CloudWatch
└── Optional SQS later
```

Start small.

Do not deploy Kubernetes until operational requirements justify it.

---

## 16. Environments

Three environments:

```text
local
staging
production
```

No production credentials in local/staging.

---

## 17. Reliability Targets

Initial targets:

- API availability: 99.5%+
- policy decision p95: <100 ms
- API p95 excluding provider latency: <300 ms
- zero duplicate execution caused by our system
- webhook processing: <30 seconds under normal load

Payment-provider latency is outside our direct SLO.

---

## 18. Architecture Evolution

### Stage 1
Modular monolith.

### Stage 2
Extract:
- webhook worker
- payment execution worker
- policy engine if required

### Stage 3
Extract provider adapters and high-volume components.

### Stage 4
Multi-region and advanced compliance architecture.

Never prematurely build distributed systems.
