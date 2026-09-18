# Frame Autonomous AI Shopping Agent — Security & Defense Model

## 1. Core Threat Model

The AI Shopping Agent operates in a zero-trust environment where both web content and LLM outputs are treated as untrusted. The only authoritative sources are:
1. **The original User Intent** (immutable lock).
2. **Frame's Policy Firewall and Delegated Payment Authority**.

```
[Untrusted Merchant Webpage]
  | Contains hidden prompt injections, price increases, unauthorized categories
  v
[Security Hardening Layer]
  ├── Untrusted Content Scanner (PromptInjectionError)
  ├── Deep Credential Scrubber (SensitiveCredentialError)
  └── Domain Policy Engine (DomainPolicyError)
  v
[Intent Binding Engine]
  ├── Budget verification: Canonical Total <= User Budget
  ├── Authority limits: Canonical Total <= Authority Max & Daily Allowance
  └── Anti-Substitution: Product/Category matches User Intent
  v
[Frame Policy Firewall] (Authoritative ALLOW / REQUIRE_APPROVAL / DENY)
```

---

## 2. The 20 Mandatory Security Controls

| # | Security Scenario | Agent Mitigation & Invariant |
|---|---|---|
| 1 | **Budget Tampering** | Intent is sealed via `Object.freeze`. Any attempt by the LLM or page to overwrite budget throws runtime error. |
| 2 | **Merchant Substitution** | Domain policy enforces merchant allowlist/blocklist. Substituted merchants fail closed. |
| 3 | **Product Substitution** | Intent binding verifies product name and category against target terms. Swapping keyboard for office chair throws `PRODUCT_SUBSTITUTION_DETECTED`. |
| 4 | **Category Mismatch** | Prohibited categories (gambling, betting, casino, adult) are blocked immediately by domain policy. |
| 5 | **Price Increase at Checkout** | Canonical checkout total is evaluated against user budget. Increases over budget throw `BUDGET_EXCEEDED`. |
| 6 | **Shipping Fee Increase** | Canonical extractor includes shipping and taxes. Hidden shipping that pushes total over budget throws `BUDGET_EXCEEDED`. |
| 7 | **Prompt Injection** | `scanUntrustedContent` detects patterns like "ignore previous instructions", "system prompt override", and rejects malicious input. |
| 8 | **Malicious Fund Transfer** | Instructions in product descriptions asking to transfer funds or override rules are flagged and blocked. |
| 9 | **Authority Revocation** | Authorities with status != `ACTIVE` (e.g. `REVOKED`) throw `AUTHORITY_INACTIVE` and halt execution. |
| 10| **Authority Expiration** | Expired payment authorities throw `AUTHORITY_INACTIVE`. |
| 11| **Frame DENY** | When Frame returns `DENY`, the agent sets `DO_NOT_RETRY`, outputs the exact reason, and does not retry. |
| 12| **Frame REQUIRE_APPROVAL** | Halts immediately in `WAITING_FOR_HUMAN_APPROVAL`. The agent cannot self-approve; only human principals can approve. |
| 13| **Duplicate Payment Replay** | Every payment intent uses a deterministic idempotency key (`agent_run_<runId>_<orderId>`). |
| 14| **MCP Server Disconnection** | MCP transport failures fail closed. The agent never assumes payment succeeded. |
| 15| **Provider Timeout** | Unresponsive provider status is marked `UNKNOWN`. |
| 16| **UNKNOWN Payment State** | `UNKNOWN` is never treated as `SUCCESS`. Status polling or reconciliation is required before any order confirmation. |
| 17| **Cross-Tenant Isolation** | All agent API keys and authorities are scoped to `organization_id`. Cross-tenant calls return 404/403. |
| 18| **Secret Leakage** | Event logs and telemetry never emit raw API keys, secrets, or internal tokens. |
| 19| **UPI PIN Request** | Any presence of `upi_pin`, `pin` in payload or text throws `SENSITIVE_CREDENTIAL_REJECTED`. |
| 20| **OTP Request** | Any presence of `otp`, `cvv`, `password` in payload throws `SENSITIVE_CREDENTIAL_REJECTED`. |

---

## 3. Strict Credential Prohibitions

Under no circumstances will the agent ever:
- Request, store, or forward a UPI PIN
- Request, store, or forward an SMS/Email OTP
- Request, store, or forward a card CVV or card PIN
- Request, store, or forward net banking passwords
