'use client';

import { useEffect, useState } from 'react';
import { txApi, Transaction } from '@/lib/api';
import { formatRupees, getStatusBadge, timeAgo } from '@/lib/utils';

export default function TransactionsPage() {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    txApi.list().then(r => setTxs(r.data)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Payment execution records
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Provider Ref</th>
              <th>Agent</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="h-4 rounded animate-pulse my-1" style={{ background: 'var(--bg-card)' }} /></td></tr>
              ))
            ) : txs.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                No transactions yet — payments will appear here after execution
              </td></tr>
            ) : txs.map(tx => (
              <tr key={tx.id}>
                <td>
                  <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {tx.provider_payment_id?.slice(0, 20) || '—'}
                  </code>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{tx.agent_name || '—'}</td>
                <td className="font-medium">{tx.merchant || '—'}</td>
                <td className="font-mono text-sm">{formatRupees(tx.amount_paise)}</td>
                <td><span className={`badge ${getStatusBadge(tx.status)}`}>{tx.status}</span></td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                    {tx.provider}
                  </span>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{timeAgo(tx.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
