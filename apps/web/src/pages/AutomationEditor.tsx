import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  FlaskConical,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BUSINESS_ACTION_LABELS,
  BUSINESS_ACTIONS,
  BUSINESS_EVENTS,
  CONDITION_FIELDS,
  CONDITION_OPS,
  STEP_LABELS,
  STEP_TYPES,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  type ConditionRule,
  type Step,
  type StepType,
  type Trigger,
  type WorkflowDefinition,
} from '@wa/shared';
import { validateDefinition, type OutboundMessage, type StepLogEntry } from '@wa/workflow-engine';
import { ChatThread, type ChatMessage } from '../components/chat/ChatThread';
import { ExecutionStatusBadge } from '../components/StatusBadges';
import {
  Badge,
  Button,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Panel,
  PanelHeader,
  Select,
  Textarea,
  Toggle,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api, errorMessage } from '../lib/api';
import type { Execution, Menu, Product, WorkflowDetail } from '../lib/types';
import { cn, dateTime, timeAgo } from '../lib/utils';

type AnyStep = Step & Record<string, unknown>;

const PARAM_KEYS: Record<string, string[]> = {
  check_order_status: ['orderNumber'],
  check_product_availability: ['query'],
  create_lead: ['interest', 'details'],
  place_order: ['query', 'quantity'],
};
const OP_LABELS: Record<string, string> = {
  contains: 'contains',
  equals: 'equals',
  not_equals: 'does not equal',
  is_true: 'is true',
  is_false: 'is false',
  gt: 'is greater than',
  lt: 'is less than',
};
const FIELD_LABELS: Record<string, string> = {
  'message.text': 'Message text',
  'customer.isNew': 'Customer is new',
  'customer.hasTag': 'Customer has tag',
  'businessHours.open': 'Business is open',
  variable: 'Variable',
};

function newStep(type: StepType, existing: Step[], menus: Menu[]): Step {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === `${type}_${n}`)) n++;
  const id = `${type}_${n}`;
  switch (type) {
    case 'send_text':
      return { id, type, text: 'Thanks, {{customer.firstName}}!' };
    case 'send_menu':
      return { id, type, menuId: menus[0]?.id ?? '' };
    case 'ask_question':
      return {
        id,
        type,
        question: 'What is your order number?',
        variable: 'answer',
        validation: 'text',
        saveToCustomerField: false,
      };
    case 'send_product_list':
      return { id, type, limit: 5 };
    case 'collect_details':
      return {
        id,
        type,
        fields: [{ variable: 'name', prompt: 'What is your name?', validation: 'text' }],
        saveToCustomerFields: true,
      };
    case 'condition':
      return {
        id,
        type,
        mode: 'all',
        rules: [{ field: 'message.text', op: 'contains', value: '' }],
        onTrue: null,
        onFalse: null,
      };
    case 'assign_human':
      return { id, type, note: '' };
    case 'add_tag':
      return { id, type, tag: 'tag' };
    case 'ai_response':
      return { id, type, instructions: '' };
    case 'business_action':
      return { id, type, action: 'check_order_status', params: { orderNumber: '{{vars.answer}}' } };
    case 'end':
      return { id, type };
  }
}

function TargetSelect({
  value,
  onChange,
  steps,
  selfId,
  label,
  allowContinue = true,
}: {
  value: string | null | undefined;
  onChange: (v: string | null | undefined) => void;
  steps: Step[];
  selfId: string;
  label: string;
  allowContinue?: boolean;
}) {
  const v = value === undefined ? '__next' : value === null ? '__end' : value;
  return (
    <Select
      aria-label={label}
      value={v}
      onChange={(e) =>
        onChange(e.target.value === '__next' ? undefined : e.target.value === '__end' ? null : e.target.value)
      }
      className="h-7 text-[12.5px]"
    >
      {allowContinue && <option value="__next">Continue to the next step</option>}
      <option value="__end">End the workflow</option>
      {steps
        .filter((s) => s.id !== selfId)
        .map((s) => (
          <option key={s.id} value={s.id}>
            Go to: {s.label || s.id}
          </option>
        ))}
    </Select>
  );
}

function TriggerEditor({
  trigger,
  onChange,
  menus,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  menus: Menu[];
}) {
  const setType = (type: Trigger['type']) => {
    if (type === 'keyword') onChange({ type, keywords: ['hello'], match: 'contains' });
    else if (type === 'menu_selection') onChange({ type, menuId: menus[0]?.id ?? '' });
    else if (type === 'event') onChange({ type, event: 'order.status_changed' });
    else if (type === 'business_hours') onChange({ type, when: 'outside' });
    else onChange({ type } as Trigger);
  };
  const menu = trigger.type === 'menu_selection' ? menus.find((m) => m.id === trigger.menuId) : undefined;
  return (
    <div className="space-y-3">
      <Field label="When" htmlFor="trigger-type">
        <Select
          id="trigger-type"
          value={trigger.type}
          onChange={(e) => setType(e.target.value as Trigger['type'])}
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      {trigger.type === 'keyword' && (
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <Field
            label="Keywords or phrases"
            hint="Comma separated. Whole words only, case-insensitive."
            htmlFor="kw"
          >
            <Input
              id="kw"
              value={trigger.keywords.join(', ')}
              onChange={(e) =>
                onChange({
                  ...trigger,
                  keywords: e.target.value
                    .split(',')
                    .map((k) => k.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Match" htmlFor="kw-match">
            <Select
              id="kw-match"
              value={trigger.match}
              onChange={(e) => onChange({ ...trigger, match: e.target.value as 'contains' })}
            >
              <option value="contains">Message contains</option>
              <option value="exact">Message is exactly</option>
              <option value="starts_with">Message starts with</option>
            </Select>
          </Field>
        </div>
      )}
      {trigger.type === 'menu_selection' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Menu" htmlFor="tr-menu">
            <Select
              id="tr-menu"
              value={trigger.menuId}
              onChange={(e) => onChange({ type: 'menu_selection', menuId: e.target.value })}
            >
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Option" htmlFor="tr-opt">
            <Select
              id="tr-opt"
              value={trigger.optionId ?? ''}
              onChange={(e) => onChange({ ...trigger, optionId: e.target.value || undefined })}
            >
              <option value="">Any option</option>
              {menu?.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      {trigger.type === 'event' && (
        <Field
          label="Event"
          htmlFor="tr-ev"
          hint="Order events expose {{vars.orderNumber}} and {{vars.orderStatus}}."
        >
          <Select
            id="tr-ev"
            value={trigger.event}
            onChange={(e) => onChange({ type: 'event', event: e.target.value as 'lead.created' })}
          >
            {BUSINESS_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {trigger.type === 'business_hours' && (
        <Field
          label="Run when the business is"
          htmlFor="tr-bh"
          hint="Uses the hours and timezone in Settings."
        >
          <Select
            id="tr-bh"
            value={trigger.when}
            onChange={(e) => onChange({ type: 'business_hours', when: e.target.value as 'inside' })}
          >
            <option value="outside">Closed (outside business hours)</option>
            <option value="inside">Open (inside business hours)</option>
          </Select>
        </Field>
      )}
    </div>
  );
}

function StepFields({
  step,
  update,
  steps,
  menus,
  categories,
}: {
  step: AnyStep;
  update: (patch: Record<string, unknown>) => void;
  steps: Step[];
  menus: Menu[];
  categories: string[];
}) {
  const s = step as Step;
  switch (s.type) {
    case 'send_text':
      return (
        <Field
          label="Message"
          hint="Variables: {{customer.firstName}}, {{customer.name}}, {{vars.name}}, {{message.text}}"
          counter={{ value: s.text.length, max: 4096 }}
        >
          <Textarea aria-label="Message" value={s.text} onChange={(e) => update({ text: e.target.value })} />
        </Field>
      );
    case 'send_menu':
      return (
        <Field label="Menu" hint="The run stops here; the customer’s choice runs the option’s action.">
          <Select aria-label="Menu" value={s.menuId} onChange={(e) => update({ menuId: e.target.value })}>
            {!menus.length && <option value="">Create a menu first</option>}
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.isPublished ? '' : ' (draft)'}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'ask_question':
      return (
        <div className="space-y-3">
          <Field label="Question">
            <Textarea
              aria-label="Question"
              rows={2}
              value={s.question}
              onChange={(e) => update({ question: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Save answer as variable">
              <Input
                aria-label="Variable"
                value={s.variable}
                onChange={(e) => update({ variable: e.target.value })}
              />
            </Field>
            <Field label="Expected answer">
              <Select
                aria-label="Validation"
                value={s.validation}
                onChange={(e) => update({ validation: e.target.value })}
              >
                <option value="text">Any text</option>
                <option value="number">Number</option>
                <option value="email">Email</option>
                <option value="phone">Phone number</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              checked={s.saveToCustomerField}
              onChange={(e) => update({ saveToCustomerField: e.target.checked })}
              className="accent-[var(--color-accent)]"
            />
            Also store on the customer profile
          </label>
        </div>
      );
    case 'send_product_list':
      return (
        <div className="grid grid-cols-[1fr_100px] gap-3">
          <Field label="Category">
            <Select
              aria-label="Category"
              value={s.category ?? ''}
              onChange={(e) => update({ category: e.target.value || undefined })}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max items">
            <Input
              aria-label="Max items"
              type="number"
              min={1}
              max={10}
              value={s.limit}
              onChange={(e) => update({ limit: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            />
          </Field>
          <Field label="Intro text (optional)" className="col-span-2">
            <Input
              aria-label="Intro"
              value={s.intro ?? ''}
              onChange={(e) => update({ intro: e.target.value || undefined })}
            />
          </Field>
        </div>
      );
    case 'collect_details':
      return (
        <div className="space-y-2">
          {s.fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[110px_1fr_110px_28px] items-center gap-2">
              <Input
                aria-label={`Variable ${i + 1}`}
                value={f.variable}
                onChange={(e) =>
                  update({
                    fields: s.fields.map((x, j) => (j === i ? { ...x, variable: e.target.value } : x)),
                  })
                }
              />
              <Input
                aria-label={`Prompt ${i + 1}`}
                value={f.prompt}
                onChange={(e) =>
                  update({ fields: s.fields.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)) })
                }
              />
              <Select
                aria-label={`Validation ${i + 1}`}
                value={f.validation}
                onChange={(e) =>
                  update({
                    fields: s.fields.map((x, j) =>
                      j === i ? { ...x, validation: e.target.value as 'text' } : x,
                    ),
                  })
                }
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </Select>
              <IconButton
                label="Remove field"
                disabled={s.fields.length === 1}
                onClick={() => update({ fields: s.fields.filter((_, j) => j !== i) })}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            disabled={s.fields.length >= 8}
            onClick={() =>
              update({
                fields: [
                  ...s.fields,
                  { variable: `field${s.fields.length + 1}`, prompt: 'Your answer?', validation: 'text' },
                ],
              })
            }
          >
            Add field
          </Button>
        </div>
      );
    case 'condition': {
      const setRule = (i: number, patch: Partial<ConditionRule>) =>
        update({ rules: s.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
      return (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Continue when
            <Select
              aria-label="Match mode"
              className="h-7 w-auto"
              value={s.mode}
              onChange={(e) => update({ mode: e.target.value })}
            >
              <option value="all">all rules match</option>
              <option value="any">any rule matches</option>
            </Select>
          </div>
          {s.rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Field"
                className="h-7 w-[150px]"
                value={r.field}
                onChange={(e) => setRule(i, { field: e.target.value as ConditionRule['field'] })}
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </option>
                ))}
              </Select>
              {r.field === 'variable' && (
                <Input
                  aria-label="Variable name"
                  placeholder="variable"
                  className="h-7 w-[110px]"
                  value={r.variable ?? ''}
                  onChange={(e) => setRule(i, { variable: e.target.value })}
                />
              )}
              <Select
                aria-label="Operator"
                className="h-7 w-[140px]"
                value={r.op}
                onChange={(e) => setRule(i, { op: e.target.value as ConditionRule['op'] })}
              >
                {CONDITION_OPS.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABELS[o]}
                  </option>
                ))}
              </Select>
              {!['is_true', 'is_false'].includes(r.op) && (
                <Input
                  aria-label="Value"
                  className="h-7 flex-1 min-w-[90px]"
                  value={r.value ?? ''}
                  onChange={(e) => setRule(i, { value: e.target.value })}
                />
              )}
              <IconButton
                label="Remove rule"
                disabled={s.rules.length === 1}
                onClick={() => update({ rules: s.rules.filter((_, j) => j !== i) })}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() =>
              update({ rules: [...s.rules, { field: 'message.text', op: 'contains', value: '' }] })
            }
          >
            Add rule
          </Button>
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-2.5">
            <Field label={<span className="text-accent-ink">If true</span>}>
              <TargetSelect
                label="If true"
                allowContinue={false}
                value={s.onTrue}
                onChange={(v) => update({ onTrue: v ?? null })}
                steps={steps}
                selfId={s.id}
              />
            </Field>
            <Field label={<span className="text-danger">If false</span>}>
              <TargetSelect
                label="If false"
                allowContinue={false}
                value={s.onFalse}
                onChange={(v) => update({ onFalse: v ?? null })}
                steps={steps}
                selfId={s.id}
              />
            </Field>
          </div>
        </div>
      );
    }
    case 'assign_human':
      return (
        <Field label="Note for the team (optional)">
          <Input aria-label="Note" value={s.note ?? ''} onChange={(e) => update({ note: e.target.value })} />
        </Field>
      );
    case 'add_tag':
      return (
        <Field label="Tag">
          <Input aria-label="Tag" value={s.tag} onChange={(e) => update({ tag: e.target.value })} />
        </Field>
      );
    case 'ai_response':
      return (
        <Field
          label="Extra instructions (optional)"
          hint="Uses the assistant’s knowledge, approved actions and escalation rules."
        >
          <Textarea
            aria-label="Instructions"
            rows={2}
            value={s.instructions ?? ''}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </Field>
      );
    case 'business_action': {
      const keys = PARAM_KEYS[s.action] ?? [];
      return (
        <div className="space-y-3">
          <Field
            label="Action"
            hint={
              s.action === 'place_order'
                ? 'Asks the customer to reply YES before anything is ordered.'
                : 'Inputs are validated on the server before the action runs.'
            }
          >
            <Select
              aria-label="Action"
              value={s.action}
              onChange={(e) =>
                update({
                  action: e.target.value,
                  params: Object.fromEntries((PARAM_KEYS[e.target.value] ?? []).map((k) => [k, ''])),
                })
              }
            >
              {BUSINESS_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {BUSINESS_ACTION_LABELS[a]}
                </option>
              ))}
            </Select>
          </Field>
          {keys.map((k) => (
            <Field key={k} label={k}>
              <Input
                aria-label={k}
                value={s.params[k] ?? ''}
                placeholder="Text or {{vars.name}}"
                onChange={(e) => update({ params: { ...s.params, [k]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      );
    }
    case 'end':
      return <p className="text-[12.5px] text-ink-3">The workflow stops here.</p>;
  }
}

function StepCard({
  step,
  index,
  total,
  steps,
  menus,
  categories,
  onChange,
  onMove,
  onRemove,
  readOnly,
}: {
  step: Step;
  index: number;
  total: number;
  steps: Step[];
  menus: Menu[];
  categories: string[];
  onChange: (s: Step) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const update = (patch: Record<string, unknown>) => onChange({ ...(step as AnyStep), ...patch } as Step);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold text-ink-2 tabular">
          {index + 1}
        </span>
        <span className="text-[13px] font-medium">{STEP_LABELS[step.type]}</span>
        <Input
          aria-label="Step label"
          value={step.label ?? ''}
          placeholder={step.id}
          onChange={(e) => update({ label: e.target.value || undefined })}
          className="ml-1 h-6 max-w-[180px] border-transparent bg-transparent text-[12px] text-ink-3 shadow-none hover:border-line focus:border-ink"
        />
        <code className="ml-auto text-[11px] text-ink-3">{step.id}</code>
        {!readOnly && (
          <div className="flex">
            <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="size-3.5" />
            </IconButton>
            <IconButton label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown className="size-3.5" />
            </IconButton>
            <IconButton label="Delete step" disabled={total === 1} onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        )}
      </div>
      <fieldset disabled={readOnly} className="space-y-3 p-3">
        <StepFields
          step={step as AnyStep}
          update={update}
          steps={steps}
          menus={menus}
          categories={categories}
        />
        {step.type !== 'condition' && step.type !== 'end' && step.type !== 'send_menu' && (
          <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[12.5px] text-ink-3">
            Then
            <div className="w-[260px]">
              <TargetSelect
                label="Next step"
                value={step.next}
                onChange={(v) => update({ next: v })}
                steps={steps}
                selfId={step.id}
              />
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (t: StepType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center">
      <Button
        size="sm"
        variant="ghost"
        icon={<Plus className="size-3.5" />}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Add step
      </Button>
      {open && (
        <div className="animate-in absolute top-8 z-10 grid w-[420px] grid-cols-2 gap-0.5 rounded-lg border border-line bg-surface p-1.5 shadow-md">
          {STEP_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onAdd(t);
                setOpen(false);
              }}
              className="rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle"
            >
              {STEP_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TestResult {
  matchedTrigger: boolean;
  finalStatus: string;
  handoff: boolean;
  runs: { input: string; status: string; messages: OutboundMessage[]; log: StepLogEntry[]; error?: string }[];
}

function toChat(result: TestResult, isEvent: boolean): ChatMessage[] {
  const out: ChatMessage[] = [];
  result.runs.forEach((r, i) => {
    if (r.input && !(isEvent && i === 0))
      out.push({ id: `in${i}`, direction: 'INBOUND', senderType: 'CUSTOMER', body: r.input, kind: 'text' });
    r.messages.forEach((m, j) => {
      const body =
        m.kind === 'text'
          ? m.text
          : m.kind === 'products'
            ? [
                m.text,
                ...m.items.map(
                  (it, k) => `${k + 1}. ${it.title}${it.description ? ` — ${it.description}` : ''}`,
                ),
              ].join('\n')
            : m.body;
      out.push({
        id: `o${i}-${j}`,
        direction: 'OUTBOUND',
        senderType: 'AUTOMATION',
        body,
        kind: m.kind,
        payload: m.kind === 'menu' ? (m as unknown as Record<string, unknown>) : null,
      });
    });
  });
  return out;
}

function TestPanel({
  workflowId,
  definition,
  trigger,
}: {
  workflowId: string;
  definition: WorkflowDefinition;
  trigger: Trigger;
}) {
  const [message, setMessage] = useState(trigger.type === 'keyword' ? (trigger.keywords[0] ?? '') : 'Hi');
  const [isNew, setIsNew] = useState(trigger.type === 'first_time_customer');
  const [answers, setAnswers] = useState<string[]>([]);
  const run = useMutation({
    mutationFn: () =>
      api.post<TestResult>(`/workflows/${workflowId}/test`, {
        message,
        isNewCustomer: isNew,
        answers: answers.filter(Boolean),
        definition,
        event: trigger.type === 'event' ? trigger.event : undefined,
      }),
  });
  const r = run.data;
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="size-4" /> Test run
          </span>
        }
        description="Runs this draft through the real engine. Reads are real; tags, leads, orders and handoffs are only simulated."
      />
      <div className="space-y-3 p-4">
        {trigger.type !== 'event' && (
          <Field label="Customer message" htmlFor="test-msg">
            <Input id="test-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={isNew}
            onChange={(e) => setIsNew(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />{' '}
          First-time customer
        </label>
        <Field label="Follow-up replies" hint="Used when the workflow asks questions.">
          <div className="space-y-1.5">
            {answers.map((a, i) => (
              <div key={i} className="flex gap-1.5">
                <Input
                  aria-label={`Reply ${i + 1}`}
                  value={a}
                  onChange={(e) => setAnswers(answers.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <IconButton
                  label="Remove reply"
                  onClick={() => setAnswers(answers.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" />
                </IconButton>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() => setAnswers([...answers, ''])}
            >
              Add reply
            </Button>
          </div>
        </Field>
        <Button
          variant="primary"
          icon={<Play className="size-3.5" />}
          loading={run.isPending}
          onClick={() => run.mutate()}
        >
          Run test
        </Button>
        {run.error && <p className="text-[12.5px] text-danger">{errorMessage(run.error)}</p>}
      </div>
      {r && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 text-[12.5px]">
            {r.matchedTrigger ? (
              <Badge tone="accent">Trigger matched</Badge>
            ) : (
              <Badge tone="warn">Trigger would not match</Badge>
            )}
            <Badge
              tone={r.finalStatus === 'FAILED' ? 'danger' : r.finalStatus === 'WAITING' ? 'info' : 'neutral'}
            >
              {r.finalStatus.toLowerCase().replace('_', ' ')}
            </Badge>
            {r.handoff && <Badge tone="warn">Would hand off</Badge>}
          </div>
          <div className="max-h-[320px] overflow-y-auto border-y border-line">
            <ChatThread
              messages={toChat(r, trigger.type === 'event')}
              variant="phone"
              autoScroll={false}
              showSender={false}
            />
          </div>
          <ol className="space-y-1 p-4">
            {r.runs
              .flatMap((run) => run.log)
              .map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px]">
                  {l.status === 'error' ? (
                    <AlertCircle className="mt-0.5 size-3.5 text-danger" />
                  ) : l.status === 'waiting' ? (
                    <CircleDot className="mt-0.5 size-3.5 text-info" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-3.5 text-accent" />
                  )}
                  <span>
                    <code className="text-[11.5px]">{l.stepId}</code>{' '}
                    <span className="text-ink-3">{l.detail}</span>
                  </span>
                </li>
              ))}
            {r.runs.at(-1)?.error && <li className="text-[12.5px] text-danger">{r.runs.at(-1)?.error}</li>}
          </ol>
        </div>
      )}
    </Panel>
  );
}

function Executions({ workflowId }: { workflowId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['executions', workflowId],
    queryFn: () => api.get<Execution[]>(`/workflows/${workflowId}/executions`),
    refetchInterval: 10000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/workflows/executions/${id}/retry`),
    onSuccess: () => {
      toast('Retried');
      qc.invalidateQueries({ queryKey: ['executions', workflowId] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel>
      <PanelHeader title="Recent runs" description="Every execution is logged step by step." />
      {q.isLoading && <LoadingBlock rows={2} />}
      {q.data && !q.data.length && (
        <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">No runs yet.</p>
      )}
      <ul className="divide-y divide-line">
        {q.data?.slice(0, 15).map((e) => (
          <li key={e.id} className="px-4 py-2">
            <button
              type="button"
              onClick={() => setOpen(open === e.id ? null : e.id)}
              className="flex w-full items-center gap-2 text-left"
            >
              <ExecutionStatusBadge status={e.status} />
              <span className="flex-1 truncate text-[12.5px] text-ink-2">
                {e.conversation?.customer.name ?? 'Unknown customer'} · v{e.version?.version}
              </span>
              <span className="text-[12px] text-ink-3">{timeAgo(e.startedAt)}</span>
            </button>
            {open === e.id && (
              <div className="mt-2 space-y-1 rounded-md bg-subtle p-2.5 text-[12px]">
                <p className="text-ink-3">
                  Started {dateTime(e.startedAt)} · attempt {e.attempt}
                </p>
                {e.log.map((l, i) => (
                  <p key={i}>
                    <code>{l.stepId}</code>{' '}
                    <span className={l.status === 'error' ? 'text-danger' : 'text-ink-2'}>{l.status}</span>{' '}
                    {l.detail && <span className="text-ink-3">· {l.detail}</span>}
                  </p>
                ))}
                {e.error && <p className="text-danger">{e.error}</p>}
                <div className="flex gap-2 pt-1">
                  {e.conversation && (
                    <Link
                      to={`/app/inbox/${e.conversation.id}`}
                      className="font-medium text-ink-2 hover:underline"
                    >
                      Open conversation
                    </Link>
                  )}
                  {e.status === 'FAILED' && can('ADMIN') && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium text-ink-2 hover:underline"
                      onClick={() => retry.mutate(e.id)}
                    >
                      <RotateCcw className="size-3" /> Retry
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function AutomationEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const readOnly = !can('ADMIN');
  const q = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.get<WorkflowDetail>(`/workflows/${id}`),
  });
  const menus = useQuery({ queryKey: ['menus'], queryFn: () => api.get<Menu[]>('/menus') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products') });
  const categories = useMemo(
    () => [...new Set((products.data ?? []).map((p) => p.category))],
    [products.data],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(100);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (q.data && !dirty) {
      setName(q.data.name);
      setDescription(q.data.description);
      setPriority(q.data.priority);
      setDef(q.data.definition);
    }
  }, [q.data, dirty]);

  const validation = useMemo(() => (def ? validateDefinition(def) : null), [def]);
  const edit = (next: WorkflowDefinition) => {
    setDef(next);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.put<{ latestVersion: number; validation: { ok: boolean }; activeVersionUpdated: boolean }>(
        `/workflows/${id}`,
        { name, description, priority, definition: def },
      ),
    onSuccess: (r) => {
      setDirty(false);
      toast(
        r.activeVersionUpdated
          ? `Saved v${r.latestVersion}; the live workflow now uses it`
          : `Saved as v${r.latestVersion}`,
      );
      qc.invalidateQueries({ queryKey: ['workflow', id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const activate = useMutation({
    mutationFn: (on: boolean) => api.post(`/workflows/${id}/${on ? 'activate' : 'deactivate'}`),
    onSuccess: (_d, on) => {
      toast(on ? 'Workflow is live' : 'Workflow deactivated');
      qc.invalidateQueries({ queryKey: ['workflow', id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isLoading || !def) return q.error ? <ErrorBlock error={q.error} /> : <LoadingBlock rows={6} />;
  const wf = q.data!;
  const steps = def.steps;
  const setStep = (i: number, s: Step) => edit({ ...def, steps: steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    edit({ ...def, steps: next });
  };

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/app/automations" className="text-ink-3 hover:text-ink" aria-label="Back to automations">
            <ArrowLeft className="size-4" />
          </Link>
          <Input
            aria-label="Workflow name"
            value={name}
            disabled={readOnly}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="h-8 max-w-[320px] border-transparent bg-transparent text-[16px] font-semibold shadow-none hover:border-line focus:border-ink"
          />
          {wf.isActive ? (
            <Badge tone="accent" dot>
              Live · v{wf.versions.find((v) => v.id === wf.activeVersionId)?.version}
            </Badge>
          ) : (
            <Badge>Inactive</Badge>
          )}
          {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          <div className="ml-auto flex items-center gap-2">
            {!readOnly && (
              <>
                <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  Active{' '}
                  <Toggle
                    label="Active"
                    checked={wf.isActive}
                    disabled={dirty || activate.isPending}
                    onChange={(v) => activate.mutate(v)}
                  />
                </label>
                <Button
                  variant="primary"
                  loading={save.isPending}
                  disabled={!dirty}
                  onClick={() => save.mutate()}
                >
                  Save version
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          {validation && (!validation.ok || validation.warnings.length > 0) && (
            <div
              role="status"
              className={cn(
                'rounded-md border px-3 py-2.5 text-[12.5px]',
                validation.ok
                  ? 'border-warn/20 bg-warn-soft text-warn'
                  : 'border-danger/20 bg-danger-soft text-danger',
              )}
            >
              <p className="font-medium">{validation.ok ? 'Warnings' : 'Fix these before activating'}</p>
              <ul className="mt-1 list-disc pl-4">
                {[...validation.errors, ...validation.warnings].map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <Panel>
            <PanelHeader title="Details" />
            <fieldset disabled={readOnly} className="grid grid-cols-[1fr_120px] gap-3 p-4">
              <Field label="Description">
                <Input
                  aria-label="Description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Priority" hint="Lower runs first on ties.">
                <Input
                  aria-label="Priority"
                  type="number"
                  min={1}
                  max={1000}
                  value={priority}
                  onChange={(e) => {
                    setPriority(Number(e.target.value) || 100);
                    setDirty(true);
                  }}
                />
              </Field>
            </fieldset>
          </Panel>
          <Panel>
            <PanelHeader title="Trigger" description="What starts this workflow." />
            <fieldset disabled={readOnly} className="p-4">
              <TriggerEditor
                trigger={def.trigger}
                menus={menus.data ?? []}
                onChange={(t) => edit({ ...def, trigger: t })}
              />
            </fieldset>
          </Panel>
          <div className="flex justify-center">
            <div className="h-4 w-px bg-line-strong" />
          </div>
          {steps.map((s, i) => (
            <div key={s.id + i} className="space-y-3">
              <StepCard
                step={s}
                index={i}
                total={steps.length}
                steps={steps}
                menus={menus.data ?? []}
                categories={categories}
                readOnly={readOnly}
                onChange={(n) => setStep(i, n)}
                onMove={(d) => move(i, d)}
                onRemove={() => edit({ ...def, steps: steps.filter((_, j) => j !== i) })}
              />
              {i < steps.length - 1 && (
                <div className="flex justify-center">
                  <div className="h-3 w-px bg-line-strong" />
                </div>
              )}
            </div>
          ))}
          {!readOnly && (
            <AddStep
              onAdd={(t) => edit({ ...def, steps: [...steps, newStep(t, steps, menus.data ?? [])] })}
            />
          )}
        </div>
        <div className="space-y-5">
          <TestPanel workflowId={id} definition={def} trigger={def.trigger} />
          <Executions workflowId={id} />
          <Panel>
            <PanelHeader title="Versions" description="Each save creates an immutable version." />
            <ul className="divide-y divide-line">
              {wf.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between px-4 py-2 text-[12.5px]">
                  <span className="font-medium">
                    v{v.version}
                    {v.id === wf.activeVersionId && (
                      <Badge tone="accent" className="ml-2">
                        Live
                      </Badge>
                    )}
                  </span>
                  <span className="text-ink-3">{dateTime(v.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
