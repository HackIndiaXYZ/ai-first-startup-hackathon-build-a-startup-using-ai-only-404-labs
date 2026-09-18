# Frame Autonomous AI Shopping Agent — Setup & Developer Guide

## 1. Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation
From the repository root:
```bash
# Install agent dependencies
cd agent && npm install

# Return to root
cd ..
```

---

## 2. Configuration (.env)

Copy the environment template:
```bash
cp agent/.env.example agent/.env
```

Configuration parameters:

```env
# ── LLM Configuration ──────────────────────────────────────
# Provider options: 'deterministic' | 'openai-compatible' | 'anthropic'
LLM_PROVIDER=deterministic
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# ── Frame MCP Configuration ─────────────────────────────────
FRAME_API_URL=https://frame-backend-868z.onrender.com/v1
FRAME_AGENT_API_KEY=frm_test_your_key_here

# ── Merchant Configuration ──────────────────────────────────
MERCHANT_BASE_URL=http://localhost:3002
```

---

## 3. Running the Agent

### CLI Runner
You can run the agent directly using the root npm script:
```bash
npm run agent "Buy me a mechanical keyboard under ₹3,000"
```

### Agent HTTP API Server
To start the Agent API server (port 3005):
```bash
npm run agent:serve
```

Endpoints exposed:
- `POST /agent/runs`: Start an autonomous purchasing execution.
  ```json
  {
    "instruction": "Buy me a mechanical keyboard under ₹3,000",
    "agentApiKey": "frm_test_..."
  }
  ```
- `GET /agent/runs`: List all agent runs.
- `GET /agent/runs/:id`: Get full state of a specific run.
- `GET /agent/runs/:id/events`: Stream execution events.

---

## 4. Running the Tests

Execute all test suites from the root directory:

```bash
# Run all agent tests (unit, 20 security scenarios, MCP integration, E2E)
npm run test:agent

# Run 20 security scenarios specifically
npm run test:agent-security

# Run end-to-end purchasing lifecycle
npm run test:agent-e2e
```
