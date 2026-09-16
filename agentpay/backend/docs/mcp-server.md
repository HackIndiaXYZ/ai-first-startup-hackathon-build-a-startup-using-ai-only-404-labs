# Frame MCP Server — Financial Authorization & Control Plane for AI Agents

The **Frame MCP Server** implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to provide AI agents with a secure, policy-controlled gateway to Frame's enterprise payment infrastructure.

---

## 1. Architectural Role & Boundary

Frame MCP acts strictly as the **financial authorization and control plane** for AI agents. It is **not** a browser automation framework.

```
+-------------------------------------------------------------+
|             Autonomous AI Agent (Claude / Cursor / etc.)    |
+-------------------------------------------------------------+
               |                               |
       Browser / Computer Tool          Frame MCP Protocol
               |                               |
               v                               v
+-----------------------------+ +-----------------------------+
|      Checkout Website       | |      Frame MCP Server       |
|  - Browsing                 | |  - Prohibited field filters |
|  - Cart & item selection    | |  - Agent auth & scoping     |
|  - Address form filling     | +-----------------------------+
+-----------------------------+                |
                                               v
                                +-----------------------------+
                                |      Frame Core Backend     |
                                |  - Policy Firewall          |
                                |  - Idempotency Locks        |
                                |  - PaymentOrchestrator      |
                                |  - Double-Entry Ledger      |
                                +-----------------------------+
```

| Component | Responsibility | What It Must NOT Do |
| :--- | :--- | :--- |
| **Browser MCP / Computer Use** | Website navigation, clicking buttons, extracting merchant items, filling delivery addresses | Never make financial policy decisions or store secrets |
| **Frame MCP** | Authenticates agent, executes Policy Firewall, manages approval workflows, orchestrates payment | Never automate browsers or handle raw bank passwords / OTPs |

---

## 2. Why AI Agents Use Frame MCP

1. **Deterministic Guardrails**: Spending limits, daily budgets, allowed merchant lists, and restricted categories are strictly enforced by the **Policy Firewall** before any money moves.
2. **Human-in-the-Loop Workflow**: High-value transactions automatically trigger `REQUIRE_APPROVAL` and queue a task for authorized human approvers without interrupting the agent's task state.
3. **Double-Spend & Race Protection**: Distributed Redis + PostgreSQL idempotency locks ensure duplicate or retried calls with the same `idempotency_key` never trigger multiple executions.
4. **Credential Isolation**: AI agents are never given bank passwords, credit card CVVs, or UPI PINs. They only communicate **what** they need to pay for.

---

## 3. Authentication & Multi-Tenant Isolation

- Every MCP request resolves an `organization_id` and `agent_id` through the agent's API key (format: `frm_test_...` or `frm_live_...`).
- The API key can be supplied globally via `FRAME_AGENT_API_KEY` environment variable or dynamically passed via the `agent_api_key` tool parameter.
- **Tenant Isolation**: An agent belonging to Organization A is cryptographically and organizationally blocked from viewing, modifying, or accessing payments, policies, agents, approvals, or ledger entries of Organization B (returning 404 / access denied).

---

## 4. MCP Tools Reference

### 1. `frame_create_payment_intent`
Authorizes and initiates a payment through Frame's deterministic Policy Firewall.

#### Input Schema
```json
{
  "amount": 2499.00,
  "currency": "INR",
  "merchant": "Amazon India",
  "merchant_reference": "AMZN-ORD-98214",
  "purpose": "Mechanical Keyboard for developer workstation",
  "category": "peripherals",
  "idempotency_key": "agent_checkout_kbd_001",
  "metadata": { "department": "engineering" }
}
```
*Note: Both `amount` (major currency units, e.g. 2499.00) and `amount_paise` (minor units, e.g. 249900) are accepted.*

#### Response Scenarios

- **Allowed Transaction (`ALLOW`)**:
```json
{
  "payment_intent_id": "01M27PVYHYHVG17VPVCGHBRTBM",
  "decision": "ALLOW",
  "status": "SUCCEEDED",
  "amount": 2499,
  "currency": "INR",
  "merchant": "Amazon India",
  "next_action": "PAYMENT_EXECUTION"
}
```

- **Approval Required (`REQUIRE_APPROVAL`)**:
```json
{
  "payment_intent_id": "01M27PVZY1DKS6PVEZ4XJ3QSM2",
  "decision": "REQUIRE_APPROVAL",
  "status": "PENDING_APPROVAL",
  "amount": 4200,
  "currency": "INR",
  "merchant": "Hetzner Online",
  "next_action": "WAIT_FOR_APPROVAL",
  "reasons": [
    "APPROVAL_REQUIRED: ₹4200 meets or exceeds approval threshold ₹2500"
  ]
}
```

- **Policy Denied (`DENY`)**:
```json
{
  "payment_intent_id": "01M27PW82...",
  "decision": "DENY",
  "status": "DENIED",
  "amount": 500,
  "currency": "INR",
  "merchant": "Casino Royale",
  "next_action": "DO_NOT_RETRY",
  "reason_code": "CATEGORY_RESTRICTED: Category 'gambling' is not permitted by policy."
}
```

---

### 2. `frame_get_payment_status`
Retrieves execution status and decision details for a payment intent.

#### Input Schema
```json
{
  "payment_intent_id": "01M27PVYHYHVG17VPVCGHBRTBM"
}
```

#### Response
```json
{
  "payment_intent_id": "01M27PVYHYHVG17VPVCGHBRTBM",
  "status": "SUCCEEDED",
  "decision": "ALLOW",
  "approval_state": null,
  "payment_state": null,
  "next_action": "NONE",
  "error": null
}
```

---

### 3. `frame_get_payment_intent`
Returns complete safe payment intent details. Internal tokens, provider secrets, and webhook secrets are strictly stripped.

#### Input Schema
```json
{
  "payment_intent_id": "01M27PVYHYHVG17VPVCGHBRTBM"
}
```

#### Response
```json
{
  "id": "01M27PVYHYHVG17VPVCGHBRTBM",
  "organization_id": "01M27PV...",
  "agent_id": "01M27PV...",
  "amount": 2499,
  "amount_paise": 249900,
  "currency": "INR",
  "merchant": "Amazon India",
  "merchant_reference": "AMZN-ORD-98214",
  "purpose": "Mechanical Keyboard for developer workstation",
  "category": "peripherals",
  "status": "SUCCEEDED",
  "decision": "ALLOW",
  "denial_reason": null,
  "approval_status": null,
  "approval_task_id": null,
  "created_at": "2026-09-11T07:45:00.000Z",
  "expires_at": "2026-09-11T08:45:00.000Z",
  "metadata": { "department": "engineering" }
}
```

---

### 4. `frame_request_approval`
Explicitly queries and requests human approval workflow for a transaction currently in `PENDING_APPROVAL` status.

#### Input Schema
```json
{
  "payment_intent_id": "01M27PVZY1DKS6PVEZ4XJ3QSM2",
  "notes": "Urgent infrastructure upgrade for production benchmarking"
}
```

#### Response
```json
{
  "payment_intent_id": "01M27PVZY1DKS6PVEZ4XJ3QSM2",
  "decision": "REQUIRE_APPROVAL",
  "status": "PENDING_APPROVAL",
  "approval_task_id": "01M27PVZY9ZFSENNFFR3ZPRZPZ",
  "approval_status": "pending",
  "expires_at": "2026-09-12T07:45:45.929Z",
  "next_action": "WAIT_FOR_APPROVAL",
  "message": "Human approval has been requested. Check status using frame_get_payment_status once approved."
}
```

> [!CAUTION]
> **No Agent Self-Approval**: Agents are strictly forbidden from approving payments. Any attempt to pass `{ "action": "approve" }` triggers immediate error `UNAUTHORIZED_APPROVAL_ATTEMPT`. Approvals require a separate authorized human token with `approver`, `admin`, or `owner` role.

---

## 5. Security & Sensitive Credential Defense

Frame MCP enforces strict zero-trust boundary validation:

1. **Prohibited Parameter Sanitization**: The MCP tool layer recursively inspects all input fields and metadata. If any prohibited credential key (e.g. `pin`, `upi_pin`, `otp`, `cvv`, `password`, `bank_password`) is present, the request is rejected with error code `SENSITIVE_CREDENTIAL_REJECTED` before any data is sent to the backend or persisted.
2. **Deterministic Rate Limiting**: All underlying HTTP endpoints enforce client and tenant rate limits via `@fastify/rate-limit`.
3. **Sanitized Error Output**: Internal database stack traces and connection strings are suppressed; agents receive clean, actionable JSON error structures.

---

## 6. End-to-End Example: Autonomous Shopping Flow

```
User Prompt:
"Buy a mechanical keyboard under ₹3,000 for the desk setup."

Step 1: Agent uses Browser MCP
- Agent navigates e-commerce storefront.
- Locates Keychron mechanical keyboard priced at ₹2,499.
- Adds to cart and proceeds to checkout page.

Step 2: Agent delegates to Frame MCP
- Agent invokes `frame_create_payment_intent`:
  amount: 2499.00
  currency: "INR"
  merchant: "Amazon India"
  purpose: "Keychron Mechanical Keyboard"
  category: "peripherals"
  idempotency_key: "agent_order_kbd_491"

Step 3: Frame Policy Firewall evaluates intent
- Transaction limit: ₹5,000 (Pass: 2499 <= 5000)
- Approval threshold: ₹2,500 (Pass: 2499 < 2500)
- Allowed categories: ['electronics', 'peripherals'] (Pass)
- Agent returns decision: "ALLOW", status: "SUCCEEDED" / "AUTHORIZED"

Step 4: Payment Execution
- PaymentOrchestrator fulfills transaction via configured provider.
- Agent tracks status via `frame_get_payment_status` and confirms order.
```

---

## 7. Local Setup & Testing

### Running the MCP Server via Stdio
```bash
cd agentpay/backend

# Export Agent credentials
export FRAME_API_URL="http://localhost:3001/v1"
export FRAME_AGENT_API_KEY="frm_test_your_key_here"

# Start the MCP Server
npm run mcp
```

### Configuring Claude Desktop / Cursor
Add the following to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "frame": {
      "command": "node",
      "args": [
        "/Users/dev/Desktop/Frame/agentpay/backend/dist/mcp/index.js"
      ],
      "env": {
        "FRAME_API_URL": "http://localhost:3001/v1",
        "FRAME_AGENT_API_KEY": "frm_test_your_agent_api_key"
      }
    }
  }
}
```

### Running the Automated Tests
```bash
# Run the 8 MCP functional & security tests
npm run test:mcp

# Run the real AI Agent smoke test over MCP JSON-RPC
npm run test:mcp-smoke

# Run full project regression test suite
npm test
```
