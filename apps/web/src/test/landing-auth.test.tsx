import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, OWNER_SESSION, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('landing page', () => {
  it('renders the product pitch and sign-in links for visitors', async () => {
    mockApi((c) =>
      c.path === '/auth/me'
        ? { status: 401, json: { error: { code: 'unauthorized', message: 'Sign in' } } }
        : undefined,
    );
    renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /automate the conversations/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });
});

describe('login form', () => {
  const unauth = { status: 401, json: { error: { code: 'unauthorized', message: 'Sign in' } } };

  it('validates fields on the client before calling the API', async () => {
    const calls = mockApi((c) => (c.path === '/auth/me' ? unauth : undefined));
    renderApp('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('shows a clear message for wrong credentials', async () => {
    mockApi((c) => (c.path === '/auth/me' || c.path === '/auth/login' ? unauth : undefined));
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('redirects protected pages to login when signed out', async () => {
    mockApi((c) => (c.path === '/auth/me' ? unauth : undefined));
    renderApp('/app/automations');
    await waitFor(() => expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument());
  });

  it('signs in and lands on the dashboard', async () => {
    let signedIn = false;
    const calls = mockApi((c) => {
      if (c.path === '/auth/me') return signedIn ? { json: OWNER_SESSION } : unauth;
      if (c.path === '/auth/login') {
        signedIn = true;
        return { json: OWNER_SESSION };
      }
      if (c.path.startsWith('/dashboard'))
        return { status: 500, json: { error: { code: 'x', message: 'Dashboard unavailable in test' } } };
      if (c.path.startsWith('/conversations'))
        return { json: { data: [], total: 0, page: 1, pageSize: 25, counts: {} } };
      return undefined;
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'owner@example.test');
    await user.type(screen.getByLabelText('Password'), 'Demo@12345');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({
      email: 'owner@example.test',
      password: 'Demo@12345',
    });
  });
});
