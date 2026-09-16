'use client';

import { useEffect, useState } from 'react';
import { authoritiesApi, agentsApi, PaymentAuthority, Agent } from '@/lib/api';
import { formatRupees, timeAgo } from '@/lib/utils';
import { Plus, ShieldCheck, AlertTriangle, Play, Pause, Ban, CheckCircle, Clock } from 'lucide-react';

export default function PaymentAuthoritiesPage() {
  const [authorities, setAuthorities] = useState<PaymentAuthority[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [selectedAuthority, setSelectedAuthority] = useState<PaymentAuthority | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [form, setForm] = useState({
    agent_id: '',
    purpose: '',
    rail: 'upi_autopay',
    provider: 'razorpay',
    max_amount_per_tx: '',
    daily_limit: '',
    monthly_limit: '',
    approval_threshold: '',
    allowed_categories: 'electronics, office, peripherals',
    blocked_categories: 'gambling, crypto',
    allowed_merchants: 'demo_store, TechSupply Store, Cloud Services Inc',
    valid_days: '30',
  });

  const load = async () => {
    try {
      const [authRes, agentRes] = await Promise.all([
        authoritiesApi.list(),
        agentsApi.list(),
      ]);
      setAuthorities(authRes.data || []);
      setAgents(agentRes.data || []);
    } catch (err: unknown) {
      console.error('Failed to load authorities:', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');

    try {
      const validUntil = new Date(Date.now() + parseInt(form.valid_days) * 24 * 3600 * 1000).toISOString();
      const body: Record<string, unknown> = {
        agent_id: form.agent_id,
        purpose: form.purpose,
        rail: form.rail,
        provider: form.provider,
        max_amount_per_tx_paise: parseInt(form.max_amount_per_tx) * 100,
        daily_limit_paise: parseInt(form.daily_limit) * 100,
        monthly_limit_paise: parseInt(form.monthly_limit) * 100,
        valid_until: validUntil,
      };

      if (form.approval_threshold) {
        body.approval_threshold_paise = parseInt(form.approval_threshold) * 100;
      }
      if (form.allowed_categories) {
        body.allowed_categories = form.allowed_categories.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (form.blocked_categories) {
        body.blocked_categories = form.blocked_categories.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (form.allowed_merchants) {
        body.allowed_merchants = form.allowed_merchants.split(',').map((s) => s.trim()).filter(Boolean);
      }

      await authoritiesApi.create(body);
      setShowCreate(false);
      load();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to grant delegated payment authority');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to REVOKE this payment authority? The agent will instantly lose ability to spend.')) {
      return;
    }
    setActionLoading(true);
    try {
      await authoritiesApi.revoke(id, 'Admin manual revocation from dashboard');
      load();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async (id: string) => {
    setActionLoading(true);
    try {
      await authoritiesApi.suspend(id, 'Admin temporary suspension');
      load();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async (id: string) => {
    setActionLoading(true);
    try {
      await authoritiesApi.resume(id);
      load();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: PaymentAuthority['status']) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="badge flex items-center gap-1.5" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            ACTIVE
          </span>
        );
      case 'SUSPENDED':
        return (
          <span className="badge flex items-center gap-1.5" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            SUSPENDED
          </span>
        );
      case 'REVOKED':
        return (
          <span className="badge flex items-center gap-1.5" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            REVOKED
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="badge flex items-center gap-1.5" style={{ background: 'rgba(156,163,175,0.15)', color: '#9ca3af', border: '1px solid rgba(156,163,175,0.3)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            EXPIRED
          </span>
        );
    }
  };

  return (
    <div className="p-6 space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Payment Authorities</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              Delegated Authorization MVP
            </span>
          </div>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Legitimate delegated spend mandates and bounds granted by users to autonomous AI agents
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Grant Authority
        </button>
      </div>

      {/* Authorities Grid / Cards */}
      {loading ? (
        <div className="p-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading delegated authorities...</div>
      ) : authorities.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <ShieldCheck size={40} className="mx-auto" style={{ color: 'var(--text-muted)' }} />
          <h3 className="font-semibold text-lg">No Payment Authorities Granted</h3>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Delegated authorities provide cryptographic financial bounds for autonomous agent checkout without exposing sensitive credentials or bypassing MFA.
          </p>
          <button className="btn-primary mt-2" onClick={() => setShowCreate(true)}>
            Grant First Authority
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {authorities.map((auth) => {
            const agentName = agents.find((a) => a.id === auth.agent_id)?.name || auth.agent_name || auth.agent_id;
            const dailyPct = Math.min(100, Math.round((auth.spent_today_paise / auth.daily_limit_paise) * 100));
            const monthlyPct = Math.min(100, Math.round((auth.spent_this_month_paise / auth.monthly_limit_paise) * 100));

            return (
              <div key={auth.id} className="card p-5 space-y-4 hover:border-indigo-500/30 transition-all">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base">{auth.purpose || 'Delegated Authority'}</span>
                      {getStatusBadge(auth.status)}
                    </div>
                    <div className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                      <span>Agent: <strong style={{ color: 'var(--text-primary)' }}>{agentName}</strong></span>
                      <span>•</span>
                      <span>Rail: <strong style={{ color: 'var(--text-primary)' }}>{auth.rail}</strong></span>
                    </div>
                  </div>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {auth.id.slice(-8)}
                  </span>
                </div>

                {/* Spend Bars */}
                <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>Daily Spend: {formatRupees(auth.spent_today_paise)} / {formatRupees(auth.daily_limit_paise)}</span>
                      <span className="font-medium">{dailyPct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${dailyPct}%`,
                          background: dailyPct > 80 ? '#ef4444' : dailyPct > 50 ? '#f59e0b' : 'var(--accent)',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>Monthly Spend: {formatRupees(auth.spent_this_month_paise)} / {formatRupees(auth.monthly_limit_paise)}</span>
                      <span className="font-medium">{monthlyPct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${monthlyPct}%`,
                          background: monthlyPct > 80 ? '#ef4444' : monthlyPct > 50 ? '#f59e0b' : 'var(--accent)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Bounds & Constraints */}
                <div className="grid grid-cols-2 gap-2 text-xs py-2 px-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Max Tx:</span>{' '}
                    <strong>{formatRupees(auth.max_transaction_amount_paise)}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Approval Above:</span>{' '}
                    <strong>{auth.requires_approval_above_paise ? formatRupees(auth.requires_approval_above_paise) : 'None'}</strong>
                  </div>
                  <div className="col-span-2 truncate">
                    <span style={{ color: 'var(--text-muted)' }}>Categories:</span>{' '}
                    <span>{auth.allowed_categories?.join(', ') || 'All Allowed'}</span>
                  </div>
                </div>

                {/* Validity */}
                <div className="flex items-center justify-between text-xs pt-2" style={{ color: 'var(--text-muted)' }}>
                  <div className="flex items-center gap-1">
                    <Clock size={13} />
                    <span>Expires {new Date(auth.valid_until).toLocaleDateString()}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {auth.status === 'ACTIVE' && (
                      <button
                        onClick={() => handleSuspend(auth.id)}
                        disabled={actionLoading}
                        className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 text-amber-400 hover:text-amber-300"
                        title="Suspend spending temporarily"
                      >
                        <Pause size={12} /> Suspend
                      </button>
                    )}
                    {auth.status === 'SUSPENDED' && (
                      <button
                        onClick={() => handleResume(auth.id)}
                        disabled={actionLoading}
                        className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                        title="Resume authority"
                      >
                        <Play size={12} /> Resume
                      </button>
                    )}
                    {(auth.status === 'ACTIVE' || auth.status === 'SUSPENDED') && (
                      <button
                        onClick={() => handleRevoke(auth.id)}
                        disabled={actionLoading}
                        className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 text-red-400 hover:text-red-300"
                        title="Revoke authority immediately"
                      >
                        <Ban size={12} /> Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Grant Authority Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.75)' }}
        >
          <div className="card w-full max-w-xl p-6 animate-in my-8 space-y-4">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h2 className="text-lg font-semibold">Grant Delegated Payment Authority</h2>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Define strictly-bounded spend mandate for an autonomous AI agent
                </p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="text-gray-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg text-xs flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                <AlertTriangle size={14} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="input-label">Select Agent *</label>
                <select
                  className="input"
                  value={form.agent_id}
                  onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
                  required
                >
                  <option value="">Select an agent</option>
                  {agents
                    .filter((a) => a.status === 'active')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.purpose || 'Autonomous Agent'})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Authority Purpose *</label>
                  <input
                    className="input"
                    value={form.purpose}
                    onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                    placeholder="e.g. IT & Cloud Procurement"
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Payment Rail *</label>
                  <select
                    className="input"
                    value={form.rail}
                    onChange={(e) => setForm((f) => ({ ...f, rail: e.target.value }))}
                  >
                    <option value="upi_autopay">UPI AutoPay (e-Mandate)</option>
                    <option value="card_mandate">Card Mandate (Recurring / Pre-auth)</option>
                    <option value="pre_auth">Pre-Authorization (Hold & Capture)</option>
                    <option value="upi">Direct UPI (Standard)</option>
                    <option value="card">Credit/Debit Card</option>
                  </select>
                </div>
              </div>

              <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>
                  Financial Limits (in ₹)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">Max Per Transaction (₹) *</label>
                    <input
                      className="input"
                      type="number"
                      value={form.max_amount_per_tx}
                      onChange={(e) => setForm((f) => ({ ...f, max_amount_per_tx: e.target.value }))}
                      placeholder="5000"
                      required
                    />
                  </div>
                  <div>
                    <label className="input-label">Approval Threshold (₹)</label>
                    <input
                      className="input"
                      type="number"
                      value={form.approval_threshold}
                      onChange={(e) => setForm((f) => ({ ...f, approval_threshold: e.target.value }))}
                      placeholder="3000 (Requires human review)"
                    />
                  </div>
                  <div>
                    <label className="input-label">Daily Spend Limit (₹) *</label>
                    <input
                      className="input"
                      type="number"
                      value={form.daily_limit}
                      onChange={(e) => setForm((f) => ({ ...f, daily_limit: e.target.value }))}
                      placeholder="15000"
                      required
                    />
                  </div>
                  <div>
                    <label className="input-label">Monthly Spend Limit (₹) *</label>
                    <input
                      className="input"
                      type="number"
                      value={form.monthly_limit}
                      onChange={(e) => setForm((f) => ({ ...f, monthly_limit: e.target.value }))}
                      placeholder="50000"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-3 space-y-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Scope Controls & Expiration
                </p>
                <div>
                  <label className="input-label">Allowed Categories (comma-separated)</label>
                  <input
                    className="input"
                    value={form.allowed_categories}
                    onChange={(e) => setForm((f) => ({ ...f, allowed_categories: e.target.value }))}
                    placeholder="electronics, office, cloud"
                  />
                </div>
                <div>
                  <label className="input-label">Allowed Merchants (comma-separated)</label>
                  <input
                    className="input"
                    value={form.allowed_merchants}
                    onChange={(e) => setForm((f) => ({ ...f, allowed_merchants: e.target.value }))}
                    placeholder="demo_store, TechSupply, AWS"
                  />
                </div>
                <div>
                  <label className="input-label">Validity (Days)</label>
                  <input
                    className="input"
                    type="number"
                    value={form.valid_days}
                    onChange={(e) => setForm((f) => ({ ...f, valid_days: e.target.value }))}
                    placeholder="30"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-primary"
                >
                  {creating ? 'Granting...' : 'Grant Authority'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
