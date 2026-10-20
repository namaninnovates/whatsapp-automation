import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../App';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../hooks/useAuth';

export interface Call {
  method: string;
  path: string;
  body: unknown;
}
type Responder = (call: Call) => { status?: number; json?: unknown } | undefined;

/** Replaces fetch with an in-memory API. Unhandled requests return 404 so tests fail loudly. */
export function mockApi(responder: Responder) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/api/, '') + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = responder(call) ?? {
      status: 404,
      json: { error: { code: 'not_found', message: `No mock for ${call.method} ${call.path}` } },
    };
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.json ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

export const OWNER_SESSION = {
  user: { id: 'u1', name: 'Test Owner', email: 'owner@example.test' },
  organization: { id: 'o1', name: 'Test Org', slug: 'test-org' },
  role: 'OWNER',
};

export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
