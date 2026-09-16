'use client';

import { useAuth } from '@/lib/auth-context';

export default function SettingsPage() {
  const { user, organization } = useAuth();

  return (
    <div className="p-6 space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Organization and account settings</p>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold">Organization</h2>
        {[
          ['Name', organization?.name],
          ['Slug', organization?.slug],
          ['Environment', organization?.frame_env],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between text-sm py-2 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <span className="font-medium">{value || '—'}</span>
          </div>
        ))}
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold">Account</h2>
        {[
          ['Name', user?.name],
          ['Email', user?.email],
          ['Role', user?.role],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between text-sm py-2 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <span className="font-medium">{value || '—'}</span>
          </div>
        ))}
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold">Payment Providers & Rails</h2>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Frame operates above payment rails. Provider secrets are never exposed to clients or logged.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">Deterministic Mock Provider</span>
              <span className="badge badge-success text-xs">Active Default</span>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              Deterministic test harness for unit tests, failure simulation, timeouts, and state machines.
            </p>
            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              Rails: upi, card, mock
            </div>
          </div>

          <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">Razorpay Sandbox Adapter</span>
              <span className="badge badge-info text-xs">Configurable</span>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              Official Razorpay REST API contract (Orders, Payments, Webhook HMAC-SHA256).
            </p>
            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              Rails: upi, card, bank_transfer
            </div>
          </div>
        </div>

        <div className="text-xs p-3 rounded border font-mono" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Inbound Webhook Endpoint: </span>
          <span style={{ color: 'var(--accent)' }}>POST /v1/webhooks/razorpay</span>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold mb-3">Sandbox Isolation & Safety</h2>
        <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--accent-glow)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <div className="w-2 h-2 rounded-full pulse-dot" style={{ background: 'var(--accent)' }} />
          <div className="text-sm">
            <p className="font-medium" style={{ color: 'var(--accent)' }}>Sandbox Environment Active (FRAME_ENV=sandbox)</p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Strict isolation enforced: live credentials (<code className="text-xs">rzp_live_*</code>) are automatically rejected in sandbox.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
