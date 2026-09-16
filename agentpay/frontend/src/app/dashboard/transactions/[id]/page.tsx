'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { txApi } from '@/lib/api';
import { formatPaise, formatDate } from '@/lib/utils';
import {
  ArrowLeft, Receipt, CheckCircle, Clock, AlertTriangle, RotateCcw,
  ShieldCheck, Hash, ExternalLink, RefreshCw, Layers
} from 'lucide-react';

interface LedgerEntry {
  id: string;
  entry_type: string;
  amount_paise: number;
  entry_hash: string;
  recorded_at: string;
}

interface TransactionDetail {
  id: string;
  payment_id?: string;
  status: string;
  payment_status?: string;
  amount_paise: number;
  currency: string;
  merchant?: string;
  purpose?: string;
  agent_name?: string;
  provider?: string;
  rail?: string;
  provider_payment_id?: string;
  reconciliation_status?: string;
  created_at: string;
  settled_at?: string;
  ledger_entries?: LedgerEntry[];
}

export default function TransactionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [tx, setTx] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refund Modal
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundSuccessMessage, setRefundSuccessMessage] = useState<string | null>(null);

  const loadTransaction = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await txApi.get(id);
      setTx(res.data as unknown as TransactionDetail);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load transaction details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransaction();
  }, [id]);

  const handleProcessRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tx) return;
    setRefunding(true);
    try {
      const res = await txApi.refund(tx.id || tx.payment_id || '', refundReason.trim() || undefined);
      setShowRefundModal(false);
      setRefundSuccessMessage(`Refund processed successfully. Ledger entry: ${(res.data?.ledger_entry_id as string) || 'Reversed'}`);
      await loadTransaction();
    } catch (err: unknown) {
      alert((err as Error).message || 'Refund failed');
    } finally {
      setRefunding(false);
    }
  };

  const isRefundable =
    tx &&
    ['succeeded', 'SUCCEEDED', 'settled', 'SETTLED', 'COMPLETED'].includes(tx.status || tx.payment_status || '') &&
    !(tx.ledger_entries || []).some((le: LedgerEntry) => le.entry_type === 'REFUND');

  const isAlreadyRefunded =
    tx && (tx.ledger_entries || []).some((le: LedgerEntry) => le.entry_type === 'REFUND');

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div className="text-sm text-muted-foreground">Loading transaction details...</div>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Link href="/dashboard/transactions" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to Transactions
        </Link>
        <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm">
          {error || 'Transaction not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Top Header */}
      <div>
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-4"
        >
          <ArrowLeft size={14} />
          <span>Back to Transactions</span>
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <Receipt size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">
                  Transaction {tx.merchant ? `— ${tx.merchant}` : ''}
                </h1>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase ${
                  isAlreadyRefunded
                    ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    : ['succeeded', 'SUCCEEDED'].includes(tx.status || tx.payment_status || '')
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                }`}>
                  {isAlreadyRefunded ? 'REFUNDED' : tx.status || tx.payment_status}
                </span>
              </div>
              <p className="text-xs font-mono text-muted-foreground mt-0.5">ID: {tx.id || tx.payment_id}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadTransaction}
              className="p-2 rounded-lg border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            {isRefundable && (
              <button
                onClick={() => setShowRefundModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 text-sm font-medium transition"
              >
                <RotateCcw size={15} />
                <span>Refund Payment</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {refundSuccessMessage && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle size={16} />
          <span>{refundSuccessMessage}</span>
        </div>
      )}

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left 2 Cols: Financial & Execution Parameters */}
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Payment Details</h2>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground block mb-1">Amount</span>
                <span className="text-base font-bold text-foreground">{formatPaise(tx.amount_paise || 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Currency</span>
                <span className="font-semibold text-foreground">{tx.currency || 'INR'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Payee / Merchant</span>
                <span className="font-semibold text-foreground">{tx.merchant || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Initiating Agent</span>
                <span className="font-semibold text-indigo-400">{tx.agent_name || 'Agent'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground block mb-1">Purpose</span>
                <span className="text-foreground">{tx.purpose || '—'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Provider & Settlement Rail</h2>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground block mb-1">Payment Provider</span>
                <span className="font-semibold text-foreground uppercase">{tx.provider || 'razorpay'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Payment Rail</span>
                <span className="font-semibold text-foreground uppercase">{tx.rail || 'upi'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Provider Reference ID</span>
                <span className="font-mono text-muted-foreground">{tx.provider_payment_id || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Reconciliation Status</span>
                <span className="font-semibold text-emerald-400 uppercase">{tx.reconciliation_status || 'reconciled'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Created Date</span>
                <span className="text-muted-foreground">{formatDate(tx.created_at)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Settled Date</span>
                <span className="text-muted-foreground">{tx.settled_at ? formatDate(tx.settled_at) : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Ledger & Cryptographic Proof */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-400" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Ledger Proof</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every settled transaction creates an immutable, SHA-256 hash-chained ledger entry guaranteeing financial integrity.
            </p>

            <div className="space-y-3 pt-2">
              {(tx.ledger_entries || []).map((le: LedgerEntry) => (
                <div key={le.id} className="p-3 rounded-lg border border-border bg-secondary/30 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-bold ${le.entry_type === 'REFUND' ? 'text-purple-400' : 'text-emerald-400'}`}>
                      {le.entry_type}
                    </span>
                    <span className="font-semibold">{formatPaise(le.amount_paise)}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground truncate" title={le.entry_hash}>
                    Hash: {le.entry_hash}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Recorded: {formatDate(le.recorded_at)}
                  </div>
                </div>
              ))}
              {(!tx.ledger_entries || tx.ledger_entries.length === 0) && (
                <div className="text-xs text-muted-foreground">No ledger entries recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── REFUND MODAL ────────────────────────────── */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-purple-500/30 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-purple-400">
              <RotateCcw size={20} />
              <h3 className="font-bold text-base text-foreground">Refund Payment</h3>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              You are issuing a full refund of <strong>{formatPaise(tx.amount_paise)}</strong> to merchant <strong>{tx.merchant}</strong>.
              This calls the payment provider’s refund API and records a cryptographic reversal entry in the ledger.
            </p>

            <form onSubmit={handleProcessRefund} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Reason for Refund</label>
                <input
                  type="text"
                  placeholder="e.g. Order cancelled by user / Duplicate payment"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/40 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(false)}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refunding}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white transition disabled:opacity-50"
                >
                  {refunding ? 'Processing Refund...' : 'Confirm Full Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
