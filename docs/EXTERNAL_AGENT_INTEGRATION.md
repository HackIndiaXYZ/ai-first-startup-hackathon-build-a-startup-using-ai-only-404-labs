# External AI Agent Integration Guide

Frame functions as a zero-trust financial control plane for external AI agents. External agents (such as Anthropic Claude, Cursor, AutoGPT, or custom LangChain/CrewAI agents) connect to Frame strictly through the **Model Context Protocol (MCP)** or authenticated REST API.

External agents never have direct database access, never hold payment credentials, and cannot self-approve expenditures.

---

## 1. Quick Architecture Overview

```
┌──────────────────────────────┐
│       External AI Agent      │
│  (Claude / Cursor / Custom)  │
└──────────────┬───────────────┘
               │  MCP Protocol (Stdio / SSE / HTTP)
               ▼
┌──────────────────────────────┐
│       Frame MCP Server       │
│     (Tool Schema & Auth)     │
└──────────────┬───────────────┘
               │  Strict Policy Firewall
               ▼
┌──────────────────────────────┐
│  Frame Control Plane & Auth  │
│  - Payment Authority Bounds  │
│  - Multi-Rule Policy Engine  │
│  - Human Approval Workflow   │
│  - Double-Entry Ledger       │
└──────────────────────────────┘
```

---

## 2. Setting Up Claude Desktop with Frame MCP

To connect Claude Desktop to Frame:

1. Open your Claude Desktop configuration file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the Frame MCP server configuration:

```json
{
  "mcpServers": {
    "frame": {
      "command": "node",
      "args": [
        "/Users/dev/Desktop/Frame/agentpay/backend/dist/mcp/index.js"
      ],
      "env": {
        "FRAME_API_URL": "https://frame-backend-868z.onrender.com/v1",
        "FRAME_AGENT_API_KEY": "frm_test_okfF_RPIjiemSy-bRoXeHzlpOTnCFZEM"
      }
    }
  }
}
```

3. Restart Claude Desktop.
4. Verify tools: You will see the hammer icon with:
   - `frame_create_payment_intent`
   - `frame_get_payment_status`
   - `frame_get_payment_intent`
   - `frame_request_approval`
   - `frame_list_payment_authorities`
   - `frame_get_payment_authority`

---

## 3. Setting Up Cursor with Frame MCP

1. Open Cursor Settings -> **Features** -> **MCP Servers**.
2. Click **+ Add New MCP Server**.
3. Configure:
   - **Name**: `Frame Financial Control Plane`
   - **Type**: `command`
   - **Command**: `node /Users/dev/Desktop/Frame/agentpay/backend/dist/mcp/index.js`
   - **Environment Variables**:
     - `FRAME_API_URL`: `https://frame-backend-868z.onrender.com/v1`
     - `FRAME_AGENT_API_KEY`: `<your_agent_api_key>`
4. Save and verify that green status appears indicating tools connected.

---

## 4. Generic MCP Client (Node.js / Python)

### Node.js Example via `@modelcontextprotocol/sdk`

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/Frame/agentpay/backend/dist/mcp/index.js'],
  env: {
    FRAME_API_URL: 'https://frame-backend-868z.onrender.com/v1',
    FRAME_AGENT_API_KEY: 'frm_test_...',
  },
});

const client = new Client({ name: 'ExternalAgent', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// 1. Discover active spending authorities
const authorities = await client.callTool({
  name: 'frame_list_payment_authorities',
  arguments: {},
});
console.log('Active authorities:', authorities);

// 2. Submit payment intent through Frame Policy Firewall
const paymentResult = await client.callTool({
  name: 'frame_create_payment_intent',
  arguments: {
    amount_paise: 249900,
    currency: 'INR',
    merchant: 'TechSupply Store',
    category: 'electronics',
    purpose: 'Keyboard purchase',
    idempotency_key: `ext_run_${Date.now()}`,
  },
});
console.log('Decision:', paymentResult);
```

### Python Example via `mcp` package

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="node",
    args=["/path/to/Frame/agentpay/backend/dist/mcp/index.js"],
    env={
        "FRAME_API_URL": "https://frame-backend-868z.onrender.com/v1",
        "FRAME_AGENT_API_KEY": "frm_test_...",
    },
)

async def run():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print("Connected tools:", [t.name for t in tools.tools])

asyncio.run(run())
```

---

## 5. Security Guarantees for External Agents

1. **Zero Credential Collection**: External agents NEVER request, hold, or process card CVVs, OTPs, or UPI PINs.
2. **Immutable Intent Bounds**: The maximum purchase amount, product category, and quantity cannot be inflated by webpage content or LLM hallucinations.
3. **No Self-Approval**: If Frame determines that a transaction requires human approval (`REQUIRE_APPROVAL`), the external agent cannot approve itself. It must pause and await human confirmation via the Frame Dashboard.
4. **Idempotency Guarantee**: Every request uses a unique `idempotency_key` derived from the agent run and order ID, preventing accidental duplicate charges.
