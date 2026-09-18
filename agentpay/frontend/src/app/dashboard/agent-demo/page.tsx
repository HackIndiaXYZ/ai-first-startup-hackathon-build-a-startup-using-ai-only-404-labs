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
}

const PRODUCTS: Product[] = [
  { id: 'prod_kbd_01', name: 'Keychron C3 Mechanical Keyboard', description: 'Hot-swappable RGB mechanical keyboard — ₹2,499', price: 2499, category: 'electronics', emoji: '⌨️', risk: 'safe' },
  { id: 'prod_mouse_03', name: 'Logitech Precision Wireless Mouse', description: 'Ergonomic 4000 DPI multi-device mouse — ₹1,499', price: 1499, category: 'electronics', emoji: '🖱️', risk: 'safe' },
  { id: 'prod_chair_02', name: 'Ergonomic Office Chair Pro', description: 'High-back mesh lumbar support chair — ₹2,799', price: 2799, category: 'office', emoji: '🪑', risk: 'elevated' },
  { id: 'prod_chips_04', name: 'Casino Royale VIP Chips Pack', description: '⚠️ Blocked category: gambling — ₹2,499', price: 2499, category: 'gambling', emoji: '🎰', risk: 'blocked' },
  { id: 'prod_server_05', name: 'Enterprise GPU Server Rack', description: '⚠️ Over per-tx limit: infrastructure — ₹9,999', price: 9999, category: 'infrastructure', emoji: '🖥️', risk: 'blocked' },
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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [step, setStep] = useState<'idle' | 'searching' | 'checkout' | 'authorizing' | 'done'>('idle');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { const s = localStorage.getItem('frame_agent_api_key') || ''; if (s) setApiKey(s); }, []);

  function addLog(type: AgentLog['type'], message: string, detail?: string) {
    setLogs((prev) => [...prev, { id: uid(), timestamp: nowStr(), type, message, detail }]);
  }
  function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  async function runAgent() {
    if (!selectedProduct) return;
    if (!apiKey.trim()) { alert('Please enter your Frame Agent API Key (starts with frm_test_ or frm_live_)'); return; }
    localStorage.setItem('frame_agent_api_key', apiKey.trim());
    setRunning(true); setLogs([]); setResult(null);
    const baseUrl = resolveApiBase();
    const product = selectedProduct;
    const idempotencyKey = `agent_demo_${Date.now()}_${uid()}`;

    try {
      setStep('searching');
      addLog('thinking', 'Initializing Frame Shopping Agent v1.0…');
      await sleep(600);
      addLog('info', `🎯 Task: Purchase "${product.name}"`);
      addLog('thinking', `Scanning product catalog…`);
      await sleep(900);
      addLog('action', `Product found: ${product.emoji} ${product.name}`, `Category: ${product.category} | ₹${product.price.toLocaleString('en-IN')}`);
      await sleep(500);

      setStep('checkout');
      addLog('thinking', 'Proceeding to merchant checkout…');
      await sleep(700);
      const orderId = `ORDER_${Date.now()}_${uid().toUpperCase()}`;
      addLog('action', `Merchant order created`, `ID: ${orderId} | Amount: ₹${product.price.toLocaleString('en-IN')}`);
      await sleep(600);

      setStep('authorizing');
      addLog('thinking', 'Calling frame_create_payment_intent via Frame MCP…', `Key: ${idempotencyKey}`);
      await sleep(400);
      addLog('policy', 'Policy Firewall evaluating transaction…', `Merchant: TechSupply Store | Category: ${product.category}`);
      await sleep(300);

      const res = await fetch(`${baseUrl}/v1/payment-intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey.trim() },
        body: JSON.stringify({
          amount_paise: product.price * 100,
          currency: 'INR',
          merchant: 'TechSupply Store',
          merchant_reference: orderId,
          purpose: product.name,
          category: product.category,
          idempotency_key: idempotencyKey,
          metadata: { agent: 'Frame Shopping Agent v1.0', product_id: product.id, demo: true },
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
        decision, status: intent.status,
        payment_intent_id: intent.id,
        amount: intent.amount_paise / 100,
        merchant: intent.merchant,
        next_action: 'UNKNOWN',
        reasons,
      };

      if (decision === 'DENY' || intent.status === 'DENIED') {
        payResult.next_action = 'DO_NOT_RETRY';
        addLog('policy', `🛡️ Firewall Decision: DENY`, reasons.join(' • ') || 'Policy violation');
        addLog('warning', 'Transaction blocked by Frame Policy Firewall', `Intent: ${intent.id}`);
        addLog('info', 'Agent halting — DO_NOT_RETRY enforced');
      } else if (decision === 'REQUIRE_APPROVAL' || intent.status === 'PENDING_APPROVAL') {
        payResult.next_action = 'WAIT_FOR_APPROVAL';
        addLog('policy', `🛡️ Firewall Decision: REQUIRE_APPROVAL`, reasons.join(' • ') || 'Above approval threshold');
        addLog('warning', 'Human approval required', `Intent: ${intent.id}`);
        addLog('info', 'Calling frame_request_approval — notifying human principals…');
        await sleep(800);
        await fetch(`${baseUrl}/v1/payment-intents/${intent.id}/request-approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey.trim() },
          body: JSON.stringify({ notes: `Agent demo purchase for ${product.name}. Order: ${orderId}` }),
        }).catch(() => null);
        addLog('success', 'Approval request sent to human principal', 'Check Dashboard → Approvals');
      } else {
        payResult.next_action = 'PAYMENT_EXECUTION';
        addLog('policy', `🛡️ Firewall Decision: ALLOW`, 'Within authorized parameters');
        addLog('action', 'Payment intent authorized — executing…', `Intent: ${intent.id}`);
        await sleep(700);

        const statusRes = await fetch(`${baseUrl}/v1/payment-intents/${intent.id}`, { headers: { 'X-API-Key': apiKey.trim() } });
        const statusBody = await statusRes.json().catch(() => ({}));
        const latestStatus = statusBody?.data?.status || intent.status;
        payResult.status = latestStatus;

        if (['SUCCEEDED', 'COMPLETED', 'SETTLED', 'AUTHORIZED', 'EXECUTING', 'PROCESSING'].includes(latestStatus)) {
          payResult.next_action = 'NONE';
          addLog('success', `Payment executed! 🎉`, `Status: ${latestStatus} | ₹${product.price.toLocaleString('en-IN')}`);
          addLog('action', 'Notifying merchant to fulfill order…', `Order: ${orderId}`);
          await sleep(500);
          addLog('success', 'Order confirmed for fulfillment. Agent task complete.');
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

  function reset() { setLogs([]); setResult(null); setStep('idle'); setSelectedProduct(null); }

  const decisionColor: Record<string, string> = { ALLOW: 'text-emerald-400', DENY: 'text-red-400', REQUIRE_APPROVAL: 'text-amber-400', UNKNOWN: 'text-slate-400' };
  const STEP_LABELS: Record<string, { label: string; color: string }> = {
    idle: { label: 'Ready', color: 'text-slate-400' },
    searching: { label: 'Searching Catalog…', color: 'text-blue-400' },
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
          <h1 className="text-xl font-semibold">Frame AI Shopping Agent</h1>
          <span className="ml-2 text-xs mono px-2 py-0.5 rounded-full" style={{ background:'rgba(124,58,237,0.2)', color:'#a78bfa', border:'1px solid rgba(124,58,237,0.3)' }}>LIVE DEMO</span>
        </div>
        <p className="text-sm ml-11" style={{ color:'#64748b' }}>Autonomous agent that browses, orders, and pays &mdash; governed by Frame&apos;s Policy Firewall in real-time.</p>
      </div>

      <div className="max-w-6xl mx-auto mt-6 grid gap-6" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
        {/* Left panel */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* API Key */}
          <div className="rounded-xl p-4" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.6)' }}>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color:'#cbd5e1' }}>🔑 Agent API Key</h2>
            <input
              type="text"
              placeholder="frm_test_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-xs mono"
              style={{ background:'#020617', border:'1px solid #334155', color:'#e2e8f0', outline:'none' }}
            />
            <p className="text-xs mt-2" style={{ color:'#475569' }}>Agents → select agent → Generate API Key</p>
          </div>

          {/* Products */}
          <div className="rounded-xl p-4" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.6)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color:'#cbd5e1' }}>🛒 Product Catalog</h2>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => !running && setSelectedProduct(p)}
                  disabled={running}
                  style={{
                    width:'100%', textAlign:'left', borderRadius:8, padding:'10px 12px',
                    border: selectedProduct?.id === p.id ? '1px solid #7c3aed' : '1px solid #1e293b',
                    background: selectedProduct?.id === p.id ? 'rgba(124,58,237,0.1)' : 'rgba(2,6,23,0.5)',
                    cursor: running ? 'not-allowed' : 'pointer',
                    opacity: running ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                    <span style={{ fontSize:18, marginTop:2 }}>{p.emoji}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="text-xs font-medium" style={{ color:'#e2e8f0', lineHeight:1.3 }}>{p.name}</div>
                      <div className="text-xs" style={{ color:'#475569', marginTop:2, lineHeight:1.3 }}>{p.description}</div>
                      <div style={{ marginTop:6, display:'flex', gap:6, alignItems:'center' }}>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${RISK_BADGE[p.risk]}`}>
                          {p.risk === 'safe' ? '✓ Safe' : p.risk === 'elevated' ? '⚡ Elevated' : '⛔ Blocked'}
                        </span>
                        <span className="text-xs" style={{ color:'#475569' }}>{p.category}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Run */}
          <button
            onClick={step === 'done' ? reset : runAgent}
            disabled={running || (!selectedProduct && step === 'idle')}
            style={{
              width:'100%', padding:'12px', borderRadius:12, fontWeight:600, fontSize:14,
              border: 'none', cursor: running || (!selectedProduct && step === 'idle') ? 'not-allowed' : 'pointer',
              background: step === 'done'
                ? '#334155'
                : running ? 'rgba(109,40,217,0.4)'
                : selectedProduct ? 'linear-gradient(135deg,#7c3aed,#4338ca)'
                : '#1e293b',
              color: selectedProduct || step === 'done' ? '#fff' : '#64748b',
              transition: 'all 0.2s',
              boxShadow: selectedProduct && !running && step !== 'done' ? '0 4px 24px rgba(124,58,237,0.3)' : 'none',
            }}
          >
            {step === 'done' ? '↩ Run Again' : running ? STEP_LABELS[step].label : selectedProduct ? `🚀 Run Agent: Buy ${selectedProduct.emoji}` : 'Select a product first'}
          </button>

          {/* Status */}
          <div className="rounded-xl p-3 flex items-center gap-3" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.6)' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background: running ? '#8b5cf6' : step === 'done' ? '#10b981' : '#475569', animation: running ? 'pulse 1s infinite' : 'none' }} />
            <div>
              <div className={`text-xs font-semibold ${STEP_LABELS[step].color}`}>{STEP_LABELS[step].label}</div>
              <div className="text-xs" style={{ color:'#475569', marginTop:2 }}>Frame AI Agent</div>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Terminal */}
          <div className="rounded-xl flex flex-col" style={{ border:'1px solid #1e293b', background:'#03030d', minHeight:440, maxHeight:520 }}>
            <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom:'1px solid #1e293b' }}>
              <div style={{ display:'flex', gap:6 }}>
                <div style={{ width:12, height:12, borderRadius:'50%', background:'rgba(239,68,68,0.6)' }} />
                <div style={{ width:12, height:12, borderRadius:'50%', background:'rgba(245,158,11,0.6)' }} />
                <div style={{ width:12, height:12, borderRadius:'50%', background:'rgba(16,185,129,0.6)' }} />
              </div>
              <span className="text-xs mono ml-2" style={{ color:'#475569' }}>frame-agent v1.0 — agent_terminal</span>
              <div className="ml-auto flex items-center gap-2">
                {running && <div style={{ width:6, height:6, borderRadius:'50%', background:'#8b5cf6' }} />}
                <span className="text-xs" style={{ color:'#334155' }}>{logs.length} events</span>
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:16 }}>
              {logs.length === 0 ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%' }}>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:40, marginBottom:12 }}>🤖</div>
                    <div style={{ color:'#475569', fontSize:14 }}>Select a product and click Run Agent</div>
                    <div style={{ color:'#1e293b', fontSize:12, marginTop:4 }}>The agent will autonomously browse, checkout, and pay using Frame</div>
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {logs.map((log) => (
                    <div key={log.id} style={{ display:'flex', gap:8 }}>
                      <span className="text-xs mono" style={{ color:'#334155', flexShrink:0, width:58, marginTop:2 }}>{log.timestamp}</span>
                      <span style={{ flexShrink:0, marginTop:2 }}>{LOG_ICON[log.type]}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <span className={`text-xs font-medium ${LOG_COLOR[log.type]}`}>{log.message}</span>
                        {log.detail && <div className="text-xs mono" style={{ color:'#475569', marginTop:2 }}>{log.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Result Card */}
          {result && (
            <div className="rounded-xl p-5" style={{
              border: result.decision === 'ALLOW' ? '1px solid rgba(16,185,129,0.3)' : result.decision === 'DENY' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(245,158,11,0.3)',
              background: result.decision === 'ALLOW' ? 'rgba(16,185,129,0.05)' : result.decision === 'DENY' ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.05)',
            }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:18 }}>{result.decision === 'ALLOW' ? '✅' : result.decision === 'DENY' ? '🛡️' : '⏳'}</span>
                  <span style={{ fontWeight:600, fontSize:14, color:'#f1f5f9' }}>
                    {result.decision === 'ALLOW' ? 'Payment Authorized & Executed' : result.decision === 'DENY' ? 'Blocked by Policy Firewall' : 'Awaiting Human Approval'}
                  </span>
                </div>
                <span className={`text-sm font-bold mono ${decisionColor[result.decision] || 'text-slate-400'}`}>{result.decision}</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {([['Intent ID', result.payment_intent_id], ['Status', result.status], ['Merchant', result.merchant], ['Amount', `₹${result.amount?.toLocaleString('en-IN')}`], ['Next Action', result.next_action], ['Firewall', result.decision]] as [string, string][]).map(([label, val]) => (
                  <div key={label} className="rounded-lg px-3 py-2" style={{ background:'rgba(0,0,0,0.3)' }}>
                    <div className="text-xs" style={{ color:'#64748b', marginBottom:2 }}>{label}</div>
                    <div className="text-xs mono truncate" style={{ color:'#e2e8f0' }}>{val}</div>
                  </div>
                ))}
              </div>
              {result.reasons && result.reasons.length > 0 && (
                <div className="rounded-lg px-3 py-2 mt-3" style={{ background:'rgba(0,0,0,0.2)' }}>
                  <div className="text-xs mb-1" style={{ color:'#64748b' }}>Policy Reasons</div>
                  {result.reasons.map((r, i) => (
                    <div key={i} className="text-xs" style={{ color:'#fbbf24', display:'flex', gap:6 }}><span>•</span><span>{r}</span></div>
                  ))}
                </div>
              )}
              {result.decision === 'REQUIRE_APPROVAL' && (
                <div className="rounded-lg p-3 mt-3 text-xs" style={{ background:'rgba(180,130,0,0.1)', border:'1px solid rgba(245,158,11,0.2)', color:'#fcd34d' }}>
                  💡 Go to <strong>Dashboard → Approvals</strong> to approve or reject this transaction as a human principal.
                </div>
              )}
            </div>
          )}

          {/* How It Works */}
          {step === 'idle' && (
            <div className="rounded-xl p-4" style={{ border:'1px solid #1e293b', background:'rgba(15,23,42,0.4)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color:'#cbd5e1' }}>How this Agent works</h3>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  { icon:'🔍', title:'Search', desc:'Queries product catalog using Frame SDK tools' },
                  { icon:'🛒', title:'Checkout', desc:'Creates merchant order and extracts checkout amount' },
                  { icon:'🛡️', title:'Policy Check', desc:'Frame Firewall evaluates category, limits, and budget rules' },
                  { icon:'💳', title:'Execute', desc:'ALLOW executes. DENY halts. REQUIRE_APPROVAL sends for human review.' },
                ].map((item) => (
                  <div key={item.title} className="rounded-lg p-3" style={{ background:'rgba(2,6,23,0.5)', border:'1px solid #1e293b' }}>
                    <div style={{ fontSize:20, marginBottom:4 }}>{item.icon}</div>
                    <div className="text-xs font-semibold" style={{ color:'#cbd5e1' }}>{item.title}</div>
                    <div className="text-xs" style={{ color:'#475569', marginTop:2 }}>{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
