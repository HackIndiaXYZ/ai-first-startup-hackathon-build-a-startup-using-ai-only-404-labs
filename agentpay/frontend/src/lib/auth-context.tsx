'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi, User, Organization } from '@/lib/api';

interface AuthState {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, orgName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, organization: null, token: null, loading: true,
  });

  useEffect(() => {
    const token = localStorage.getItem('frame_token');
    if (!token) { setState(s => ({ ...s, loading: false })); return; }
    authApi.me().then(res => {
      setState({ user: res.data.user, organization: res.data.organization, token, loading: false });
    }).catch(() => {
      localStorage.removeItem('frame_token');
      setState(s => ({ ...s, loading: false }));
    });
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    localStorage.setItem('frame_token', res.data.token);
    setState({ user: res.data.user, organization: res.data.organization, token: res.data.token, loading: false });
  };

  const register = async (email: string, password: string, name: string, orgName: string) => {
    const res = await authApi.register({ email, password, name, organization_name: orgName });
    localStorage.setItem('frame_token', res.data.token);
    setState({ user: res.data.user, organization: res.data.organization, token: res.data.token, loading: false });
  };

  const logout = () => {
    localStorage.removeItem('frame_token');
    setState({ user: null, organization: null, token: null, loading: false });
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
