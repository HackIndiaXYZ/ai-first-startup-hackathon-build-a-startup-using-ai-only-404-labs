'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name, orgName);
      }
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError((err as Error).message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.08) 0%, transparent 100%)'
      }} />

      <div className="w-full max-w-md animate-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h8M2 12h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-xl font-semibold">Frame</span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            AI Agent Payment Infrastructure
          </p>
        </div>

        <div className="card p-6">
          {/* Tabs */}
          <div className="flex rounded-lg p-1 mb-6" style={{ background: 'var(--bg-secondary)' }}>
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 py-2 text-sm font-medium rounded-md transition-all duration-150"
                style={{
                  background: tab === t ? 'var(--bg-card)' : 'transparent',
                  color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                {t === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'register' && (
              <>
                <div>
                  <label className="input-label">Full Name</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)}
                    placeholder="John Smith" required />
                </div>
                <div>
                  <label className="input-label">Organization Name</label>
                  <input className="input" value={orgName} onChange={e => setOrgName(e.target.value)}
                    placeholder="Acme Corp" required />
                </div>
              </>
            )}
            <div>
              <label className="input-label">Email</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com" required />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={8} />
            </div>

            {error && (
              <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
              {loading ? 'Loading...' : tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {tab === 'login' && (
            <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
              Demo: Create an account to get started (sandbox mode)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
