# Frame — Real Payment Provider & Rail Matrix (Phase 2)
**Date**: September 11, 2026  
**Status**: Real-world regulatory and API viability assessment  

---

## 1. Indian Payment Rails: Autonomous Agent Viability

Autonomous AI agents cannot and must never possess a user's UPI PIN, debit card CVV, netbanking password, or SMS OTP. Under Reserve Bank of India (RBI) directives on Additional Factor of Authentication (AFA), interactive step-up authentication is mandatory for ad-hoc consumer-initiated payments.

However, legitimate Indian payment frameworks explicitly provide for delegated, pre-authorized, and recurring payment execution:

| Payment Rail | Autonomous Agent Feasibility | Regulatory / NPCI Framework | Initial Authentication | Subsequent Debit Execution | Frame Support Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UPI AutoPay (e-Mandate)** | ✅ **YES** | NPCI e-Mandate circulars for recurring and variable debits up to ₹15,000/tx without second-factor authentication. | User authorizes mandate via AFA (UPI PIN / Netbanking / Debit Card) during initial setup. | Merchant / Agent initiates server-side debit via UMN (Unique Mandate Number) after pre-notification. | `REAL_SANDBOX` (via Razorpay Subscriptions/e-Mandates) |
| **UPI Circle (Delegated Payments)** | ⚠️ **PARTIAL** | NPCI UPI Circle specification (Primary user delegates spend to Secondary user). | Primary user links secondary user with monthly (max ₹15,000) or per-tx (max ₹5,000) caps. | Full delegation permits secondary app to debit directly without primary PIN. Currently restricted to bank-issued VPAs in NPCI pilot. | `ARCHITECTURE_ONLY` (interfaces defined, awaiting open public banking APIs) |
| **UPI Reserve / Single-Block-Multi-Debit** | ⚠️ **PARTIAL** | NPCI Single-Block-Multi-Debit (e.g. IPO / e-commerce reserve holds). | Primary user authenticates total hold amount once via UPI PIN. | Merchant debits multiple partial increments up to the reserved hold upon delivery. | `ARCHITECTURE_ONLY` (supported on select bank acquirers) |
| **One Time Mandate (OTM)** | ✅ **YES** | NPCI One Time Mandate for delayed settlement / pre-authorized transactions. | User approves single-use mandate with max ceiling via AFA. | Acquirer settles final captured amount server-side without step-up PIN. | `REAL_SANDBOX` |
| **Card Mandate (RBI Subscriptions)** | ✅ **YES** | RBI e-Mandate on Credit/Debit Cards for recurring/standing instructions up to ₹15,000/tx. | Initial registration transaction requires 3D Secure OTP verification. | Subsequent server-side debits execute autonomously using saved customer/mandate token. | `REAL_SANDBOX` (via Razorpay Subscriptions API) |
| **Card Pre-Authorization (Auth & Capture)** | ✅ **YES** | Card Network Two-Step Authorization (Authorization hold + Capture). | Human pre-authorizes maximum hold during session setup. | Agent captures final verified merchant charge server-side within authorization window. | `REAL_SANDBOX` (via Razorpay Payment Capture API) |
| **UPI Standard (P2P / P2M)** | ❌ **NOT_SUPPORTED** | Interactive UPI standard requiring on-screen MPIN. | Interactive MPIN required for every transaction. | Cannot be automated or bypassed without illegal credential theft. | `NOT_SUPPORTED` for autonomous execution; interactive only. |

---

## 2. Regulated Payment Provider Matrix

| Evaluation Criteria | Razorpay | Cashfree | PayU | Pine Labs | Stripe India |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **API Available?** | ✅ Yes (v1 REST API) | ✅ Yes (v2/v3 REST API) | ✅ Yes (REST API) | ✅ Yes (REST API) | ✅ Yes (v1 REST API) |
| **Sandbox Available?** | ✅ Yes (instant test keys `rzp_test_...`) | ✅ Yes (Sandbox environment) | ✅ Yes (Test merchant) | ⚠️ Requires sales approval | ✅ Yes (Test mode) |
| **Production Available?** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Limited India invite-only |
| **Merchant Onboarding Required?** | ✅ Yes (Business registration) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **KYC Required?** | ✅ Yes (PAN, GSTIN, Bank verification) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Agentic / Delegated Payment Supported?** | ✅ Yes (Subscriptions, e-Mandates, Auth & Capture) | ✅ Yes (Subscriptions, Auto Collect) | ⚠️ Partial (Subscriptions) | ⚠️ Partial (POS/Enterprise) | ✅ Yes (SetupIntents, Subscriptions) |
| **Mandate Supported?** | ✅ Yes (UPI AutoPay, Card Mandates) | ✅ Yes (e-NACH, UPI AutoPay) | ✅ Yes (SI on Cards/UPI) | ⚠️ Enterprise only | ✅ Yes (Card e-mandates) |
| **Server-Side Initiation Supported?** | ✅ Yes (`/orders`, `/payments/capture`, `/subscriptions`) | ✅ Yes (`/orders`, `/subscriptions`) | ✅ Yes | ⚠️ Limited | ✅ Yes (`/payment_intents`) |
| **Human Authorization Required?** | Initial setup only (AFA required for mandate/pre-auth; 0 PIN on recurring) | Initial setup only | Initial setup only | Initial setup only | Initial setup only |
| **Webhook Support?** | ✅ Yes (HMAC-SHA256 with secret) | ✅ Yes (Signature verification) | ✅ Yes (Reverse hash) | ✅ Yes | ✅ Yes (HMAC-SHA256) |
| **Refund Support?** | ✅ Yes (`POST /v1/payments/:id/refund`) | ✅ Yes (`POST /pg/orders/:id/refunds`) | ✅ Yes | ✅ Yes | ✅ Yes (`POST /v1/refunds`) |
| **Reconciliation Support?** | ✅ Yes (`GET /orders/:id`, `GET /payments/:id`) | ✅ Yes (`GET /orders/:id`) | ✅ Yes | ✅ Yes | ✅ Yes |
| **Transaction Status API?** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Idempotency?** | ✅ Yes (`X-Razorpay-Idempotency-Key` or unique receipt) | ✅ Yes | ⚠️ Optional | ⚠️ Not standard | ✅ Yes (`Idempotency-Key`) |
| **Production Credentials Required?** | ✅ Yes (`rzp_live_...`) | ✅ Yes (Production App ID/Secret) | ✅ Yes | ✅ Yes | ✅ Yes |

---

## 3. Frame's Chosen Provider & Rail

For the Frame Working MVP, we select **Razorpay Sandbox** utilizing:
1. **Orders API (`POST /v1/orders`)**: For initiating merchant-bound payments with bounded receipts and deterministic metadata.
2. **Payment Verification & Capture (`POST /v1/payments/:id/capture`)**: For two-step pre-authorization holds and captures.
3. **Refund API (`POST /v1/payments/:id/refund`)**: For full and partial transaction reversals.
4. **HMAC-SHA256 Webhook Verification (`x-razorpay-signature`)**: For verifiable, tamper-evident asynchronous settlement confirmation.
5. **Reconciliation Inquiries (`GET /v1/orders/:id`, `GET /v1/payments/:id`)**: For automatic recovery of in-flight and ambiguous execution states.
