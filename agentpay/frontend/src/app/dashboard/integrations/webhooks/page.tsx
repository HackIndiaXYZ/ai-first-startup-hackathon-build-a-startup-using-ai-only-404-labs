'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { webhooksApi, WebhookEvent } from '@/lib/api';
import { formatDate, formatPaise } from '@/lib/utils';
import {
  Webhook, ShieldCheck, CheckCircle2, XCircle, RefreshCw, Copy, Check, Info, ArrowLeft, ExternalLink
} from 'lucide-react';

export default function WebhooksPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);

  const endpointUrl = 'http://localhost:3001/v1/webhooks/razorpay';

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await webhooksApi.list();
      setEvents(res.data || []);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load webhook events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const copyEndpoint = () => {
    navigator.clipboard.writeText(endpointUrl);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Webhook Management & Ingestion</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor real-time asynchronous payment provider webhook callbacks, signature verification, and deduplication.
          </p>
        </div>
        <button
          onClick={loadEvents}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-xs font-medium transition self-start md:self-auto"
        >
          <RefreshCw size={14} />
          <span>Refresh Events</span>
        </button>
      </div>

      {/* Webhook Endpoint Instructions Card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Webhook size={18} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Webhook Endpoint Configuration</h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Configure this URL in your payment provider dashboard (e.g. Razorpay Settings → Webhooks). Frame verifies every incoming webhook payload against your configured webhook secret using constant-time HMAC-SHA256 signature comparison.
        </p>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Inbound Webhook Callback URL
          </label>
          <div className="flex items-center gap-2 max-w-2xl">
            <input
              type="text"
              readOnly
              value={endpointUrl}
              className="w-full font-mono text-xs px-3.5 py-2.5 rounded-lg border border-border bg-secondary/40 text-foreground select-all focus:outline-none"
            />
            <button
              onClick={copyEndpoint}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-secondary border border-border hover:bg-secondary/80 text-xs font-medium transition flex-shrink-0"
            >
              {copiedEndpoint ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              <span>{copiedEndpoint ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
          <ShieldCheck size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Zero Secret Exposure:</strong> Webhook secrets are never returned over APIs or rendered on dashboards. Incoming replays are automatically deduplicated to prevent double-crediting.
          </span>
        </div>
      </div>

      {/* Received Webhook Events Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-muted-foreground" />
            <span className="font-medium text-sm">Received Provider Events ({events.length})</span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading webhook events...</div>
        ) : error ? (
          <div className="p-12 text-center text-red-400 text-sm">{error}</div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Webhook size={36} className="mx-auto text-muted-foreground opacity-40" />
            <p className="text-sm font-medium">No webhook events received yet</p>
            <p className="text-xs text-muted-foreground">
              Provider events received from Razorpay Sandbox or Mock will appear here with verification telemetry.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/40 text-xs font-semibold text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-6 py-3">Provider & Event</th>
                  <th className="px-6 py-3">Event ID</th>
                  <th className="px-6 py-3">Payment ID</th>
                  <th className="px-6 py-3">HMAC Signature</th>
                  <th className="px-6 py-3">Deduplication</th>
                  <th className="px-6 py-3">Received Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-secondary/20 transition">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">{e.event_type}</div>
                      <div className="text-xs text-muted-foreground uppercase">{e.provider}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                      {e.event_id}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">
                      {e.payment_id ? (
                        <Link
                          href={`/dashboard/transactions/${e.payment_id}`}
                          className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span>{e.payment_id}</span>
                          <ExternalLink size={10} />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {e.verified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 size={14} />
                          <span>Verified</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
                          <XCircle size={14} />
                          <span>Unverified</span>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {e.processed ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Processed
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {formatDate(e.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
