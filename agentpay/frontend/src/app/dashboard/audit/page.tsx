'use client';

import { useEffect, useState } from 'react';
import { auditApi, AuditEvent } from '@/lib/api';
import { formatDate, getStatusBadge } from '@/lib/utils';
import { ScrollText } from 'lucide-react';

const actionColors: Record<string, string> = {
  'agent.created': 'badge-success', 'agent.disabled': 'badge-warning', 'agent.enabled': 'badge-success',
  'payment_intent.created': 'badge-neutral', 'payment_intent.evaluated': 'badge-neutral',
  'payment.succeeded': 'badge-success', 'payment.failed': 'badge-danger',
  'approval.approved': 'badge-success', 'approval.rejected': 'badge-danger',
  'agent.credential_created': 'badge-neutral', 'agent.credential_revoked': 'badge-warning',
  'policy.created': 'badge-neutral', 'policy.updated': 'badge-neutral',
  'user.login': 'badge-neutral', 'organization.created': 'badge-success',
};

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auditApi.list({ per_page: 100 } as Parameters<typeof auditApi.list>[0]).then(r => setEvents(r.data)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Immutable, append-only record of all system actions
        </p>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading audit events...</div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center">
            <ScrollText size={40} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="font-medium">No audit events yet</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Resource</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {events.map(evt => (
                <tr key={evt.id}>
                  <td className="text-xs font-mono whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(evt.occurred_at)}
                  </td>
                  <td>
                    <span className={`badge ${actionColors[evt.action] || 'badge-neutral'}`}>
                      {evt.action}
                    </span>
                  </td>
                  <td>
                    <div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{evt.actor_type}</p>
                      {evt.actor_id && (
                        <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {evt.actor_id.slice(0, 10)}...
                        </code>
                      )}
                    </div>
                  </td>
                  <td>
                    {evt.resource_type && (
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{evt.resource_type}</p>
                        {evt.resource_id && (
                          <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                            {evt.resource_id.slice(0, 10)}...
                          </code>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {evt.decision && (
                      <span className={`badge ${getStatusBadge(evt.decision)}`}>{evt.decision}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
