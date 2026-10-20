import { describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinitionInput } from '@wa/shared';
import { WorkflowDefinitionSchema } from '@wa/shared';
import {
  matchTrigger,
  runWorkflow,
  selectWorkflow,
  validateDefinition,
  type EngineContext,
  type EngineServices,
} from '../src';

const def = (d: WorkflowDefinitionInput) => WorkflowDefinitionSchema.parse(d);

function ctx(text = 'hi', extra: Partial<EngineContext> = {}): EngineContext {
  return {
    message: { text },
    customer: { id: 'c1', name: 'Asha', isNew: false, tags: [] },
    businessHoursOpen: true,
    variables: {},
    ...extra,
  };
}

function services(overrides: Partial<EngineServices> = {}): EngineServices {
  return {
    renderMenu: vi.fn(async (id: string) => ({
      kind: 'menu' as const,
      menuId: id,
      body: 'Pick one',
      buttonLabel: 'Options',
      options: [{ id: 'o1', title: 'One' }],
    })),
    listProducts: vi.fn(async () => ({
      kind: 'products' as const,
      text: 'Products',
      items: [{ id: 'p1', title: 'Lamp' }],
    })),
    addTag: vi.fn(async () => {}),
    assignHuman: vi.fn(async () => {}),
    aiRespond: vi.fn(async () => ({ text: 'AI says hi' })),
    runAction: vi.fn(async () => ({ ok: true, message: 'Done', data: { id: 1 } })),
    saveCustomerField: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('trigger matching', () => {
  const ev = (text: string, extra = {}) => ({
    kind: 'message' as const,
    text,
    isNewCustomer: false,
    businessHoursOpen: true,
    ...extra,
  });

  it('matches keywords as whole words, case-insensitively', () => {
    const t = { type: 'keyword' as const, keywords: ['track', 'order status'], match: 'contains' as const };
    expect(matchTrigger(t, ev('Can you TRACK my parcel?'))).toBe(true);
    expect(matchTrigger(t, ev('what is my order status'))).toBe(true);
    expect(matchTrigger(t, ev('racetrack'))).toBe(false);
  });

  it('matches first-time customers, business hours and menu selections', () => {
    expect(matchTrigger({ type: 'first_time_customer' }, ev('hi', { isNewCustomer: true }))).toBe(true);
    expect(matchTrigger({ type: 'first_time_customer' }, ev('hi'))).toBe(false);
    expect(
      matchTrigger({ type: 'business_hours', when: 'outside' }, ev('hi', { businessHoursOpen: false })),
    ).toBe(true);
    const sel = { menuSelection: { menuId: 'm1', optionId: 'o2' } };
    expect(matchTrigger({ type: 'menu_selection', menuId: 'm1', optionId: 'o2' }, ev('2', sel))).toBe(true);
    expect(matchTrigger({ type: 'menu_selection', menuId: 'm1', optionId: 'o3' }, ev('2', sel))).toBe(false);
  });

  it('selects the most specific matching workflow', () => {
    const wfs = [
      { id: 'any', priority: 100, createdAt: '2026-01-01', trigger: { type: 'incoming_message' as const } },
      {
        id: 'kw',
        priority: 100,
        createdAt: '2026-01-02',
        trigger: { type: 'keyword' as const, keywords: ['price'], match: 'contains' as const },
      },
    ];
    expect(selectWorkflow(wfs, ev('price please'))?.id).toBe('kw');
    expect(selectWorkflow(wfs, ev('hello'))?.id).toBe('any');
  });
});

describe('validation', () => {
  it('rejects loops and missing references', () => {
    const looping = {
      trigger: { type: 'incoming_message' },
      steps: [
        { id: 'a', type: 'send_text', text: 'x', next: 'b' },
        { id: 'b', type: 'send_text', text: 'y', next: 'a' },
      ],
    };
    const r = validateDefinition(looping);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Loop detected/);
    const missing = validateDefinition({
      trigger: { type: 'incoming_message' },
      steps: [{ id: 'a', type: 'send_text', text: 'x', next: 'zzz' }],
    });
    expect(missing.errors[0]).toMatch(/missing step "zzz"/);
  });

  it('rejects unsupported step types', () => {
    const r = validateDefinition({
      trigger: { type: 'incoming_message' },
      steps: [{ id: 'a', type: 'run_sql', sql: 'drop table' }],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid branching workflow', () => {
    const r = validateDefinition({
      trigger: { type: 'keyword', keywords: ['hours'] },
      steps: [
        {
          id: 'c',
          type: 'condition',
          rules: [{ field: 'businessHours.open', op: 'is_true' }],
          onTrue: 'open',
          onFalse: 'closed',
        },
        { id: 'open', type: 'send_text', text: 'We are open', next: null },
        { id: 'closed', type: 'send_text', text: 'We are closed' },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe('execution', () => {
  it('runs steps in order and interpolates variables', async () => {
    const svc = services();
    const r = await runWorkflow({
      definition: def({
        trigger: { type: 'incoming_message' },
        steps: [
          { id: 's1', type: 'send_text', text: 'Hello {{customer.name}}' },
          { id: 's2', type: 'add_tag', tag: 'greeted' },
        ],
      }),
      context: ctx(),
      services: svc,
    });
    expect(r.status).toBe('SUCCEEDED');
    expect(r.messages).toEqual([{ kind: 'text', text: 'Hello Asha' }]);
    expect(svc.addTag).toHaveBeenCalledWith('greeted');
    expect(r.log.map((l) => l.status)).toEqual(['ok', 'ok']);
  });

  it('branches on conditions', async () => {
    const d = def({
      trigger: { type: 'incoming_message' },
      steps: [
        {
          id: 'c',
          type: 'condition',
          rules: [{ field: 'message.text', op: 'contains', value: 'refund' }],
          onTrue: 'h',
          onFalse: 'r',
        },
        { id: 'h', type: 'assign_human', next: null },
        { id: 'r', type: 'send_text', text: 'Thanks!' },
      ],
    });
    const a = await runWorkflow({ definition: d, context: ctx('I want a refund'), services: services() });
    expect(a.status).toBe('HANDED_OFF');
    const b = await runWorkflow({ definition: d, context: ctx('hello'), services: services() });
    expect(b.messages).toEqual([{ kind: 'text', text: 'Thanks!' }]);
  });

  it('waits for an answer, re-asks on invalid input and resumes', async () => {
    const d = def({
      trigger: { type: 'keyword', keywords: ['bulk'] },
      steps: [
        { id: 'q', type: 'ask_question', question: 'How many units?', variable: 'qty', validation: 'number' },
        {
          id: 'a',
          type: 'business_action',
          action: 'create_lead',
          params: { interest: 'Bulk {{vars.qty}}' },
        },
      ],
    });
    const svc = services();
    const first = await runWorkflow({ definition: d, context: ctx('bulk order'), services: svc });
    expect(first.status).toBe('WAITING');
    expect(first.waiting).toEqual({ stepId: 'q' });
    const bad = await runWorkflow({
      definition: d,
      context: ctx('lots'),
      services: svc,
      resume: first.waiting,
    });
    expect(bad.status).toBe('WAITING');
    expect(bad.messages[0]).toMatchObject({ text: expect.stringMatching(/reply with a number/) });
    const good = await runWorkflow({ definition: d, context: ctx('50'), services: svc, resume: bad.waiting });
    expect(good.status).toBe('SUCCEEDED');
    expect(svc.runAction).toHaveBeenCalledWith('create_lead', { interest: 'Bulk 50' });
  });

  it('collects several details one at a time', async () => {
    const d = def({
      trigger: { type: 'incoming_message' },
      steps: [
        {
          id: 'd',
          type: 'collect_details',
          fields: [
            { variable: 'city', prompt: 'Which city?' },
            { variable: 'email', prompt: 'Email?', validation: 'email' },
          ],
        },
        { id: 't', type: 'send_text', text: '{{vars.city}} / {{vars.email}}' },
      ],
    });
    const s = services();
    const r1 = await runWorkflow({ definition: d, context: ctx('start'), services: s });
    const r2 = await runWorkflow({ definition: d, context: ctx('Pune'), services: s, resume: r1.waiting });
    expect(r2.waiting).toEqual({ stepId: 'd', fieldIndex: 1 });
    const r3 = await runWorkflow({
      definition: d,
      context: { ...ctx('a@b.co'), variables: r2.variables },
      services: s,
      resume: r2.waiting,
    });
    expect(r3.messages.at(-1)).toEqual({ kind: 'text', text: 'Pune / a@b.co' });
  });

  it('records failures instead of throwing', async () => {
    const r = await runWorkflow({
      definition: def({
        trigger: { type: 'incoming_message' },
        steps: [
          { id: 'x', type: 'business_action', action: 'check_order_status', params: { orderNumber: 'NOPE' } },
        ],
      }),
      context: ctx(),
      services: services({ runAction: async () => ({ ok: false, error: 'Order not found' }) }),
    });
    expect(r.status).toBe('FAILED');
    expect(r.error).toBe('Order not found');
    expect(r.log.at(-1)).toMatchObject({ stepId: 'x', status: 'error' });
  });

  it('enforces step timeouts and step limits', async () => {
    const slow = await runWorkflow({
      definition: def({ trigger: { type: 'incoming_message' }, steps: [{ id: 'ai', type: 'ai_response' }] }),
      context: ctx(),
      services: services({ aiRespond: () => new Promise(() => {}) }),
      limits: { stepTimeoutMs: 20 },
    });
    expect(slow.status).toBe('FAILED');
    expect(slow.error).toMatch(/timed out/);

    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      type: 'send_text' as const,
      text: 'x',
    }));
    const limited = await runWorkflow({
      definition: def({ trigger: { type: 'incoming_message' }, steps: many }),
      context: ctx(),
      services: services(),
      limits: { maxSteps: 3 },
    });
    expect(limited.status).toBe('FAILED');
    expect(limited.error).toMatch(/exceeded 3 steps/);
  });

  it('stops after a menu and flags confirmation-gated actions', async () => {
    const menu = await runWorkflow({
      definition: def({
        trigger: { type: 'incoming_message' },
        steps: [
          { id: 'm', type: 'send_menu', menuId: 'm1' },
          { id: 'after', type: 'send_text', text: 'never sent' },
        ],
      }),
      context: ctx(),
      services: services(),
    });
    expect(menu.messages).toHaveLength(1);
    const order = await runWorkflow({
      definition: def({
        trigger: { type: 'incoming_message' },
        steps: [{ id: 'o', type: 'business_action', action: 'place_order', params: { sku: 'LAMP' } }],
      }),
      context: ctx(),
      services: services({
        runAction: async () => ({ ok: true, requiresConfirmation: true, message: 'Reply YES to confirm' }),
      }),
    });
    expect(order.pendingConfirmation).toBe(true);
    expect(order.messages[0]).toEqual({ kind: 'text', text: 'Reply YES to confirm' });
  });
});
