/** Thin fetch wrapper. Sessions are httpOnly cookies, so requests include credentials. */
const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Field-level messages from 422 validation errors, keyed by path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { path?: string; message?: string }[])
        .filter((d) => d.path)
        .map((d) => [d.path!, d.message ?? 'Invalid']),
    );
  }
}

import { isDemoModeActive, resolveMockResponse } from './mockResolver';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // If demo mode is active, try backend first but fallback seamlessly to mock
  if (isDemoModeActive()) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json().catch(() => null)) as T;
      }
    } catch {}
    return resolveMockResponse(path, method, body) as T;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const mock = resolveMockResponse(path, method, body);
    if (mock !== undefined) return mock as T;
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check that the API is running.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  url: (path: string) => `${BASE}${path}`,
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
