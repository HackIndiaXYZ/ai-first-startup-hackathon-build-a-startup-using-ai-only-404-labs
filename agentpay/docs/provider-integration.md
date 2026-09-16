# Frame Payment Provider Integration: Razorpay Sandbox

> **Status Notice**: Frame payment infrastructure is production-oriented, but this provider integration is currently sandbox-only.

This document outlines the official integration contract, sandbox capabilities, environment isolation, and operational procedures for connecting Frame with **Razorpay**.

---

## 1. Selected Provider & Official Documentation

- **Provider**: Razorpay (`razorpay`)
- **API Base URL**: `https://api.razorpay.com/v1/`
- **Supported Payment Rails in Adapter**: `upi`, `card`, `bank_transfer`
- **Official Documentation Sources**:
  - [Razorpay Orders API Reference](https://razorpay.com/docs/api/orders/)
  - [Razorpay Payments Fetch API](https://razorpay.com/docs/api/payments/)
  - [Razorpay Webhook Signatures](https://razorpay.com/docs/webhooks/validate-test/)
  - [Razorpay Sandbox Setup Guide](https://razorpay.com/docs/api/sandbox/)
  - [UPI Integration & Migration Guidelines](https://razorpay.com/docs/payments/payment-methods/upi/)

---

## 2. Supported Payment Flows: Verified vs Inferred vs Blocked

| Capability | Status | Official Documentation Details |
| :--- | :--- | :--- |
| **Orders API (`POST /v1/orders`)** | **Verified & Implemented** | Fully supported in sandbox. Creates an order with `amount` (paise), `currency: "INR"`, `receipt`, and metadata `notes`. |
| **Payment Status Inquiry (`GET /v1/orders/:id`, `GET /v1/payments/:id`)** | **Verified & Implemented** | Fully supported in sandbox. Inquires ground-truth status (`created`, `attempted`, `paid`, `captured`, `failed`). |
| **Webhook Signature Verification (`x-razorpay-signature`)** | **Verified & Implemented** | Uses HMAC-SHA256 with timing-safe comparison (`crypto.timingSafeEqual`) over raw request payloads. |
| **Webhook Normalization** | **Verified & Implemented** | Translates official `order.paid`, `payment.captured`, and `payment.failed` into Frame's canonical event model. |
| **UPI Payment Links (`POST /v1/payment_links`)** | **Blocked in Sandbox** | Official docs note: *"UPI Payment Links are supported only in Live Mode. Attempting to use them with Test API keys will result in an error."* |
| **Direct UPI Collect (VPA)** | **Deprecated by NPCI** | Deprecated per NPCI guidelines as of Feb 28, 2026. Standard flow uses UPI Intent or QR codes. |
| **Direct UPI Payouts (`POST /v1/payouts`)** | **Requires Merchant Onboarding** | RazorpayX Payouts requires a current account, business KYC, and CA onboarding. Standard gateway test keys return 401/403. |

---

## 3. Sandbox / Production Isolation & Safety Checks

To prevent catastrophic cross-environment accidents, Frame enforces cryptographic and credential-prefix level isolation:

1. **Environment Flag**: `FRAME_ENV=sandbox` or `FRAME_ENV=production`.
2. **Credential Format Guard**:
   - In `sandbox`, all Razorpay keys must start with `rzp_test_`.
   - In `production`, all Razorpay keys must start with `rzp_live_`.
3. **Fail-Closed Mismatch Exceptions**:
   - Supplying `rzp_live_...` in `FRAME_ENV=sandbox` immediately throws `ENVIRONMENT_MISMATCH_LIVE_IN_SANDBOX`.
   - Supplying `rzp_test_...` in `FRAME_ENV=production` immediately throws `ENVIRONMENT_MISMATCH_TEST_IN_PROD`.

---

## 4. Configuration & Credentials

Credentials can be supplied either via environment variables or the `provider_configs` table. Secrets are never logged or exposed in API responses.

### Environment Variables
Add to `backend/.env`:

```bash
# Frame Environment
FRAME_ENV=sandbox

# Default Payment Provider (mock or razorpay)
DEFAULT_PAYMENT_PROVIDER=razorpay

# Razorpay Developer Sandbox Credentials
RAZORPAY_KEY_ID=rzp_test_YOUR_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

### Organization-Level Database Configuration
Administrators can also configure providers dynamically per tenant via the Frame API:

```http
POST /v1/providers
Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "provider_type": "razorpay",
  "name": "Razorpay Test Gateway",
  "is_default": true,
  "webhook_secret": "whsec_your_secret",
  "settings": {
    "key_id": "rzp_test_YOUR_KEY_ID",
    "key_secret": "YOUR_KEY_SECRET"
  }
}
```

---

## 5. Inbound Webhook Configuration

1. In the Razorpay Dashboard (Settings > Webhooks), set the webhook URL to:
   ```
   https://<your-frame-domain>/v1/webhooks/razorpay
   ```
2. Enter your **Webhook Secret** and select the following events:
   - `order.paid`
   - `payment.captured`
   - `payment.failed`
3. When webhooks arrive:
   - Signature is verified against `x-razorpay-signature`.
   - Raw payload is persisted in `provider_events`.
   - Replay attacks are deduplicated.
   - Payment status transitions safely to `succeeded` or `failed`.
   - Double-entry ledger creates a `DEBIT` upon `succeeded`.

---

## 6. Financial Invariants & UNKNOWN State Handling

- **UNKNOWN != FAILED**: If Razorpay's API experiences a network drop, connection timeout, or 5xx server error during order creation or inquiry, the payment is marked with status `unknown` and the intent remains in `EXECUTING`.
- **Zero False Retries**: Frame never blindly retries ambiguous payments.
- **Zero Unconfirmed Ledger Postings**: No ledger entry is posted until confirmed settlement.
- **Reconciliation Resolution**: Ambiguous transactions are resolved during automated reconciliation sweeps (`POST /v1/reconciliation/run`) by querying Razorpay's ground truth status endpoints.

---

## 7. Running the Automated Tests

### Run Both Test Suites
```bash
cd /Users/dev/Desktop/Frame/agentpay/backend
npm test
```

### Run Provider-Specific Contract Test Suite Only (Simulated Webhooks & Contract Verification)
```bash
npm run test:provider
```

### Run Core Acceptance Test Suite Only (Deterministic Mock Provider)
```bash
npm run test:acceptance
```

### Run Live Razorpay Sandbox Network Probe (Genuine HTTPS to api.razorpay.com)
```bash
npm run test:live-sandbox
```

---

## 8. Test Distinctions: Simulated vs Real Sandbox

Frame maintains strict distinction between different tiers of tests:

1. **Acceptance Tests (`tests/e2e-acceptance.ts`)**:
   - Uses `MockPaymentProvider`.
   - Tests all 7 engine core invariants: automatic payment under threshold, policy denial, human-in-the-loop approvals, unknown state preservation, concurrent request deduplication, webhook idempotency, and agent credential revocation.
   - 100% deterministic and offline-capable.

2. **Provider Contract Tests (`tests/providers/razorpay-sandbox.ts`)**:
   - Uses `RazorpayPaymentProvider` with simulated webhook payloads.
   - Tests official Razorpay HMAC-SHA256 signature verification, event normalization (`order.paid`, `payment.captured`, `payment.failed`), key format validation (`rzp_test_`), and timeout/error mapping.
   - Clearly labeled as contract & adapter verification.

3. **Live Sandbox Network Tests (`tests/providers/razorpay-live-sandbox.ts`)**:
   - Dispatches live HTTPS requests to `https://api.razorpay.com/v1/orders`.
   - Without API credentials: Verifies real HTTP 401 response and error payload mapping from Razorpay's live edge servers.
   - With API credentials (`RAZORPAY_KEY_ID=rzp_test_...`): Executes an end-to-end payment intent through Policy Firewall -> PaymentOrchestrator -> Razorpay Orders API -> Remote Order Fetch -> Reconciliation sweep.
