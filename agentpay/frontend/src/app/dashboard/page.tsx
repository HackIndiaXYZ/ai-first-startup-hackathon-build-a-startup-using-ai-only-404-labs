'use client';

import { useEffect, useState } from 'react';
import { overviewApi, intentsApi, Overview, PaymentIntent } from '@/lib/api';
import { formatRupees, formatStatus, timeAgo } from '@/lib/utils';
import { TrendingUp, Bot, Clock, ShieldX, CheckCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recent, setRecent] = useState<PaymentIntent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([overviewApi.get(), intentsApi.list({ per_page: 8 })]).then(([ov, intents]) => {
      setOverview(ov.data);
      setRecent(intents.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSkeleton />;

  const stats = [
    { label: 'Active Agents', value: overview?.active_agents ?? 0, icon: Bot, color: 'var(--accent)' },
    { label: 'Total Spend', value: formatRupees(overview?.total_spend_paise ?? 0), icon: TrendingUp, color: 'var(--success)' },
    { label: 'Today\'s Spend', value: formatRupees(overview?.today_spend_paise ?? 0), icon: TrendingUp, color: 'var(--warning)' },
    { label: 'Pending Approvals', value: overview?.pending_approvals ?? 0, icon: Clock, color: 'var(--warning)', link: '/dashboard/approvals' },
    { label: 'Blocked Payments', value: overview?.blocked_payments ?? 0, icon: ShieldX, color: 'var(--danger)' },
    { label: 'Success Rate', value: `${overview?.payment_success_rate ?? 0}%`, icon: CheckCircle, color: 'var(--success)' },
  ];

  return (
    <div className="p-6 space-y-6 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          What are your agents doing with money?
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map(stat => (
          <div key={stat.label} className={`stat-card ${stat.link ? 'cursor-pointer' : ''}`}
            onClick={() => stat.link && (window.location.href = stat.link)}>
            <div className="flex items-center justify-between">
              <span className="stat-label">{stat.label}</span>
              <stat.icon size={16} style={{ color: stat.color }} />
            </div>
            <div className="stat-value">{stat.value}</div>
            {stat.label === 'Pending Approvals' && (overview?.pending_approvals ?? 0) > 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>Action required →</p>
            )}
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      {overview && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4">Payment Intent Status</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(overview.payment_intents_by_status).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <span className={`badge ${getStatusBadge(status)}`}>{status}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent payment intents */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold">Recent Payment Intents</h2>
          <Link href="/dashboard/payments" className="text-xs" style={{ color: 'var(--accent)' }}>View all →</Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                No payment intents yet. Create an agent and configure a policy to get started.
              </td></tr>
            ) : recent.map(pi => (
              <tr key={pi.id}>
                <td>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {pi.agent_name || pi.agent_id?.slice(0, 8)}
                  </span>
                </td>
                <td className="font-medium">{pi.merchant}</td>
                <td className="font-mono text-sm">{formatRupees(pi.amount_paise)}</td>
                <td><span className={`badge ${getStatusBadge(pi.status)}`}>{pi.status}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{timeAgo(pi.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    SUCCEEDED: 'badge-success', AUTHORIZED: 'badge-success',
    DENIED: 'badge-danger', REJECTED: 'badge-danger', FAILED: 'badge-danger',
    PENDING_APPROVAL: 'badge-warning', EXECUTING: 'badge-warning',
    CREATED: 'badge-neutral', EVALUATING: 'badge-neutral', EXPIRED: 'badge-neutral',
  };
  return map[status] || 'badge-neutral';
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-32 rounded-lg" style={{ background: 'var(--bg-card)' }} />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="stat-card h-20" style={{ background: 'var(--bg-card)' }} />
        ))}
      </div>
    </div>
  );
}
