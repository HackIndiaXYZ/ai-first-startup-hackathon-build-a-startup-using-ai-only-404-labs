'use client';

import { useEffect, useState } from 'react';
import { intentsApi, PaymentIntent } from '@/lib/api';
import { formatRupees, getStatusBadge, timeAgo } from '@/lib/utils';

export default function PaymentsPage() {
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = () => {
    setLoading(true);
    intentsApi.list({ status: statusFilter || undefined, per_page: 50 })
      .then(r => setIntents(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const statuses = ['', 'SUCCEEDED', 'DENIED', 'PENDING_APPROVAL', 'EXECUTING', 'FAILED', 'REJECTED'];

  return (
    <div className="p-6 space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold">Payment Intents</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          All agent payment requests and their firewall decisions
        </p>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {statuses.map(s => (
          <button key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
            style={{
              background: statusFilter === s ? 'var(--accent-glow)' : 'var(--bg-card)',
              color: statusFilter === s ? 'var(--accent)' : 'var(--text-secondary)',
              border: `1px solid ${statusFilter === s ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
            }}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Intent ID</th>
              <th>Agent</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Decision</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="h-4 rounded animate-pulse" style={{ background: 'var(--bg-card)' }} /></td></tr>
              ))
            ) : intents.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                No payment intents{statusFilter ? ` with status ${statusFilter}` : ''}
              </td></tr>
            ) : intents.map(pi => (
              <tr key={pi.id}>
                <td>
                  <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {pi.id.slice(0, 12)}...
                  </code>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{pi.agent_name || '—'}</td>
                <td className="font-medium">{pi.merchant}</td>
                <td className="font-mono text-sm">{formatRupees(pi.amount_paise)}</td>
                <td><span className={`badge ${getStatusBadge(pi.status)}`}>{pi.status}</span></td>
                <td>
                  {pi.decision ? (
                    <span className={`badge ${getStatusBadge(pi.decision)}`}>{pi.decision}</span>
                  ) : '—'}
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{timeAgo(pi.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
