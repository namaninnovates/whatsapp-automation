import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, OWNER_SESSION, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const MENU = {
  id: 'm1',
  name: 'Main menu',
  header: '',
  body: 'How can we help?',
  buttonLabel: 'View options',
  isDefault: true,
  isPublished: true,
  publishedAt: null,
  updatedAt: new Date().toISOString(),
  options: [
    {
      id: 'o1',
      position: 0,
      title: 'Store hours',
      description: '',
      actionType: 'REPLY',
      actionConfig: { text: 'We are open 10 to 8.' },
    },
    {
      id: 'o2',
      position: 1,
      title: 'Talk to support',
      description: '',
      actionType: 'HANDOFF',
      actionConfig: {},
    },
  ],
};

function setup() {
  return mockApi((c) => {
    if (c.path === '/auth/me') return { json: OWNER_SESSION };
    if (c.path === '/menus' && c.method === 'GET') return { json: [MENU] };
    if (c.path === '/workflows') return { json: [] };
    if (c.path === '/products') return { json: [] };
    if (c.path === '/menus/m1' && c.method === 'PUT') return { json: { ...MENU, ...(c.body as object) } };
    return undefined;
  });
}

describe('menu editor', () => {
  it('renders options and a live WhatsApp preview', async () => {
    setup();
    renderApp('/app/menus/m1');
    expect(await screen.findByLabelText('Option 1 title')).toHaveValue('Store hours');
    expect(screen.getByText('2/10 · sent as reply buttons')).toBeInTheDocument();
    expect(screen.getAllByText('Talk to support').length).toBeGreaterThan(0);
  });

  it('enforces WhatsApp limits and required fields before saving', async () => {
    const calls = setup();
    renderApp('/app/menus/m1');
    const user = userEvent.setup();
    const title = await screen.findByLabelText('Option 1 title');
    await user.clear(title);
    await user.type(title, 'A very long option title that WhatsApp rejects');
    const reply = screen.getByLabelText('Reply text');
    await user.clear(reply);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Max 24 characters (WhatsApp limit)')).toBeInTheDocument();
    expect(screen.getByText('Reply text is required')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('saves options in the order shown', async () => {
    const calls = setup();
    renderApp('/app/menus/m1');
    const user = userEvent.setup();
    await screen.findByLabelText('Option 1 title');
    await user.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as { options: { title: string }[] };
    expect(body.options.map((o) => o.title)).toEqual(['Talk to support', 'Store hours']);
  });
});
