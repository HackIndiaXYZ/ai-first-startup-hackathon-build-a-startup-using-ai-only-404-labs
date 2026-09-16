'use client';

import { useEffect, useState } from 'react';
import { policiesApi, agentsApi, Policy, Agent } from '@/lib/api';
import { formatRupees, timeAgo, getStatusBadge } from '@/lib/utils';
import { Plus, Shield } from 'lucide-react';

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    agent_id: '', name: '',
    transaction_limit_paise: '', daily_limit_paise: '',
    monthly_limit_paise: '', approval_threshold_paise: '',
    merchant_allowlist: '', merchant_blocklist: '',
    max_payments_per_hour: '', max_payments_per_day: '',
  });

  const load = async () => {
    const [pRes, aRes] = await Promise.all([policiesApi.list(), agentsApi.list()]);
    setPolicies(pRes.data); setAgents(aRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setCreating(true); setError('');
    try {
      const body: Record<string, unknown> = { agent_id: form.agent_id, name: form.name };
      if (form.transaction_limit_paise) body.transaction_limit_paise = parseInt(form.transaction_limit_paise) * 100;
      if (form.daily_limit_paise) body.daily_limit_paise = parseInt(form.daily_limit_paise) * 100;
      if (form.monthly_limit_paise) body.monthly_limit_paise = parseInt(form.monthly_limit_paise) * 100;
      if (form.approval_threshold_paise) body.approval_threshold_paise = parseInt(form.approval_threshold_paise) * 100;
      if (form.merchant_allowlist) body.merchant_allowlist = form.merchant_allowlist.split(',').map(s => s.trim()).filter(Boolean);
      if (form.merchant_blocklist) body.merchant_blocklist = form.merchant_blocklist.split(',').map(s => s.trim()).filter(Boolean);
      if (form.max_payments_per_hour) body.max_payments_per_hour = parseInt(form.max_payments_per_hour);
      if (form.max_payments_per_day) body.max_payments_per_day = parseInt(form.max_payments_per_day);
      await policiesApi.create(body as Parameters<typeof policiesApi.create>[0]);
      setShowCreate(false);
      load();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setCreating(false); }
  };

  const Field = ({ label, field, placeholder, type = 'text' }: { label: string; field: keyof typeof form; placeholder: string; type?: string }) => (
    <div>
      <label className="input-label">{label}</label>
      <input className="input" type={type} value={form[field]}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        placeholder={placeholder} />
    </div>
  );

  return (
    <div className="p-6 space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Policies</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Configure payment rules for each agent
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Policy
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="card w-full max-w-xl p-6 animate-in my-8">
            <h2 className="text-lg font-semibold mb-4">Create Policy</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="input-label">Agent *</label>
                <select className="input" value={form.agent_id}
                  onChange={e => setForm(f => ({ ...f, agent_id: e.target.value }))} required>
                  <option value="">Select an agent</option>
                  {agents.filter(a => a.status === 'active').map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <Field label="Policy Name *" field="name" placeholder="Cloud Infrastructure Policy" />

              <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Budget Limits (in ₹)</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Transaction Limit" field="transaction_limit_paise" placeholder="e.g. 10000" type="number" />
                  <Field label="Daily Limit" field="daily_limit_paise" placeholder="e.g. 50000" type="number" />
                  <Field label="Monthly Limit" field="monthly_limit_paise" placeholder="e.g. 200000" type="number" />
                  <Field label="Approval Threshold" field="approval_threshold_paise" placeholder="e.g. 5000" type="number" />
                </div>
              </div>

              <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Merchant Rules (comma-separated)</p>
                <div className="grid grid-cols-1 gap-4">
                  <Field label="Merchant Allowlist" field="merchant_allowlist" placeholder="AWS, GCP, Cloudflare" />
                  <Field label="Merchant Blocklist" field="merchant_blocklist" placeholder="Nike, Amazon Shopping" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <Field label="Max Payments/Hour" field="max_payments_per_hour" placeholder="e.g. 10" type="number" />
                <Field label="Max Payments/Day" field="max_payments_per_day" placeholder="e.g. 50" type="number" />
              </div>

              {error && <div className="text-sm p-3 rounded-lg" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1 justify-center" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Policy'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}</div>
      ) : policies.length === 0 ? (
        <div className="card p-12 text-center">
          <Shield size={40} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-medium">No policies yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Policies define what agents can and cannot pay for</p>
          <button className="btn-primary mt-4" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create Policy
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {policies.map(p => (
            <div key={p.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    v{p.version_number} · {timeAgo(p.updated_at || p.created_at)}
                  </p>
                </div>
                <span className={`badge ${getStatusBadge(p.status)}`}>{p.status}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {p.transaction_limit_paise && (
                  <div className="rounded-lg p-2" style={{ background: 'var(--bg-secondary)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>Tx Limit</p>
                    <p className="font-mono font-medium">{formatRupees(p.transaction_limit_paise)}</p>
                  </div>
                )}
                {p.daily_limit_paise && (
                  <div className="rounded-lg p-2" style={{ background: 'var(--bg-secondary)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>Daily Limit</p>
                    <p className="font-mono font-medium">{formatRupees(p.daily_limit_paise)}</p>
                  </div>
                )}
                {p.approval_threshold_paise && (
                  <div className="rounded-lg p-2" style={{ background: 'var(--bg-secondary)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>Approval Above</p>
                    <p className="font-mono font-medium">{formatRupees(p.approval_threshold_paise)}</p>
                  </div>
                )}
                {p.merchant_allowlist && p.merchant_allowlist.length > 0 && (
                  <div className="rounded-lg p-2" style={{ background: 'var(--bg-secondary)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>Allowlist</p>
                    <p className="font-medium">{p.merchant_allowlist.slice(0, 3).join(', ')}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
