'use client';

import { useEffect, useState } from 'react';
import { agentsApi, Agent } from '@/lib/api';
import { getStatusBadge, timeAgo } from '@/lib/utils';
import { Plus, Bot, Key, PowerOff, Power, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', owner_team: '', purpose: '' });
  const [error, setError] = useState('');

  const load = () => agentsApi.list().then(r => setAgents(r.data)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setError('');
    try {
      await agentsApi.create(form);
      setShowCreate(false);
      setForm({ name: '', description: '', owner_team: '', purpose: '' });
      load();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setCreating(false); }
  };

  const toggleAgent = async (agent: Agent) => {
    if (agent.status === 'active') {
      await agentsApi.disable(agent.id, 'Manually disabled');
    } else if (agent.status === 'disabled') {
      await agentsApi.enable(agent.id);
    }
    load();
  };

  return (
    <div className="p-6 space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Manage AI agents and their payment credentials
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Agent
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="card w-full max-w-md p-6 animate-in">
            <h2 className="text-lg font-semibold mb-4">Create Agent</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="input-label">Agent Name *</label>
                <input className="input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="DevOps-Agent" required />
              </div>
              <div>
                <label className="input-label">Description</label>
                <textarea className="input" rows={2} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Manages cloud infrastructure payments" />
              </div>
              <div>
                <label className="input-label">Owner / Team</label>
                <input className="input" value={form.owner_team}
                  onChange={e => setForm(f => ({ ...f, owner_team: e.target.value }))}
                  placeholder="Platform Engineering" />
              </div>
              <div>
                <label className="input-label">Purpose</label>
                <input className="input" value={form.purpose}
                  onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                  placeholder="Production infrastructure management" />
              </div>
              {error && <div className="text-sm rounded-lg p-3" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1 justify-center" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Agent'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Agents list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card h-20 animate-pulse" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="card p-12 text-center">
          <Bot size={40} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-medium">No agents yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Create your first agent to get started</p>
          <button className="btn-primary mt-4" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create Agent
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Team</th>
                <th>Status</th>
                <th>Credentials</th>
                <th>Payments</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => (
                <tr key={agent.id}>
                  <td>
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{agent.purpose || '—'}</p>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{agent.owner_team || '—'}</td>
                  <td><span className={`badge ${getStatusBadge(agent.status)}`}>{agent.status}</span></td>
                  <td>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {agent.credential_count || 0} active
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{agent.total_payments || 0}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{timeAgo(agent.created_at)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button className="btn-ghost p-1.5"
                        onClick={() => toggleAgent(agent)}
                        title={agent.status === 'active' ? 'Disable' : 'Enable'}
                        disabled={agent.status === 'revoked'}>
                        {agent.status === 'active' ? <PowerOff size={14} /> : <Power size={14} />}
                      </button>
                      <Link href={`/dashboard/agents/${agent.id}`} className="btn-ghost p-1.5">
                        <ChevronRight size={14} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
