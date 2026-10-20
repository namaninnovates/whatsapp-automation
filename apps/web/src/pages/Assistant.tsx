import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, ShieldAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ASSISTANT_ACTIONS,
  AssistantConfigSchema,
  type AssistantAction,
  type AssistantConfig,
} from '@wa/shared';
import {
  Badge,
  Button,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Panel,
  PanelHeader,
  TagInput,
  Textarea,
  Toggle,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api, errorMessage } from '../lib/api';

interface AssistantData {
  config: AssistantConfig;
  provider: { configured: string; effective: string; model: string | null; keyConfigured: boolean };
  knowledgeCount: number;
}
interface TestReply {
  text: string;
  intent: string;
  confidence: number;
  handoff: boolean;
  provider: string;
  reason?: string;
  toolCalls: { name: string; input: Record<string, unknown>; ok: boolean; output: string }[];
}

const ACTION_INFO: Record<AssistantAction, { label: string; note: string }> = {
  search_knowledge: { label: 'Search the knowledge base', note: 'Read only' },
  check_product_availability: { label: 'Check product availability', note: 'Read only' },
  check_order_status: { label: 'Check order status', note: 'Read only' },
  create_lead: { label: 'Create a lead', note: 'Writes a lead record' },
  place_order: { label: 'Place an order', note: 'Always asks the customer to confirm' },
};

function TestConsole() {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<{ q: string; r?: TestReply; error?: string }[]>([]);
  const test = useMutation({
    mutationFn: (q: string) => api.post<TestReply>('/assistant/test', { message: q }),
    onSuccess: (r, q) => setHistory((h) => h.map((x) => (x.q === q && !x.r ? { ...x, r } : x))),
    onError: (e, q) =>
      setHistory((h) => h.map((x) => (x.q === q && !x.r ? { ...x, error: errorMessage(e) } : x))),
  });
  const send = () => {
    const q = message.trim();
    if (!q) return;
    setHistory((h) => [...h, { q }]);
    setMessage('');
    test.mutate(q);
  };
  return (
    <Panel className="flex flex-col">
      <PanelHeader
        title="Try it"
        description="Nothing is sent or saved. Write actions are described, not run."
      />
      <div className="max-h-[460px] min-h-[200px] flex-1 space-y-4 overflow-y-auto p-4">
        {!history.length && (
          <p className="text-[12.5px] text-ink-3">
            Try “What is your return policy?”, “Is the Arc floor lamp in stock?” or “I want a refund”.
          </p>
        )}
        {history.map((h, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-[#d9fdd3] px-3 py-1.5 text-[13px]">{h.q}</p>
            {h.error && <p className="text-[12.5px] text-danger">{h.error}</p>}
            {!h.r && !h.error && <p className="text-[12.5px] text-ink-3">Thinking…</p>}
            {h.r && (
              <div className="max-w-[92%] space-y-1.5">
                <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px]">
                  {h.r.text}
                </p>
                <div className="flex flex-wrap gap-1">
                  <Badge>{h.r.intent}</Badge>
                  <Badge tone={h.r.confidence >= 0.6 ? 'accent' : 'warn'}>
                    confidence {h.r.confidence.toFixed(2)}
                  </Badge>
                  {h.r.handoff && <Badge tone="warn">hands off</Badge>}
                </div>
                {h.r.reason && <p className="text-[12px] text-ink-3">{h.r.reason}</p>}
                {h.r.toolCalls.map((t, j) => (
                  <p key={j} className="flex items-start gap-1.5 text-[12px] text-ink-3">
                    <Wrench className="mt-0.5 size-3 shrink-0" />{' '}
                    <span>
                      <code>{t.name}</code> {t.ok ? '→' : 'failed:'} {t.output.slice(0, 160)}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Input
          aria-label="Test message"
          placeholder="Ask as a customer would…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button type="submit" variant="primary" icon={<Send className="size-3.5" />} loading={test.isPending}>
          Send
        </Button>
      </form>
    </Panel>
  );
}

export function AssistantPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const readOnly = !can('ADMIN');
  const q = useQuery({ queryKey: ['assistant'], queryFn: () => api.get<AssistantData>('/assistant') });
  const [cfg, setCfg] = useState<AssistantConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data && !dirty) setCfg(q.data.config);
  }, [q.data, dirty]);
  const set = <K extends keyof AssistantConfig>(k: K, v: AssistantConfig[K]) => {
    setCfg((c) => (c ? { ...c, [k]: v } : c));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (c: AssistantConfig) => api.put('/assistant', c),
    onSuccess: () => {
      toast('Assistant settings saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['assistant'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const submit = () => {
    const r = AssistantConfigSchema.safeParse(cfg);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(r.data);
  };

  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data || !cfg) return <LoadingBlock rows={6} />;
  const p = q.data.provider;

  return (
    <div>
      <PageHeader
        title="AI assistant"
        description="Answers questions from your knowledge base and runs only the actions you approve. Escalation rules always win."
        actions={
          !readOnly && (
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={submit}>
              Save changes
            </Button>
          )
        }
      />
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <fieldset disabled={readOnly} className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Bot className="size-4" /> Assistant
                </span>
              }
              description={
                p.effective === 'mock'
                  ? 'Running on the built-in deterministic mock. Set AI_PROVIDER, AI_API_KEY and AI_MODEL on the server to use a real model.'
                  : `Using ${p.effective} · ${p.model}`
              }
              actions={
                <Toggle
                  label="Assistant enabled"
                  checked={cfg.aiEnabled}
                  onChange={(v) => set('aiEnabled', v)}
                />
              }
            />
            <div className="grid gap-3 p-4">
              <Field
                label="About the business"
                hint="What you sell, where you deliver, anything the assistant should know."
                error={errors.description}
                counter={{ value: cfg.description.length, max: 2000 }}
              >
                <Textarea
                  aria-label="About the business"
                  rows={3}
                  value={cfg.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
              <Field
                label="Instructions"
                error={errors.instructions}
                counter={{ value: cfg.instructions.length, max: 4000 }}
              >
                <Textarea
                  aria-label="Instructions"
                  rows={3}
                  value={cfg.instructions}
                  onChange={(e) => set('instructions', e.target.value)}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tone" error={errors.tone}>
                  <Input aria-label="Tone" value={cfg.tone} onChange={(e) => set('tone', e.target.value)} />
                </Field>
                <Field
                  label={`Confidence threshold · ${cfg.confidenceThreshold.toFixed(2)}`}
                  hint="Below this, the assistant hands off instead of answering."
                >
                  <input
                    aria-label="Confidence threshold"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={cfg.confidenceThreshold}
                    onChange={(e) => set('confidenceThreshold', Number(e.target.value))}
                    className="accent-[var(--color-accent)]"
                  />
                </Field>
              </div>
              <Field
                label="Allowed topics"
                hint="Leave empty to allow anything covered by the knowledge base."
                htmlFor="topics"
              >
                <TagInput
                  id="topics"
                  value={cfg.topics}
                  onChange={(v) => set('topics', v)}
                  placeholder="Type and press Enter"
                />
              </Field>
            </div>
          </Panel>
          <Panel>
            <PanelHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  <ShieldAlert className="size-4" /> Escalation rules
                </span>
              }
              description="If a message contains any of these phrases, the conversation goes straight to a person. Checked before any model call."
            />
            <div className="p-4">
              <TagInput
                id="escalation"
                value={cfg.escalationRules}
                onChange={(v) => set('escalationRules', v)}
                placeholder="e.g. refund, complaint, speak to a person"
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader
              title="Approved actions"
              description="The assistant can only call these tools. Inputs are validated on the server."
            />
            <ul className="divide-y divide-line">
              {ASSISTANT_ACTIONS.map((a) => (
                <li key={a} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div>
                    <p className="text-[13.5px] font-medium">{ACTION_INFO[a].label}</p>
                    <p className="text-[12px] text-ink-3">{ACTION_INFO[a].note}</p>
                  </div>
                  <Toggle
                    label={ACTION_INFO[a].label}
                    checked={cfg.approvedActions.includes(a)}
                    onChange={(on) =>
                      set(
                        'approvedActions',
                        on ? [...cfg.approvedActions, a] : cfg.approvedActions.filter((x) => x !== a),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </Panel>
          <p className="text-[12.5px] text-ink-3">
            The assistant answers from {q.data.knowledgeCount} active knowledge entries.{' '}
            <Link to="/app/knowledge" className="font-medium text-ink-2 underline">
              Manage knowledge
            </Link>
          </p>
        </fieldset>
        <div>
          <TestConsole />
          {dirty && (
            <p className="mt-2 text-[12px] text-warn">
              Tests use the saved settings. Save first to test your changes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
