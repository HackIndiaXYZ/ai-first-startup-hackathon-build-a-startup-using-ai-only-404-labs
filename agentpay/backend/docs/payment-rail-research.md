# Indian Payment Rail Research for Delegated & Agentic Payments

**Author:** Frame Architecture Team  
**Date:** September 2026 (Updated for RBI/NPCI 2024–2026 Guidelines)  
**Status:** Canonical Reference Document  

---

## 1. Executive Summary & Problem Statement

Autonomous agentic payments present an inherent tension with India's payment security architecture:
1. **The Reserve Bank of India (RBI) mandates Two-Factor Authentication (2FA)** for electronic payments, explicitly requiring an Additional Factor of Authentication (AFA) such as an MPIN or OTP.
2. **Standard UPI P2M (Person-to-Merchant)** relies on a mobile banking application or Third-Party Application Provider (TPAP) executing the Common Library (CL) SDK to prompt the user for a 4- or 6-digit MPIN. The MPIN is encrypted with the bank's public key directly on the mobile OS hardware; it is never accessible to HTTP APIs, server backends, or browser automation scripts.
3. Attempting to automate MPIN or OTP entry via browser emulation, SMS scraping, or headless tools is **illegal, unsafe, brittle, and strictly prohibited** by NPCI circulars and banking regulations.

To enable legitimate agentic payments, an AI agent cannot pretend to be the user entering credentials. Instead, the payment architecture must rely on **Delegated Authorization** and **Pre-Authorization Rails** recognized by the RBI and NPCI.

This document evaluates the candidate payment mechanisms in India, establishes what can and cannot be controlled by Frame, and selects the legitimate integration mechanism for the Frame MVP.

---

## 2. In-Depth Evaluation of Candidate Mechanisms

### 2.1. Candidate 1: NPCI UPI Circle (Circular No. NPCI/UPI/OC No. 201/2024-25)

**Overview:**  
Introduced in August 2024 by NPCI, UPI Circle enables a primary UPI account holder to delegate payment authority to a secondary user (e.g. family member, employee, dependent) through two modes:

#### A. Full Delegation ("Spend With Limits")
- **Mechanism:** Primary user links secondary user's UPI ID. Primary user sets a per-transaction limit (up to ₹5,000) and a monthly spending limit (up to ₹15,000).
- **Secondary User Flow:** Secondary user initiates payment from their own device/app without requiring primary user PIN.
- **Authentication Model:** Secondary user authenticates on their own app using biometric or app passcode (device-level binding).
- **API Availability:** **Consumer Mobile App Only (TPAP-to-TPAP).** There is **no B2B Server REST API** exposed to external third-party software, servers, or merchant backends. The secondary "agent" must be an individual running a certified UPI TPAP application (Google Pay, PhonePe, BHIM).
- **Can AI Agents Use It Today?** **No server-side API exists.** Running an AI agent inside a physical Android/iOS phone with rooted device hooks to bypass app passcodes violates NPCI security policies.

#### B. Partial Delegation ("Approve Each Spend")
- **Mechanism:** Secondary user initiates a transaction; a push notification is sent to the primary user's app. The primary user enters their MPIN to authorize.
- **Can AI Agents Use It Today?** Conceptually identical to Frame's `REQUIRE_APPROVAL` state, but again restricted to consumer UPI apps without a direct enterprise API.

| Dimension | Specification |
|---|---|
| Rail / Authority | NPCI UPI Circle |
| Current Availability | Production in select TPAP apps (Google Pay, BHIM, PhonePe) |
| Sandbox Availability | Restricted to certified bank/TPAP test harnesses |
| Server-Side Initiation | **NOT SUPPORTED** (App-to-App only) |
| Transaction Limits | Per-tx: ₹5,000; Monthly: ₹15,000 |
| Regulatory Constraint | Primary account holder must authenticate linkage via UPI PIN |
| Frame Control | Frame can mimic the policy bounds (₹5,000 / ₹15,000), but cannot act as a direct participant in the absence of a server API |

---

### 2.2. Candidate 2: UPI Reserve / Reserve Pay (Single-Block-Multiple-Debits)

**Overview:**  
UPI Reserve (part of UPI 2.0 / 123Pay / Mandates with Block mechanism) allows an account holder to block funds in their account for a specific merchant order or service (e.g., IPO bidding, hotel booking, e-commerce cash-on-delivery guarantee) which can be debited at a later point in time.

| Dimension | Specification |
|---|---|
| Rail / Authority | NPCI UPI Single-Block-Multiple-Debit (SBMD) |
| Current Availability | Production for IPOs, Government e-Marketplace (GeM), select merchant categories |
| Sandbox Availability | Available through banking aggregators (ICICI, Axis, Razorpay Enterprise) |
| User Consent | Primary user approves initial block amount with UPI PIN |
| Settlement | Merchant server calls capture/debit API against the blocked reference |
| Merchant Requirements | Whitelisted MCCs (IPO, travel, select merchant categories) |
| Agent Viability | Feasible if initial block is approved by user, but restricted in MCC flexibility |

---

### 2.3. Candidate 3: UPI Autopay / e-Mandate (Recurring & Standing Instructions)

**Overview:**  
Under the RBI framework for processing e-mandates for recurring transactions (RBI/2019-20/47 and subsequent notifications raising AFA limit to ₹15,000 in Dec 2020 and ₹1,00,000 for mutual funds/subscriptions in Dec 2023):
1. **Registration:** The customer sets up an e-mandate (via UPI Autopay, Debit Card, or Netbanking) specifying:
   - Maximum transaction amount (e.g., up to ₹15,000 per debit)
   - Frequency (As-and-when-presented / ad-hoc, weekly, monthly)
   - Validity start and end date
   - Purpose / Merchant identifier
2. **Customer Authorization:** The customer authorizes the mandate registration using their UPI PIN or Netbanking/Debit Card 2FA once.
3. **Execution (Subsequent Debits):** The merchant / service provider can initiate server-side debits against the mandate token via standard REST API (`POST /v1/subscriptions/.../charge` or `/v1/payments/recurring`).
4. **Pre-Debit Notification:** For debits above zero, RBI mandates a pre-debit SMS/email notification sent to the customer at least 24 hours prior to debit (unless exemption rules apply for on-demand sub-threshold micro-transactions).
5. **Revocation:** The user can pause, modify, or revoke the mandate at any time from their bank portal or UPI app.

| Dimension | Specification |
|---|---|
| Rail / Authority | RBI e-Mandate Framework / NPCI UPI Autopay |
| Current Availability | **Fully Available in Production** across all major gateways (Razorpay, Cashfree, PayU, Juspay) |
| Sandbox Availability | **Fully Available** in Razorpay and Cashfree test modes |
| Authentication Model | One-time UPI PIN authorization for mandate; **Zero-PIN for subsequent server-side execution** |
| User Consent | Explicit user mandate registration |
| Agent-Initiated Payment | **YES.** Server-side API initiation supported natively by payment gateways |
| Transaction Limits | Up to ₹15,000 per debit without additional factor of authentication |
| Merchant Requirements | Requires merchant account with recurring billing / mandate permissions |
| Webhook Support | Real-time webhooks for mandate.activated, payment.authorized, payment.captured, mandate.revoked |
| Regulatory Compliance | 100% compliant with RBI Master Directions on e-mandates |
| What Frame Controls | Agent budget, daily/monthly ceilings, merchant allowlists, category restrictions, approval escalation, audit ledger |

---

### 2.4. Candidate 4: NPCI Unified Agentic Protocol Initiatives (2025–2026)

**Overview:**  
NPCI and partner banks have initiated early working groups around an Agentic UPI Protocol (delegated credential issuance for AI agents with hardware enclaves).
- **Current Stage:** Concept papers and closed consortia pilots.
- **Public API Availability:** Not publicly available or accessible in standard developer sandboxes.
- **Conclusion:** Frame must be designed to adapt to this protocol once finalized, but cannot rely on it for the present MVP.

---

### 2.5. Candidate 5: Razorpay Delegated & Pre-Authorized Payment Capabilities

Razorpay exposes two production-grade mechanisms for pre-authorized/delegated payments:

1. **Razorpay Subscriptions & UPI Autopay API:**
   - Plan/Mandate setup: Customer authorizes a mandate via UPI Autopay (`upi_autopay`) or card (`card_mandate`).
   - Server-side Charge API: `POST /v1/subscriptions/{id}/charge` or direct token debits.
   - Test sandbox supports mock mandate registration and deterministic recurring debit execution.

2. **Razorpay Customer Tokenization & Pre-Authorization (Order Authorize & Capture):**
   - Order created with `payment_capture: 0`.
   - Card tokenized with RBI CoF (Card-on-File) consent.
   - Server-side capture API: `POST /v1/payments/{id}/capture` within capture window.

---

## 3. Comparison Matrix

| Feature | UPI Circle (Full) | UPI Reserve (SBMD) | UPI Autopay / e-Mandate | Razorpay Subscriptions / Pre-auth |
|---|---|---|---|---|
| **Public Server API** | ❌ No | ⚠️ Partial (IPO/Whitelisted) | ✅ Yes (All Major Gateways) | ✅ Yes (REST API) |
| **Sandbox Available** | ❌ No | ⚠️ Bank specific | ✅ Yes | ✅ Yes |
| **Agent Server-Side Trigger**| ❌ No (App only) | ⚠️ Conditional | ✅ Yes | ✅ Yes |
| **One-Time User Consent** | ✅ App linkage | ✅ Fund block | ✅ Mandate PIN auth | ✅ Mandate / Token auth |
| **Zero-PIN Execution** | ✅ Yes (App biometrics) | ✅ Yes (Server capture) | ✅ Yes (Server API debit) | ✅ Yes (Server API debit) |
| **Spend Ceiling** | ₹5,000/tx, ₹15,000/mo | Blocked amount | ₹15,000/tx (configurable) | Mandate max amount |
| **Category/Merchant Bounds**| ❌ TPAP global | ⚠️ Fixed MCC | ✅ Bound to merchant/aggregator| ✅ Bound to merchant/aggregator |
| **Instant Revocation** | ✅ Via UPI app | ⚠️ Unblock request | ✅ Bank or Gateway API | ✅ Instant API revoke |
| **Webhook Delivery** | ❌ No | ⚠️ Bank dependent | ✅ Standard JSON Webhooks | ✅ Standard HMAC-SHA256 |
| **Regulatory Standing** | NPCI 2024 Circular | NPCI SBMD Specs | RBI e-Mandate Directive | RBI CoF & e-Mandate |

---

## 4. Selection for Frame MVP

### Selected Mechanism: **Pre-Authorized e-Mandate & Delegated Authority Boundary**
- **Rail Provider Adapter:** Razorpay Subscriptions / Autopay & Pre-Authorized Rail Abstraction.
- **Frame Role:** Financial authorization control plane managing `PaymentAuthority` records.

### Why This Is The Only Legitimate Solution:
1. **Zero Credential Faking:** The user registers their mandate or pre-authorization with legitimate 2FA once.
2. **True Server-Side Triggering:** The agent can invoke `frame_create_payment_intent` via MCP. When policy evaluates to `ALLOW`, Frame triggers the server-side debit against the legitimate provider reference without touching or faking user PINs.
3. **Strict Limits Enforced by Frame:** Frame ensures the agent never exceeds the human-granted ceiling (e.g. max ₹3,000 per transaction, daily ₹5,000, allowed categories only), even if the underlying bank mandate limit was set to ₹15,000.
4. **Instant Revocation:** Revoking the `PaymentAuthority` in Frame immediately blocks all subsequent agent requests, and issues a cancellation to the provider rail.

---

## 5. Summary of What Frame Controls vs What Payment Rails Control

| Responsibility | Controlled by Frame | Controlled by Payment Rail (Bank/NPCI/Razorpay) |
|---|---|---|
| **Agent Identity & Authentication** | ✅ Frame Agent API Key (`frm_...`) | ❌ Rail has no concept of AI agents |
| **Authority Window & Revocation** | ✅ Instant local revocation | ⚠️ Eventual mandate cancellation |
| **Category & Merchant Filtering** | ✅ Strict firewall evaluation | ⚠️ High-level MCC checks |
| **Human Approval Escalation** | ✅ Frame approval queue & API | ❌ Not supported by raw payment APIs |
| **Audit & Double-Entry Ledger** | ✅ Cryptographic SHA-256 ledger | ⚠️ Bank statements only |
| **Actual Account Debit / Settlement**| ❌ Delegated to Rail | ✅ Bank / NPCI / Gateway |
| **User Two-Factor Authentication**| ❌ Frame NEVER handles PIN/OTP | ✅ Handled exclusively by bank/gateway SDK |
