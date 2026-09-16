'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { agentsApi, Agent, Credential } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  Bot, Plus, Key, RefreshCw, Ban, Eye, Copy, Check, AlertTriangle, ShieldCheck, Terminal, ArrowRight, ExternalLink
} from 'lucide-react';

export default function DevelopersPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDesc, setNewAgentDesc] = useState('');
  const [newAgentPurpose, setNewAgentPurpose] = useState('');
  const [creating, setCreating] = useState(false);

  // One-time Key Display Modal
  const [revealedKey, setRevealedKey] = useState<{ agentName: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Rotate Key State
  const [rotatingAgentId, setRotatingAgentId] = useState<string | null>(null);

  // Revoke Agent State
  const [revokingAgent, setRevokingAgent] = useState<Agent | null>(null);

  // View Agent Credentials
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(false);

  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await agentsApi.list();
      setAgents(res.data || []);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;
    setCreating(true);
    try {
      // 1. Create agent
      const agentRes = await agentsApi.create({
        name: newAgentName.trim(),
        description: newAgentDesc.trim() || undefined,
        purpose: newAgentPurpose.trim() || undefined,
      });
      const agent = agentRes.data;

      // 2. Automatically generate initial API key
      const credRes = await agentsApi.createCredential(agent.id);
      const cred = credRes.data;

      setShowCreateModal(false);
      setNewAgentName('');
      setNewAgentDesc('');
      setNewAgentPurpose('');
      await loadAgents();

      // 3. Show raw key ONCE
      if (cred.api_key) {
        setRevealedKey({ agentName: agent.name, key: cred.api_key });
      }
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to create agent');
    } finally {
      setCreating(false);
    }
  };

  const handleRotateKey = async (agent: Agent) => {
    if (!confirm(`Are you sure you want to rotate the API key for "${agent.name}"? Any active integrations using the old key will be disconnected immediately.`)) {
      return;
    }
    setRotatingAgentId(agent.id);
    try {
      const res = await agentsApi.rotateCredential(agent.id);
      const cred = res.data;
      await loadAgents();
      if (cred.api_key) {
        setRevealedKey({ agentName: agent.name, key: cred.api_key });
      }
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to rotate API key');
    } finally {
      setRotatingAgentId(null);
    }
  };

  const handleRevokeAgent = async () => {
    if (!revokingAgent) return;
    try {
      await agentsApi.revoke(revokingAgent.id, 'Revoked by administrator via developer console');
      setRevokingAgent(null);
      await loadAgents();
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to revoke agent');
    }
  };

  const handleViewCredentials = async (agent: Agent) => {
    setViewingAgent(agent);
    setLoadingCreds(true);
    try {
      const res = await agentsApi.listCredentials(agent.id);
      setCredentials(res.data || []);
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to fetch credentials');
    } finally {
      setLoadingCreds(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Developer & Agent Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Provision first-class AI agent identities, issue cryptographically hashed API keys, and connect Frame MCP.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/developers/mcp"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-sm font-medium transition"
          >
            <Terminal size={16} />
            <span>MCP Setup Guide</span>
            <ExternalLink size={14} className="opacity-60" />
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm transition"
            style={{ background: 'var(--accent)' }}
          >
            <Plus size={16} />
            <span>Register New Agent</span>
          </button>
        </div>
      </div>

      {/* Security Architecture Callout */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
        <ShieldCheck size={20} className="text-indigo-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-foreground">Zero-Trust Agent Credentials</p>
          <p className="text-muted-foreground leading-relaxed">
            API keys follow the <code className="text-foreground">frm_test_*</code> / <code className="text-foreground">frm_live_*</code> standard and are hashed using bcrypt with salt rounds on write. Raw API keys are displayed <strong>ONLY ONCE</strong> upon generation and are never stored or retrievable via GET APIs.
          </p>
        </div>
      </div>

      {/* Agents Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-muted-foreground" />
            <span className="font-medium text-sm">Registered AI Agents ({agents.length})</span>
          </div>
          <button onClick={loadAgents} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition">
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading registered agents...</div>
        ) : error ? (
          <div className="p-12 text-center text-red-400 text-sm">{error}</div>
        ) : agents.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Bot size={36} className="mx-auto text-muted-foreground opacity-40" />
            <p className="text-sm font-medium">No agents registered yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Create your first AI agent identity to grant delegated spend authorities and generate an MCP API key.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition"
              style={{ background: 'var(--accent)' }}
            >
              <Plus size={14} />
              <span>Create Agent</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/40 text-xs font-semibold text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-6 py-3">Agent Identity</th>
                  <th className="px-6 py-3">Agent ID</th>
                  <th className="px-6 py-3">Environment</th>
                  <th className="px-6 py-3">API Key Status</th>
                  <th className="px-6 py-3">Last Active</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-secondary/20 transition">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">{agent.name}</div>
                      {agent.purpose && (
                        <div className="text-xs text-muted-foreground truncate max-w-xs">{agent.purpose}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                      {agent.id}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${
                        agent.frame_env === 'production' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                      }`}>
                        {agent.frame_env}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs">
                      {Number(agent.credential_count || 0) > 0 ? (
                        <span className="text-emerald-400 font-mono">Active Key Issued</span>
                      ) : (
                        <span className="text-amber-400">No Key Issued</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {agent.last_used_at ? formatDate(agent.last_used_at) : 'Never'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase ${
                        agent.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : agent.status === 'revoked'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                      }`}>
                        {agent.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewCredentials(agent)}
                          title="View Credentials"
                          className="p-1.5 rounded-lg border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition"
                        >
                          <Eye size={14} />
                        </button>
                        {agent.status === 'active' && (
                          <>
                            <button
                              onClick={() => handleRotateKey(agent)}
                              disabled={rotatingAgentId === agent.id}
                              title="Rotate API Key"
                              className="p-1.5 rounded-lg border border-border hover:bg-secondary text-amber-400 hover:text-amber-300 transition disabled:opacity-50"
                            >
                              <RefreshCw size={14} className={rotatingAgentId === agent.id ? 'animate-spin' : ''} />
                            </button>
                            <button
                              onClick={() => setRevokingAgent(agent)}
                              title="Revoke Agent"
                              className="p-1.5 rounded-lg border border-border hover:bg-red-500/10 text-red-400 hover:text-red-300 transition"
                            >
                              <Ban size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── CREATE AGENT MODAL ───────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                <Bot size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-base">Register AI Agent</h3>
                <p className="text-xs text-muted-foreground">Creates agent identity and issues an MCP API key.</p>
              </div>
            </div>

            <form onSubmit={handleCreateAgent} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Agent Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Claude Desktop Hardware Buyer"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/40 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Purpose / Mission</label>
                <input
                  type="text"
                  placeholder="e.g. Autonomous procurement for developer team"
                  value={newAgentPurpose}
                  onChange={(e) => setNewAgentPurpose(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/40 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Additional context about this agent..."
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/40 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="p-3 rounded-lg border border-border bg-secondary/20 text-xs text-muted-foreground">
                <p>⚠️ An API key (<code className="text-foreground">frm_test_*</code>) will be generated and shown exactly once.</p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newAgentName.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white transition disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {creating ? 'Registering...' : 'Register & Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ONE-TIME REVEALED API KEY MODAL ──────────── */}
      {revealedKey && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-amber-500/30 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Key size={20} className="text-amber-400" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-foreground">Save Agent API Key</h3>
                <p className="text-xs text-muted-foreground">
                  Credentials for <strong className="text-foreground">{revealedKey.agentName}</strong>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 flex items-start gap-2.5 text-xs text-amber-300/90">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Store this key securely now.</strong> This is the only time the complete secret key will be shown. Frame stores only a salted cryptographic hash.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Frame Agent API Key
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={revealedKey.key}
                  className="w-full font-mono text-xs px-3.5 py-2.5 rounded-lg border border-border bg-black/40 text-emerald-400 select-all focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(revealedKey.key)}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-secondary border border-border hover:bg-secondary/80 text-xs font-medium transition flex-shrink-0"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link
                href="/dashboard/developers/mcp"
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
              >
                <span>View MCP client config</span>
                <ArrowRight size={12} />
              </Link>
              <button
                onClick={() => setRevealedKey(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition"
                style={{ background: 'var(--accent)' }}
              >
                I Have Stored This Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REVOKE AGENT CONFIRMATION MODAL ──────────── */}
      {revokingAgent && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-red-500/30 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <Ban size={22} />
              <h3 className="font-bold text-base text-foreground">Revoke Agent Identity</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to permanently revoke <strong>{revokingAgent.name}</strong>?
              This will instantly revoke all issued API keys and invalidate any active Delegated Payment Authorities granted to this agent.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRevokingAgent(null)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRevokeAgent}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition"
              >
                Revoke Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW AGENT CREDENTIALS DRAWER/MODAL ──────── */}
      {viewingAgent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">{viewingAgent.name}</h3>
                <p className="text-xs font-mono text-muted-foreground">{viewingAgent.id}</p>
              </div>
              <span className="text-xs uppercase px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                {viewingAgent.frame_env}
              </span>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Issued Credentials ({credentials.length})
              </h4>
              {loadingCreds ? (
                <div className="py-6 text-center text-xs text-muted-foreground">Loading credentials...</div>
              ) : credentials.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No credentials found for this agent.</div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {credentials.map((c) => (
                    <div key={c.id} className="p-3 rounded-lg border border-border bg-secondary/30 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-mono font-medium text-foreground">{c.key_prefix}••••••••••••</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Created: {formatDate(c.created_at)}
                          {c.last_used_at && ` • Last used: ${formatDate(c.last_used_at)}`}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                        c.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewingAgent(null)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
