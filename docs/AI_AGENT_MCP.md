# Frame Autonomous AI Shopping Agent — Model Context Protocol (MCP) Integration

## 1. Overview

The Shopping Agent communicates with Frame through the Model Context Protocol (MCP) standard, utilizing `@modelcontextprotocol/sdk`.

```
[AI Shopping Agent]
       │
       ▼ (StdioClientTransport / JSON-RPC 2.0)
[Frame MCP Server] (agentpay/backend/src/mcp/index.ts)
       │
       ▼ (Fastify REST API & Database)
[Frame Policy Firewall & Payment Authority]
```

---

## 2. MCP Tools Used by Agent

| Tool Name | Purpose | Parameters | Agent Reaction |
|---|---|---|---|
| `frame_list_payment_authorities` | Discovers active delegated payment authorities | `status?: ACTIVE` | Checks limits, allowances, allowlists |
| `frame_get_payment_authority` | Retrieves fine-grained budget and threshold details | `authority_id` | Enforces budget caps |
| `frame_create_payment_intent` | Submits payment intent to Frame Policy Firewall | `amount_paise`, `merchant`, `order_reference`, `purpose`, `category`, `idempotency_key` | Reads `decision` (`ALLOW` / `REQUIRE_APPROVAL` / `DENY`) |
| `frame_get_payment_status` | Polls authoritative payment settlement status | `payment_intent_id` | Verifies real settlement before confirming order |
| `frame_request_approval` | Escalates high-value or elevated transactions to human principals | `payment_intent_id`, `notes` | Enters `WAITING_FOR_HUMAN_APPROVAL` |

---

## 3. Integration Code Sample

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npm',
  args: ['--prefix', '../agentpay/backend', 'run', 'mcp'],
  env: {
    FRAME_API_URL: 'https://frame-backend-868z.onrender.com/v1',
    FRAME_AGENT_API_KEY: 'frm_test_...',
  },
});

const client = new Client(
  { name: 'frame-autonomous-shopping-agent', version: '1.0.0' },
  { capabilities: {} }
);

await client.connect(transport);
const tools = await client.listTools();
console.log('Available Frame Tools:', tools.tools.map(t => t.name));
```
