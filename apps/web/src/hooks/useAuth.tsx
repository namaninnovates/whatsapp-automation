import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { ROLE_RANK } from '@wa/shared';
import { api, ApiError } from '../lib/api';
import type { Role, Session } from '../lib/types';

interface AuthValue {
  session: Session | null;
  loading: boolean;
  can: (min: Role) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Session>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const session = q.data ?? null;
  const value: AuthValue = {
    session,
    loading: q.isLoading,
    can: (min) => !!session && ROLE_RANK[session.role] >= ROLE_RANK[min],
    signOut: async () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('wa_demo_session');
      }
      try {
        await api.post('/auth/logout');
      } catch {}
      qc.clear();
      qc.setQueryData(['me'], null);
    },
    refresh: () => q.refetch(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
