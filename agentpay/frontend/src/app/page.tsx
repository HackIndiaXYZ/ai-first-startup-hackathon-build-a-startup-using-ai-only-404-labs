'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/dashboard' : '/login');
    }
  }, [user, loading, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full pulse-dot" style={{ background: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-secondary)' }}>Loading Frame...</span>
      </div>
    </div>
  );
}
