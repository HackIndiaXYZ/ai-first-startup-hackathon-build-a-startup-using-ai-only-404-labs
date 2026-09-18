'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  LayoutDashboard, Bot, Shield, ShieldCheck, CreditCard, Clock, Receipt,
  ScrollText, Plug, Settings, LogOut, ChevronRight, Wallet, Code2, Webhook, FlaskConical
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { href: '/dashboard/developers', icon: Code2, label: 'Developers' },
  { href: '/dashboard/agents', icon: Bot, label: 'Agents' },
  { href: '/dashboard/agent-demo', icon: FlaskConical, label: 'Agent Demo' },
  { href: '/dashboard/payment-authorities', icon: ShieldCheck, label: 'Authorities' },
  { href: '/dashboard/policies', icon: Shield, label: 'Policies' },
  { href: '/dashboard/payments', icon: CreditCard, label: 'Payments' },
  { href: '/dashboard/approvals', icon: Clock, label: 'Approvals', badge: true },
  { href: '/dashboard/transactions', icon: Receipt, label: 'Transactions' },
  { href: '/dashboard/integrations/webhooks', icon: Webhook, label: 'Webhooks' },
  { href: '/dashboard/integrations/providers', icon: Plug, label: 'Providers' },
  { href: '/dashboard/audit', icon: ScrollText, label: 'Audit Log' },
];

const bottomItems = [
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, organization, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-2 h-2 rounded-full pulse-dot" style={{ background: 'var(--accent)' }} />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col flex-shrink-0 border-r" style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
      }}>
        {/* Logo */}
        <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <Wallet size={14} color="white" />
            </div>
            <span className="font-semibold text-sm">Frame</span>
            <span className="ml-auto text-xs rounded-full px-2 py-0.5" style={{
              background: 'var(--accent-glow)', color: 'var(--accent)',
              border: '1px solid rgba(99,102,241,0.2)',
            }}>
              {organization?.frame_env}
            </span>
          </div>
          <p className="text-xs mt-2 truncate" style={{ color: 'var(--text-muted)' }}>
            {organization?.name}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(item => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}
                className={`sidebar-item ${isActive ? 'active' : ''}`}>
                <item.icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-3 border-t space-y-0.5" style={{ borderColor: 'var(--border)' }}>
          {bottomItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`sidebar-item ${pathname.startsWith(item.href) ? 'active' : ''}`}>
              <item.icon size={16} />
              <span>{item.label}</span>
            </Link>
          ))}
          <button onClick={logout} className="sidebar-item w-full text-left">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
          {/* User info */}
          <div className="px-3 py-2 mt-2 rounded-lg" style={{ background: 'var(--bg-card)' }}>
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.role}</p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
        {children}
      </main>
    </div>
  );
}
