import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, OWNER_SESSION, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const workflow = (steps: unknown[]) => ({
  id: 'w1',
  name: 'Store hours',
  description: '',
  isActive: false,
  priority: 100,
  activeVersionId: null,
  latestVersionId: 'v1',
  definition: { trigger: { type: 'keyword', keywords: ['hours'], match: 'contains' }, steps },
  versions: [{ id: 'v1', version: 1, createdAt: new Date().toISOString() }],
  validation: null,
});

function setup(steps: unknown[]) {
  return mockApi((c) => {
    if (c.path === '/auth/me') return { json: OWNER_SESSION };
    if (c.path === '/workflows/w1' && c.method === 'GET') return { json: workflow(steps) };
    if (c.path === '/workflows/w1' && c.method === 'PUT')
      return { json: { latestVersion: 2, validation: { ok: true }, activeVersionUpdated: false } };
    if (c.path === '/workflows/w1/executions') return { json: [] };
    if (c.path === '/workflows/w1/test')
      return {
        json: {
          matchedTrigger: true,
          finalStatus: 'SUCCEEDED',
          handoff: false,
          runs: [
            {
              input: 'what are your hours',
              status: 'SUCCEEDED',
              messages: [{ kind: 'text', text: 'We open at 10.' }],
              log: [{ stepId: 'reply', type: 'send_text', status: 'ok', at: '', durationMs: 1 }],
            },
          ],
        },
      };
    if (c.path === '/menus' || c.path === '/products') return { json: [] };
    return undefined;
  });
}

describe('workflow builder', () => {
  it('flags broken step references before saving', async () => {
    setup([{ id: 'reply', type: 'send_text', text: 'Hi', next: 'ghost' }]);
    renderApp('/app/automations/w1');
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Fix these before activating');
    expect(banner).toHaveTextContent('Step "reply" points to missing step "ghost"');
  });

  it('adds a step and saves a new version with the full definition', async () => {
    const calls = setup([{ id: 'reply', type: 'send_text', text: 'We open at 10.' }]);
    renderApp('/app/automations/w1');
    const user = userEvent.setup();
    await screen.findByLabelText('Message');
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.click(screen.getByRole('button', { name: 'Assign to a human' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as { definition: { steps: { type: string }[] } };
    expect(body.definition.steps.map((s) => s.type)).toEqual(['send_text', 'assign_human']);
  });

  it('runs a test against the draft and shows the transcript', async () => {
    const calls = setup([{ id: 'reply', type: 'send_text', text: 'We open at 10.' }]);
    renderApp('/app/automations/w1');
    const user = userEvent.setup();
    const msg = await screen.findByLabelText('Customer message');
    await user.clear(msg);
    await user.type(msg, 'what are your hours');
    await user.click(screen.getByRole('button', { name: 'Run test' }));
    expect(await screen.findByText('Trigger matched')).toBeInTheDocument();
    expect(
      within(screen.getByText('Trigger matched').closest('section')!).getByText('We open at 10.'),
    ).toBeInTheDocument();
    const body = calls.find((c) => c.path === '/workflows/w1/test')!.body as {
      message: string;
      definition: unknown;
    };
    expect(body.message).toBe('what are your hours');
    expect(body.definition).toBeTruthy();
  });
});
