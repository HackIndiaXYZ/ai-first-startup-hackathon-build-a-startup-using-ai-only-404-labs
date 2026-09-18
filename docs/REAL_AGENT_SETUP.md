# Frame AI Shopping Agent: Complete Developer Setup Guide

This guide walks a developer through setting up Frame, running the autonomous AI Shopping Agent, configuring a real LLM, and executing autonomous purchases under Frame's delegated financial control plane.

---

## Prerequisites
- Node.js 20+ installed
- Google Chrome installed (for Playwright browser automation)
- Frame Account or Hosted Backend access (`https://frame-backend-868z.onrender.com/v1`)

---

## Step-by-Step Setup

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/HackIndiaXYZ/ai-first-startup-hackathon-build-a-startup-using-ai-only-404-labs.git Frame
cd Frame

# Install root, backend, and agent dependencies
npm install
npm --prefix agent install
```

### Step 2: Configure Environment Variables
Create `.env` in `agent/`:
```bash
cat << 'EOF' > agent/.env
# Frame API URL (Local or Hosted)
FRAME_API_URL=https://frame-backend-868z.onrender.com/v1

# Frame Agent Key (Generated from Frame Dashboard -> Agents)
FRAME_AGENT_API_KEY=frm_test_okfF_RPIjiemSy-bRoXeHzlpOTnCFZEM

# Real LLM Configuration (OpenAI, Anthropic, or OpenAI-Compatible)
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini

# Storefront URL
DEMO_STORE_URL=http://localhost:3002
EOF
```

### Step 3: Start Demo Merchant Storefront
In a separate terminal, start the demo merchant store:
```bash
npm --prefix agentpay/backend run dev:backend
# Or run standalone merchant:
npx ts-node agentpay/backend/src/demo-merchant/server.ts
```
The realistic HTML storefront is now live at: `http://localhost:3002/store`

### Step 4: Run Real Playwright Browser Integration Test
Verify that Google Chrome automates search, variant selection, carting, and DOM checkout extraction:
```bash
npm --prefix agent run test:browser
```
Expected output:
```
🌐 RUNNING REAL PLAYWRIGHT BROWSER AUTOMATION INTEGRATION TEST
  ✓ Storefront running at http://localhost:3002/store
  ✓ Extracted 1 product(s) from live browser DOM
  ✓ Successfully read: "Keychron C3 Mechanical Keyboard" (₹2499)
  ✓ Browser interacted with variant selector & clicked Add-to-Cart
  ✓ Extracted Checkout Session from DOM:
    - Order ID: ORDER_...
    - Total: ₹2499
🎉 REAL PLAYWRIGHT BROWSER AUTOMATION TEST PASSED 100%
```

### Step 5: Test Frame MCP Connection
Verify that the Agent connects to the Frame Model Context Protocol server:
```bash
npm --prefix agent run test:mcp
```

### Step 6: Execute an Autonomous Purchase via CLI
Run the Shopping Agent CLI to execute an end-to-end autonomous purchase:
```bash
npm --prefix agent run agent "Buy me a mechanical keyboard under ₹3,000"
```

### Step 7: Start Agent HTTP API Server
To expose the agent to external webhooks, frontends, or workflows:
```bash
npm --prefix agent run serve
```
Endpoints active on `http://localhost:3005`:
- `POST /agent/runs` — Initiate purchase run
- `GET /agent/runs/:id` — Inspect live run status
- `GET /agent/runs/:id/events` — Stream timeline events
- `POST /agent/runs/:id/resume` — Resume run after human approval
- `POST /agent/runs/:id/cancel` — Cancel run

### Step 8: Observe Execution in Agent Control Center Dashboard
Open `http://localhost:3000/dashboard/agent-demo` in your browser:
1. Enter your Frame Agent API Key (`frm_test_...`).
2. Choose a preset or enter arbitrary shopping instructions.
3. Click **Execute Autonomous Agent**.
4. Observe the live audit timeline with trace IDs.
5. If the purchase exceeds the autonomous limit (e.g. GPU server), click **✓ Approve in Frame** to resume the agent and confirm order fulfillment.
