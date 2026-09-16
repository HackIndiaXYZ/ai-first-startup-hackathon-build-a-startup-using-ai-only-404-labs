'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { agentsApi, policiesApi, intentsApi, Agent, Policy, PaymentIntent, Credential } from '@/lib/api';
import { formatRupees, getStatusBadge, timeAgo, formatDate } from '@/lib/utils';
import { Key, Power, PowerOff, Plus, Copy, Check, Eye, EyeOff } from 'lucide-react';

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [agentRes, credsRes, intentsRes, policiesRes] = await Promise.all([
      agentsApi.get(id),
      agentsApi.listCredentials(id),
      intentsApi.list({ agent_id: id, per_page: 10 }),
      policiesApi.list(id),
    ]);
    setAgent(agentRes.data);
    setCreds(credsRes.data);
    setIntents(intentsRes.data);
    setPolicy(policiesRes.data[0] || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const [actionError, setActionError] = useState<string | null>(null);

  const generateKey = async () => {
    setActionError(null);
    try {
      const res = await agentsApi.createCredential(id);
      setNewKey(res.data.api_key || null);
      await load();
    } catch (err: unknown) {
      setActionError((err as Error).message || 'Failed to generate API key');
    }
  };

  const copyKey = () => {
    if (newKey) { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const toggle = async () => {
    if (!agent) return;
    setActionError(null);
    try {
      if (agent.status === 'active') await agentsApi.disable(id, 'Manually disabled');
      else if (agent.status === 'disabled') await agentsApi.enable(id);
      await load();
    } catch (err: unknown) {
      setActionError((err as Error).message || 'Failed to update agent status');
    }
  };

  if (loading) return <div className="p-6"><div className="card h-40 animate-pulse" /></div>;
  if (!agent) return <div className="p-6 text-center">Agent not found</div>;

  return (
    <div className="p-6 space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
            <span className={`badge ${getStatusBadge(agent.status)}`}>{agent.status}</span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{agent.purpose || 'No purpose set'}</p>
          <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>ID: {agent.id}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={toggle} disabled={agent.status === 'revoked'}>
            {agent.status === 'active' ? <><PowerOff size={14} /> Disable</> : <><Power size={14} /> Enable</>}
          </button>
          <button className="btn-primary" onClick={generateKey}>
            <Key size={14} /> Generate API Key
          </button>
        </div>
      </div>

      {/* Error banner */}
      {actionError && (
        <div className="card p-4 text-xs font-medium flex items-center justify-between" style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <span>{actionError}</span>
          <button className="text-xs underline ml-4" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      {/* New API Key */}
      {newKey && (
        <div className="card p-4" style={{ border: '1px solid rgba(34,197,94,0.3)', background: 'var(--success-bg)' }}>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--success)' }}>
            ⚠️ Copy this API key now — it will never be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono px-3 py-2 rounded-lg overflow-x-auto"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
              {newKey}
            </code>
            <button className="btn-secondary p-2" onClick={copyKey}>
              {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
            </button>
          </div>
          <button className="text-xs mt-2" style={{ color: 'var(--text-muted)' }} onClick={() => setNewKey(null)}>
            Dismiss (key is gone after this)
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <span className="stat-label">Team</span>
          <div className="stat-value text-base">{agent.owner_team || '—'}</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Payments</span>
          <div className="stat-value">{agent.total_payments || 0}</div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Spend</span>
          <div className="stat-value">{formatRupees(agent.total_spend_paise || 0)}</div>
        </div>
      </div>

      {/* Policy */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-3">Active Policy</h2>
        {policy ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>Name</span>
              <span className="font-medium">{policy.name}</span>
            </div>
            {policy.transaction_limit_paise && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Transaction Limit</span>
                <span className="font-mono">{formatRupees(policy.transaction_limit_paise)}</span>
              </div>
            )}
            {policy.daily_limit_paise && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Daily Limit</span>
                <span className="font-mono">{formatRupees(policy.daily_limit_paise)}</span>
              </div>
            )}
            {policy.approval_threshold_paise && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Approval Above</span>
                <span className="font-mono">{formatRupees(policy.approval_threshold_paise)}</span>
              </div>
            )}
            {policy.merchant_allowlist && policy.merchant_allowlist.length > 0 && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Allowed Merchants</span>
                <span className="text-xs">{policy.merchant_allowlist.join(', ')}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
            No policy configured. <a href="/dashboard/policies" style={{ color: 'var(--accent)' }}>Create a policy →</a>
          </div>
        )}
      </div>

      {/* Credentials */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-3">API Credentials</h2>
        {creds.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No credentials. Generate one above.</p>
        ) : (
          <div className="space-y-2">
            {creds.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm p-3 rounded-lg"
                style={{ background: 'var(--bg-secondary)' }}>
                <div>
                  <code className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{c.key_prefix}...</code>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                    {c.last_used_at ? `Last used ${timeAgo(c.last_used_at)}` : 'Never used'}
                  </span>
                </div>
                <span className={`badge ${getStatusBadge(c.status)}`}>{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent intents */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold">Recent Payment Intents</h2>
        </div>
        <table className="data-table">
          <thead><tr><th>Merchant</th><th>Amount</th><th>Status</th><th>Decision</th><th>Time</th></tr></thead>
          <tbody>
            {intents.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>No payment intents yet</td></tr>
            ) : intents.map(pi => (
              <tr key={pi.id}>
                <td className="font-medium">{pi.merchant}</td>
                <td className="font-mono text-sm">{formatRupees(pi.amount_paise)}</td>
                <td><span className={`badge ${getStatusBadge(pi.status)}`}>{pi.status}</span></td>
                <td><span className={`badge ${getStatusBadge(pi.decision || '')}`}>{pi.decision || '—'}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{timeAgo(pi.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
