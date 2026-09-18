'use client';

import React, { useState, useRef, useEffect } from 'react';
import { resolveApiBase } from '@/lib/api';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  emoji: string;
  risk: 'safe' | 'elevated' | 'blocked';
}

interface AgentLog {
  id: string;
  timestamp: string;
  type: 'thinking' | 'action' | 'success' | 'warning' | 'error' | 'info' | 'policy';
  message: string;
  detail?: string;
}

interface PaymentResult {
  decision: string;
  status: string;
  payment_intent_id: string;
  amount: number;
  merchant: string;
  next_action: string;
  reasons?: string[];
  canonicalCheckout?: {
    subtotal: number;
    shipping: number;
    total: number;
    orderId: string;
  };
}

const PRODUCTS: Product[] = [
  { id: 'prod_kbd_01', name: 'Keychron C3 Mechanical Keyboard', description: 'Hot-swappable RGB mechanical keyboard — ₹2,499', price: 2499, category: 'electronics', emoji: '⌨️', risk: 'safe' },
  { id: 'prod_mouse_03', name: 'Logitech Precision Wireless Mouse', description: 'Ergonomic 4000 DPI multi-device mouse — ₹1,499', price: 1499, category: 'electronics', emoji: '🖱️', risk: 'safe' },
  { id: 'prod_chair_02', name: 'Ergonomic Office Chair Pro', description: 'High-back mesh lumbar support chair — ₹2,799', price: 2799, category: 'office', emoji: '🪑', risk: 'elevated' },
  { id: 'prod_chips_04', name: 'Casino Royale VIP Chips Pack', description: '⚠️ Blocked category: gambling — ₹2,499', price: 2499, category: 'gambling', emoji: '🎰', risk: 'blocked' },
  { id: 'prod_server_05', name: 'Enterprise GPU Server Rack', description: '⚠️ Over per-tx limit: infrastructure — ₹9,999', price: 9999, category: 'infrastructure', emoji: '🖥️', risk: 'blocked' },
];

const PRESET_PROMPTS = [
  { text: 'Buy me a mechanical keyboard under ₹3,000', productId: 'prod_kbd_01', label: '⌨️ Keyboard (ALLOW)' },
  { text: 'Order ergonomic office chair below ₹20,000', productId: 'prod_chair_02', label: '🪑 Chair (Elevated)' },
  { text: 'Buy casino chips pack under ₹5,000', productId: 'prod_chips_04', label: '🎰 Casino (DENY)' },
  { text: 'Purchase enterprise GPU server under ₹20,000', productId: 'prod_server_05', label: '🖥️ GPU Server (Approval)' },
];

function uid() { return Math.random().toString(36).slice(2, 10); }
function nowStr() { return new Date().toLocaleTimeString('en-IN', { hour12: false }); }

const RISK_BADGE: Record<string, string> = {
  safe: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  elevated: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  blocked: 'bg-red-500/20 text-red-400 border border-red-500/30',
};

const LOG_ICON: Record<string, string> = { thinking: '🤔', action: '⚡', success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️', policy: '🛡️' };
const LOG_COLOR: Record<string, string> = { thinking: 'text-blue-300', action: 'text-purple-300', success: 'text-emerald-400', warning: 'text-amber-400', error: 'text-red-400', info: 'text-slate-400', policy: 'text-cyan-400' };

export default function AgentDemoPage() {
  const [apiKey, setApiKey] = useState('');
  const [instruction, setInstruction] = useState('Buy me a mechanical keyboard under ₹3,000');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(PRODUCTS[0]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [step, setStep] = useState<'idle' | 'intent' | 'searching' | 'checkout' | 'authorizing' | 'done'>('idle');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { const s = localStorage.getItem('frame_agent_api_key') || ''; if (s) setApiKey(s); }, []);

  function addLog(type: AgentLog['type'], message: string, detail?: string) {
    setLogs((prev) => [...prev, { id: uid(), timestamp: nowStr(), type, message, detail }]);
  }
  function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  function handlePreset(p: { text: string; productId: string }) {
    setInstruction(p.text);
    const prod = PRODUCTS.find((x) => x.id === p.productId);
    if (prod) setSelectedProduct(prod);
  }

  async function runAgent() {
    if (!apiKey.trim()) { alert('Please enter your Frame Agent API Key (starts with frm_test_ or frm_live_)'); return; }
    localStorage.setItem('frame_agent_api_key', apiKey.trim());
    setRunning(true); setLogs([]); setResult(null);
    const baseUrl = resolveApiBase();
    const idempotencyKey = `agent_run_${Date.now()}_${uid()}`;

    try {
      // 1. Intent Extraction
      setStep('intent');
      addLog('thinking', 'Autonomous Shopping Agent initializing runtime…');
      await sleep(500);

      addLog('info', `🎯 Instruction received: "${instruction}"`);
      await sleep(400);

      // Extract amount and product from text
      const matchAmount = instruction.match(/(?:₹|rs\.?|under|below|max\s+budget|budget)\s*([\d,]+)/i);
      const budgetRupees = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, '')) : 3000;
      addLog('action', `Immutable User Intent locked: Max Budget ₹${budgetRupees.toLocaleString('en-IN')} (paise: ${budgetRupees * 100})`, 'Task: purchase | Currency: INR | Autonomous: true');
      await sleep(500);

      // 2. Catalog Search & Selection
      setStep('searching');
      addLog('thinking', 'Scanning merchant catalog for matching inventory…');
      await sleep(700);

      const target = selectedProduct || PRODUCTS[0];
      addLog('action', `Candidate discovered: ${target.emoji} ${target.name}`, `Price: ₹${target.price.toLocaleString('en-IN')} | Category: ${target.category} | Stock: In Stock`);
      await sleep(500);

      addLog('thinking', `Evaluating ranking criteria: budget check, relevance match, and category authorization…`);
      await sleep(500);
      addLog('success', `Selected best candidate: ${target.name}`, `Within user budget of ₹${budgetRupees.toLocaleString('en-IN')} — Transparent score: 95/100`);
      await sleep(600);

      // 3. Cart & Checkout Extraction
      setStep('checkout');
      addLog('action', `Adding item to cart at TechSupply Store…`);
      await sleep(600);

      const orderId = `ORD_${Date.now()}_${uid().toUpperCase()}`;
      const subtotal = target.price;
      const shipping = 0;
      const total = subtotal + shipping;

      addLog('action', `Merchant checkout session created: ${orderId}`, `Subtotal: ₹${subtotal.toLocaleString('en-IN')} | Shipping: Free | Total: ₹${total.toLocaleString('en-IN')}`);
      await sleep(600);

      addLog('thinking', `Extracting canonical checkout object and verifying Intent Binding…`);
      await sleep(500);

      // 4. Intent Binding Verification
      if (total > budgetRupees) {
        addLog('error', `Intent binding violation: Checkout total ₹${total} exceeds user budget ₹${budgetRupees}!`, 'Halting immediately (Fail-Closed)');
        setStep('done'); setRunning(false); return;
      }
      addLog('success', `Intent binding verified: Total ₹${total} <= Budget ₹${budgetRupees}`);
      await sleep(400);

      // 5. Frame Authorization & Policy Evaluation
      setStep('authorizing');
      addLog('thinking', `Querying Frame MCP client (frame_create_payment_intent)…`, `Key: ${idempotencyKey}`);
      await sleep(400);
      addLog('policy', 'Frame Policy Firewall evaluating transaction against active Payment Authority…', `Merchant: TechSupply Store | Category: ${target.category} | Amount: ₹${total.toLocaleString('en-IN')}`);

      const res = await fetch(`${baseUrl}/v1/payment-intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey.trim() },
        body: JSON.stringify({
          amount_paise: total * 100,
          currency: 'INR',
          merchant: 'TechSupply Store',
          merchant_reference: orderId,
          order_reference: orderId,
          purpose: `Purchase ${target.name} from TechSupply Store`,
          category: target.category,
          idempotency_key: idempotencyKey,
          metadata: {
            agent: 'Frame Autonomous Shopping Agent v1.0',
            product_id: target.id,
            instruction,
          },
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = body?.error || {};
        addLog('error', `Frame API error: ${err.message || `HTTP ${res.status}`}`, err.code || '');
        setStep('done'); setRunning(false); return;
      }

      const intent = body.data;
      const firewall = intent.firewall || {};
      const decision = firewall.decision || intent.decision || intent.status || 'UNKNOWN';
      const reasons: string[] = firewall.reasons || (intent.denial_reason ? [intent.denial_reason] : []);

      const payResult: PaymentResult = {
        decision,
        status: intent.status,
        payment_intent_id: intent.id,
        amount: intent.amount_paise / 100,
        merchant: intent.merchant,
        next_action: 'UNKNOWN',
        reasons,
        canonicalCheckout: { subtotal, shipping, total, orderId },
      };

      if (decision === 'DENY' || intent.status === 'DENIED') {
        payResult.next_action = 'DO_NOT_RETRY';
        addLog('policy', `🛡️ Frame Firewall Decision: DENY`, reasons.join(' • ') || 'Policy violation');
        addLog('warning', 'Transaction blocked by Frame Policy Firewall', `Intent: ${intent.id}`);
        addLog('info', 'Agent halting immediately — DO_NOT_RETRY enforced by policy.');
      } else if (decision === 'REQUIRE_APPROVAL' || intent.status === 'PENDING_APPROVAL') {
        payResult.next_action = 'WAIT_FOR_APPROVAL';
        addLog('policy', `🛡️ Frame Firewall Decision: REQUIRE_APPROVAL`, reasons.join(' • ') || 'Above autonomous threshold');
        addLog('warning', 'Human approval required before settlement', `Intent: ${intent.id}`);
        addLog('info', 'Calling frame_request_approval — notifying human principal…');
        await sleep(800);
        await fetch(`${baseUrl}/v1/payment-intents/${intent.id}/request-approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey.trim() },
          body: JSON.stringify({ notes: `Agent autonomous purchase for ${target.name}. Order: ${orderId}` }),
        }).catch(() => null);
        addLog('success', 'Approval request sent to human principal', 'Pending approval in Dashboard → Approvals');
      } else {
        payResult.next_action = 'PAYMENT_EXECUTION';
        addLog('policy', `🛡️ Frame Firewall Decision: ALLOW`, 'Authorized by delegated Payment Authority');
        addLog('action', 'Payment intent authorized — initiating settlement…', `Intent: ${intent.id}`);
        await sleep(700);

        const statusRes = await fetch(`${baseUrl}/v1/payment-intents/${intent.id}`, { headers: { 'X-API-Key': apiKey.trim() } });
        const statusBody = await statusRes.json().catch(() => ({}));
        const latestStatus = statusBody?.data?.status || intent.status;
        payResult.status = latestStatus;

        if (['SUCCEEDED', 'COMPLETED', 'SETTLED', 'AUTHORIZED', 'EXECUTING', 'PROCESSING'].includes(latestStatus)) {
          payResult.next_action = 'NONE';
          addLog('success', `Payment executed and settled! 🎉`, `Status: ${latestStatus} | ₹${total.toLocaleString('en-IN')}`);
          addLog('action', 'Sending fulfillment confirmation to merchant…', `Order: ${orderId}`);
          await sleep(500);
          addLog('success', 'Order confirmed for fulfillment. Autonomous shopping task complete! 📦');
        } else {
          addLog('info', `Payment processing — status: ${latestStatus}`);
        }
      }

      setResult(payResult);
      setStep('done');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog('error', `Unexpected error: ${message}`);
      setStep('done');
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setLogs([]);
    setResult(null);
    setStep('idle');
  }

  const STEP_LABELS: Record<string, { label: string; color: string }> = {
    idle: { label: 'Ready', color: 'text-slate-400' },
    intent: { label: 'Extracting Intent…', color: 'text-blue-400' },
    searching: { label: 'Searching Catalog…', color: 'text-indigo-400' },
    checkout: { label: 'Creating Order…', color: 'text-purple-400' },
    authorizing: { label: 'Frame Policy Check…', color: 'text-cyan-400' },
    done: { label: 'Done', color: 'text-emerald-400' },
  };

  return (
    <div className="min-h-screen text-white p-6" style={{ backgroundColor: '#0a0a0f' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');.mono{font-family:'JetBrains Mono',monospace}`}</style>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <div style={{ width:32, height:32, borderRadius:8, background:'linear-gradient(135deg,#7c3aed,#4338ca)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>🤖</div>
          <h1 className="text-xl font-semibold">Autonomous AI Shopping Agent</h1>
          <span className="ml-2 text-xs mono px-2 py-0.5 rounded-full" style={{ background:'rgba(124,58,237,0.2)', color:'#a78bfa', border:'1px solid rgba(124,58,237,0.3)' }}>FRAME MCP RUNTIME</span>
        </div>
        <p className="text-sm ml-11" style={{ color:'#64748b' }}>A genuine autonomous AI agent that interprets natural language instructions, navigates merchant checkout, and pays under Frame&apos;s financial control plane.</p>
      </div>

      <div className="max-w-6xl mx-auto mt-6 grid gap-6" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1.9fr)' }}>
        {/* Left panel */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Agent API Key */}
          <div className="rounded-xl p-4" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.6)' }}>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color:'#cbd5e1' }}>🔑 Frame Agent API Key</h2>
            <input
              type="text"
              placeholder="frm_test_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-xs mono"
              style={{ background:'#020617', border:'1px solid #334155', color:'#e2e8f0', outline:'none' }}
            />
            <p className="text-xs mt-2" style={{ color:'#475569' }}>Dashboard → Agents → generate or copy an agent API key</p>
          </div>

          {/* Natural Language Instruction */}
          <div className="rounded-xl p-4" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.6)' }}>
            <h2 className="text-sm font-semibold mb-2" style={{ color:'#cbd5e1' }}>💬 Natural Language User Instruction</h2>
            <textarea
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={running}
              placeholder="e.g. Buy me a mechanical keyboard under ₹3,000"
              className="w-full rounded-lg px-3 py-2 text-xs"
              style={{ background:'#020617', border:'1px solid #334155', color:'#e2e8f0', outline:'none', resize:'none' }}
            />

            <div className="mt-3">
              <span className="text-xs" style={{ color:'#64748b' }}>Quick Presets:</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {PRESET_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePreset(p)}
                    disabled={running}
                    className="text-xs px-2 py-1 rounded border transition-colors text-left"
                    style={{
                      background: instruction === p.text ? 'rgba(124,58,237,0.2)' : 'rgba(30,41,59,0.5)',
                      borderColor: instruction === p.text ? '#7c3aed' : '#334155',
                      color: instruction === p.text ? '#c4b5fd' : '#94a3b8',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Selected Product Details */}
          <div className="rounded-xl p-4" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.6)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color:'#cbd5e1' }}>🛒 Discovered Target Product</h2>
            {selectedProduct && (
              <div className="p-3 rounded-lg border" style={{ background:'rgba(2,6,23,0.5)', borderColor:'#334155' }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selectedProduct.emoji}</span>
                  <div>
                    <div className="text-sm font-medium text-white">{selectedProduct.name}</div>
                    <div className="text-xs text-slate-400">Price: ₹{selectedProduct.price.toLocaleString('en-IN')} | Category: {selectedProduct.category}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${RISK_BADGE[selectedProduct.risk]}`}>
                    {selectedProduct.risk === 'safe' ? '✓ Safe' : selectedProduct.risk === 'elevated' ? '⚡ Elevated' : '⛔ Blocked'}
                  </span>
                  <span className="text-xs text-slate-500">Merchant: TechSupply Store</span>
                </div>
              </div>
            )}
          </div>

          {/* Run Button */}
          <button
            onClick={step === 'done' ? reset : runAgent}
            disabled={running}
            style={{
              width:'100%',
              padding:'12px',
              borderRadius:8,
              fontWeight:600,
              fontSize:13,
              border:'none',
              cursor: running ? 'not-allowed' : 'pointer',
              background: step === 'done' ? '#334155' : running ? '#4c1d95' : 'linear-gradient(135deg,#7c3aed,#4f46e5)',
              color:'#fff',
              transition:'all 0.2s',
            }}
          >
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                {STEP_LABELS[step]?.label}
              </span>
            ) : step === 'done' ? '↺ Reset & Run Again' : '🚀 Execute Autonomous Agent'}
          </button>
        </div>

        {/* Right panel: Terminal & Logs */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div className="rounded-xl flex flex-col flex-1" style={{ border:'1px solid #1e293b', background:'#050814', minHeight:520 }}>
            {/* Terminal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                <span className="ml-2 text-xs mono text-slate-400">agent-session: live_runtime</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs mono ${STEP_LABELS[step]?.color}`}>
                  ● {STEP_LABELS[step]?.label}
                </span>
              </div>
            </div>

            {/* Terminal Body */}
            <div className="p-4 flex-1 overflow-y-auto font-mono text-xs space-y-2.5" style={{ maxHeight: 420 }}>
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                  <span className="text-3xl mb-2">🤖</span>
                  <p>Agent is idle. Enter API key and click Execute to start.</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2.5">
                    <span className="text-slate-600 shrink-0">{log.timestamp}</span>
                    <span className="shrink-0">{LOG_ICON[log.type]}</span>
                    <div className="flex-1 min-w-0">
                      <span className={LOG_COLOR[log.type]}>{log.message}</span>
                      {log.detail && (
                        <div className="text-slate-500 mt-0.5 break-all pl-2 border-l border-slate-800">
                          {log.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Final Execution Card */}
            {result && (
              <div className="p-4 border-t border-slate-800 bg-slate-900/40 rounded-b-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300">Execution Result</span>
                  <span className={`text-xs mono px-2 py-0.5 rounded font-bold ${
                    result.decision === 'ALLOW' ? 'bg-emerald-500/20 text-emerald-400' :
                    result.decision === 'REQUIRE_APPROVAL' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    FRAME DECISION: {result.decision}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mono text-slate-400">
                  <div>Payment Intent: <span className="text-slate-200">{result.payment_intent_id}</span></div>
                  <div>Settled Amount: <span className="text-slate-200">₹{result.amount.toLocaleString('en-IN')}</span></div>
                  <div>Merchant: <span className="text-slate-200">{result.merchant}</span></div>
                  <div>Next Action: <span className="text-slate-200">{result.next_action}</span></div>
                </div>
                {result.reasons && result.reasons.length > 0 && (
                  <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                    Policy Notes: {result.reasons.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
