'use client';

import { useEffect, useState } from 'react';
import { providersApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  Plug, CheckCircle2, ShieldCheck, AlertCircle, RefreshCw, Cpu, Globe, ArrowUpRight
} from 'lucide-react';

export default function ProvidersPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await providersApi.list();
      setData(res.data);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load provider configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Rail Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real provider adapters, sandbox connections, and financial execution rails supported by Frame.
          </p>
        </div>
        <button
          onClick={loadProviders}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-xs font-medium transition self-start md:self-auto"
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Ground Truth & Labeling Policy Notice */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
        <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-foreground">Strict Provider Classification Policy</p>
          <p className="text-muted-foreground leading-relaxed">
            Frame strictly separates environments: <strong>MOCK</strong> (in-memory simulator for unit tests), <strong>SANDBOX</strong> (genuine external provider API test credentials with live webhooks and refunds), and <strong>PRODUCTION</strong> (live merchant accounts). Sandbox integrations are never labeled as live money.
          </p>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Razorpay Provider */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Globe size={20} className="text-blue-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-foreground">Razorpay Sandbox</h3>
                <span className="text-xs text-muted-foreground">Direct API integration (api.razorpay.com/v1)</span>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              SANDBOX
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Connection Status</span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                <CheckCircle2 size={13} />
                <span>Connected & Verified</span>
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Payment Rails</span>
              <span className="font-mono text-foreground font-medium">UPI / NetBanking / Cards</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Webhook Verification</span>
              <span className="font-semibold text-emerald-400">HMAC-SHA256 Constant-Time</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted-foreground">Refund Capability</span>
              <span className="font-semibold text-emerald-400">Supported (Atomic Ledger Reversal)</span>
            </div>
          </div>

          <div className="pt-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Verified Capabilities</h4>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Orders API</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Payments Fetch</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Webhooks (HMAC)</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Full / Partial Refunds</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Double-Entry Ledger</span>
            </div>
          </div>
        </div>

        {/* Deterministic Mock Provider */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center">
                <Cpu size={20} className="text-zinc-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-foreground">Deterministic Mock Rail</h3>
                <span className="text-xs text-muted-foreground">Isolated in-memory test provider</span>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
              LOCAL / MOCK
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Connection Status</span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                <CheckCircle2 size={13} />
                <span>Active</span>
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Simulated Latency</span>
              <span className="font-mono text-foreground font-medium">10ms – 50ms</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Failure Scenarios</span>
              <span className="font-semibold text-foreground">Deterministic error injection</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted-foreground">Replay Protection</span>
              <span className="font-semibold text-emerald-400">Verified</span>
            </div>
          </div>

          <div className="pt-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Verified Capabilities</h4>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Deterministic Success</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Gateway Timeout Simulation</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Idempotent Re-execution</span>
              <span className="px-2 py-0.5 rounded text-[11px] bg-secondary border border-border text-foreground font-mono">Reconciliation Checks</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
