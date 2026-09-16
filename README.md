# Frame — Autonomous Financial Infrastructure & Policy Firewall for AI Agents

> **Hackathon Team**: 404 Labs  
> **Event**: HackIndia AI-First Startup Hackathon (`HackIndiaXYZ/ai-first-startup-hackathon-build-a-startup-using-ai-only-404-labs`)  
> **License**: MIT  

---

## ⚡ Executive Summary

As AI agents gain computer-use and browser automation capabilities, they are increasingly expected to perform real-world commerce—booking flights, purchasing SaaS subscriptions, ordering hardware, and provisioning cloud services.

However, existing payment gateways were built exclusively for humans typing 16-digit credit card numbers and OTPs into web forms. Exposing raw corporate cards to autonomous LLMs introduces catastrophic financial exposure, hallucinated overspending, and security violations.

**Frame** is the financial infrastructure layer and programmable policy firewall for the AI agent economy. Frame allows developers and enterprises to issue cryptographic **Payment Authorities** with granular spending policies (budgets, velocity limits, merchant whitelists, human-in-the-loop approvals) and gives AI agents native **Model Context Protocol (MCP)** tools to execute payments safely on real payment rails.

---

## 🏛️ System Architecture

```
                       ┌─────────────────────────────────┐
                       │    Human Principal / Developer  │
                       └────────────────┬────────────────┘
                                        │ Sets Limits & Authorities
                                        ▼
                       ┌─────────────────────────────────┐
                       │    Frame Management Dashboard   │
                       │    (Next.js 14 + Tailwind)      │
                       └────────────────┬────────────────┘
                                        │ Issues Agent Key
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        External AI Agent Ecosystem                     │
│  (Claude Desktop, Cursor, Antigravity, AutoGPT, LangChain, Browser)   │
└───────────────────────────────────────┬────────────────────────────────┘
                                        │ Uses Model Context Protocol (MCP)
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Frame Backend & Core                          │
│                                                                        │
│   ┌─────────────────────┐    ┌─────────────────────────────────────┐  │
│   │    Agent Auth &     │    │           Policy Firewall           │  │
│   │   Identity Layer    │───▶│  • Transaction limits  • Whitelists │  │
│   └─────────────────────┘    │  • Daily caps          • Approvals  │  │
│                                └──────────────────┬──────────────────┘  │
│                                                   │                     │
│                                                   ▼                     │
│                              ┌─────────────────────────────────────┐  │
│                              │       Orchestrator & Ledger         │  │
│                              │  • Payment Intent Lifecycle         │  │
│                              │  • Double-entry ledger              │  │
│                              │  • BullMQ asynchronous worker       │  │
│                              └──────────────────┬──────────────────┘  │
└─────────────────────────────────────────────────┼──────────────────────┘
                                                  │
                                                  ▼
                               ┌─────────────────────────────────────┐
                               │     Real Payment Rails & Gateways   │
                               │  • Razorpay Sandbox & Live Rails    │
                               │  • Webhook signature verification   │
                               │  • Automatic reconciliation         │
                               └─────────────────────────────────────┘
```

---

## ✨ Core Capabilities

1. **Programmable Policy Firewall**:
   - Every payment intent is evaluated against deterministic policy rules before touching any financial rail.
   - Restrict agents by:
     - Maximum per-transaction amount (in paise / cents)
     - Cumulative daily & monthly velocity limits
     - Allowed / blocked merchant categories and domains
     - Automatic escalation to **Human-in-the-Loop (HITL)** approval for anomalous or high-value purchases.

2. **Cryptographic Payment Authorities**:
   - Agents never touch raw credit card numbers or banking secrets.
   - Authorities represent scoped, revocable, and time-bounded spending tokens linked to real payment methods.

3. **Native Model Context Protocol (MCP) Server**:
   - Out-of-the-box MCP integration compatible with Claude Desktop, Cursor, Antigravity IDE, and external agent runtimes.
   - Exposes clean agent tools: `create_payment_intent`, `get_payment_authority`, `check_policy_limits`, and `confirm_payment`.

4. **Production-Ready Payment Rails**:
   - Direct integration with **Razorpay** payment gateway (both Sandbox and Live).
   - Cryptographic webhook HMAC verification.
   - Asynchronous queue worker powered by **BullMQ** and **Redis** with exponential backoff and idempotency keys.

5. **Double-Entry Ledger & Tamper-Evident Audit Trail**:
   - Strict append-only financial accounting for all transactions.
   - Real-time spend tracking per agent, team, and organization.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | Next.js 14 (App Router), React 18, TypeScript, Lucide Icons |
| **Backend API** | Node.js 20+, Fastify, TypeScript, `@fastify/jwt`, `@fastify/cors` |
| **Agent Protocols** | Model Context Protocol (`@modelcontextprotocol/sdk`) |
| **Database** | PostgreSQL 16+ with raw SQL migration engine |
| **Queue & Cache** | Redis 7+ & BullMQ asynchronous job orchestration |
| **Payment Rail** | Razorpay SDK (Sandbox & Live) + Webhook HMAC verification |
| **Container & CI/CD** | Multi-stage Docker, Docker Compose, GitHub Actions, Render Blueprint |

---

## 🚀 Getting Started Locally

### Prerequisites
- Node.js v18+ and npm
- Docker and Docker Compose

### 1. Clone & Setup
```bash
git clone https://github.com/HackIndiaXYZ/ai-first-startup-hackathon-build-a-startup-using-ai-only-404-labs.git
cd ai-first-startup-hackathon-build-a-startup-using-ai-only-404-labs
```

### 2. Launch Infrastructure (Postgres + Redis)
```bash
cd agentpay
docker compose up -d postgres redis
```

### 3. Run Database Migrations
```bash
cd backend
npm install
npm run migrate
```

### 4. Start Development Servers
From the root directory, run both servers concurrently:
```bash
npm install
npm run dev
```
- **Dashboard UI**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:3001](http://localhost:3001)
- **API Health**: [http://localhost:3001/health](http://localhost:3001/health)

---

## 🤖 Connecting External AI Agents via MCP

Frame provides a built-in MCP server so external agents can query policies and execute payments securely.

### Claude Desktop / Cursor MCP Configuration
Add Frame MCP to your agent's config file (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "frame": {
      "command": "node",
      "args": [
        "/path/to/frame/agentpay/backend/dist/mcp/index.js"
      ],
      "env": {
        "FRAME_API_URL": "http://localhost:3001/v1",
        "FRAME_AGENT_API_KEY": "frm_test_your_agent_key_here"
      }
    }
  }
}
```

---

## 🌐 Production Deployment

Frame is built for zero-downtime, multi-cloud production deployment.

### Option 1: Render One-Click Blueprint (`render.yaml`)
1. Connect this repository to your [Render Dashboard](https://render.com).
2. Click **New** → **Blueprint**.
3. Render will automatically provision:
   - **PostgreSQL Database** (`frame-postgres`)
   - **Redis Cache & Queue** (`frame-redis`)
   - **Backend Web Service** with automated migrations (`frame-backend`)
   - **Frontend Web Service** (`frame-frontend`)

### Option 2: Docker Compose Production Stack
Run the production stack with Nginx reverse proxy and SSL support:
```bash
./scripts/deploy.sh prod
```
Or manually:
```bash
docker compose -f agentpay/docker-compose.prod.yml up -d --build
```

### Option 3: Automated CLI Deployment Tool
```bash
./scripts/deploy.sh check    # Verify prerequisites & environment
./scripts/deploy.sh build    # Build standalone production bundles
./scripts/deploy.sh migrate  # Apply production migrations
./scripts/deploy.sh cloud    # View cloud hosting step-by-step guides
```

---

## 🔒 Security & Compliance

- **No Cardholder Data Exposure**: AI agents only receive transient, scoped Payment Authority tokens.
- **Idempotency Keys**: All financial operations require `Idempotency-Key` headers to prevent double-charging.
- **Tenant Isolation**: Row-Level Security and strict organizational boundaries isolate all agents and accounts.
- **Audit Logging**: Every API call, policy decision, approval, and execution creates an immutable audit record.

---

## 👥 Team 404 Labs

Developed for the **HackIndia AI-First Startup Hackathon**:
- **Dev Sharma** ([@devsharmaofficial](https://github.com/devsharmaofficial))

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
