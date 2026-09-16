'use client';

import { useEffect, useState } from 'react';
import { approvalsApi, ApprovalTask } from '@/lib/api';
import { formatRupees, formatDate, getStatusBadge, timeAgo } from '@/lib/utils';
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

export default function ApprovalsPage() {
  const [tasks, setTasks] = useState<ApprovalTask[]>([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ApprovalTask | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    approvalsApi.list(tab).then(r => setTasks(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);

  const handleApprove = async () => {
    if (!selected) return;
    setActing(true); setError('');
    try {
      await approvalsApi.approve(selected.id, comment);
      setSelected(null);
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setActing(false); }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActing(true); setError('');
    try {
      await approvalsApi.reject(selected.id, comment);
      setSelected(null);
      load();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setActing(false); }
  };

  const pendingCount = tab === 'pending' ? tasks.length : 0;

  return (
    <div className="p-6 space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-3">
          Approvals
          {pendingCount > 0 && (
            <span className="text-sm rounded-full px-2 py-0.5" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
              {pendingCount} pending
            </span>
          )}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Human-in-the-loop payment control
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background: 'var(--bg-secondary)' }}>
        {['pending', 'approved', 'rejected', 'expired'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 text-sm font-medium rounded-md transition-all"
            style={{
              background: tab === t ? 'var(--bg-card)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>
            {t}
          </button>
        ))}
      </div>

      {/* Approval detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="card w-full max-w-lg p-6 animate-in">
            {/* Warning header */}
            <div className="flex items-center gap-3 mb-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--warning-bg)' }}>
                <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
              </div>
              <div>
                <h2 className="font-semibold">Approval Required</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Expires {formatDate(selected.expires_at)}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              {[
                ['Agent', selected.agent_name || selected.agent_id],
                ['Merchant', selected.merchant],
                ['Amount', formatRupees(selected.amount_paise || 0)],
                ['Purpose', selected.purpose],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-start gap-4">
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span className="font-medium text-right">{value}</span>
                </div>
              ))}

              {selected.reasons && selected.reasons.length > 0 && (
                <div className="rounded-lg p-3 mt-2" style={{ background: 'var(--warning-bg)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--warning)' }}>Why approval is needed:</p>
                  {selected.reasons.map((r, i) => (
                    <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r}</p>
                  ))}
                </div>
              )}

              <div>
                <label className="input-label">Comment (optional)</label>
                <textarea className="input" rows={2} value={comment}
                  onChange={e => setComment(e.target.value)} placeholder="Add a note..." />
              </div>
            </div>

            {error && <div className="text-sm mt-3 p-2 rounded" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}

            <div className="flex gap-3 mt-5">
              <button className="btn-primary flex-1 justify-center" onClick={handleApprove} disabled={acting}>
                <CheckCircle size={16} /> {acting ? 'Approving...' : 'Approve'}
              </button>
              <button className="btn-danger flex-1 justify-center" onClick={handleReject} disabled={acting}>
                <XCircle size={16} /> {acting ? 'Rejecting...' : 'Reject'}
              </button>
              <button className="btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}</div>
      ) : tasks.length === 0 ? (
        <div className="card p-12 text-center">
          <Clock size={40} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-medium">No {tab} approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="card-hover p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-semibold text-lg">{formatRupees(task.amount_paise || 0)}</span>
                    <span className={`badge ${getStatusBadge(task.status)}`}>{task.status}</span>
                    {task.risk_level && (
                      <span className={`badge ${task.risk_level === 'HIGH_RISK' ? 'badge-danger' : 'badge-warning'}`}>
                        {task.risk_level}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Agent</p>
                      <p>{task.agent_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Merchant</p>
                      <p className="font-medium">{task.merchant || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Purpose</p>
                      <p>{task.purpose || '—'}</p>
                    </div>
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    Requested {timeAgo(task.requested_at)} · Expires {formatDate(task.expires_at)}
                  </p>
                </div>
                {task.status === 'pending' && (
                  <button className="btn-primary flex-shrink-0" onClick={() => { setSelected(task); setComment(''); setError(''); }}>
                    Review
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
