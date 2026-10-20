import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitBranch,
  Info,
  ListTree,
  RotateCcw,
  Send,
  ShieldAlert,
  Shuffle,
  Smartphone,
  Sparkles,
  User,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatThread } from '../components/chat/ChatThread';
import { ConversationStatusBadge } from '../components/StatusBadges';
import {
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  PanelHeader,
  Select,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError, errorMessage } from '../lib/api';
import type { ConversationStatus, Message } from '../lib/types';
import { cn, formatPhone, shortTime } from '../lib/utils';

interface Thread {
  customer: { id: string; name: string | null; waId: string } | null;
  conversation: { id: string; status: ConversationStatus } | null;
  messages: Message[];
}
interface Outcome {
  duplicate: boolean;
  handledBy?: string;
  handedOff?: boolean;
  conversationId?: string;
}
interface Info {
  note: string;
  whatsappMode: string;
  samples: { name: string; from: string; text: string }[];
}
interface LogEntry {
  at: Date;
  text: string;
  outcome: Outcome;
}

const QUICK_TEST_PROMPTS = [
  { label: 'Welcome Menu', text: 'Hi', hint: 'Triggers interactive main menu' },
  { label: 'Keyword Reply', text: 'Do you deliver to Pune?', hint: 'Triggers Pune delivery workflow' },
  { label: 'Human Handoff', text: 'I want a refund for damaged table', hint: 'Escalates to Inbox as Needs Human' },
  { label: 'Track Order', text: 'Can you track ORD-1004?', hint: 'Triggers order tracking' },
  { label: 'Lead Qualification', text: 'I want a bulk quote for chairs', hint: 'Collects company & quantity' },
];

const handledLabel = (h?: string) => {
  if (!h) return 'Not handled';
  if (h.startsWith('workflow:')) return `Workflow · ${h.slice(9)}`;
  if (h === 'menu' || h.startsWith('menu')) return 'Interactive Menu';
  if (h.includes('assistant')) return 'AI Knowledge Assistant';
  if (h === 'human') return 'Human owns the conversation (automation silent)';
  return h.replace(/[_:]/g, ' ');
};

export function SimulatorPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const info = useQuery({ queryKey: ['sim-info'], queryFn: () => api.get<Info>('/simulator/info') });
  const [from, setFrom] = useState('+91 98100 22001');
  const [name, setName] = useState('Test Customer');
  const [text, setText] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lastExternalId, setLastExternalId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const waId = from.replace(/\D/g, '');

  const thread = useQuery({
    queryKey: ['sim-thread', waId],
    queryFn: () => api.get<Thread>(`/simulator/thread?waId=${waId}`),
    enabled: waId.length >= 8,
    refetchInterval: 5000,
  });

  const onResult = (r: Thread & { outcome: Outcome }, sent: string) => {
    qc.setQueryData(['sim-thread', r.customer?.waId ?? waId], {
      customer: r.customer,
      conversation: r.conversation,
      messages: r.messages,
    });
    setLog((l) => [{ at: new Date(), text: sent, outcome: r.outcome }, ...l].slice(0, 30));
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const send = useMutation({
    mutationFn: ({
      replay: _replay,
      ...body
    }: {
      text: string;
      interactiveReplyId?: string;
      externalId?: string;
      replay?: boolean;
    }) =>
      api.post<Thread & { outcome: Outcome }>('/simulator/messages', {
        from,
        name: name || undefined,
        ...body,
      }),
    onSuccess: (r, body) => {
      setFieldError(null);
      onResult(r, body.replay ? 'Replayed the last message id' : body.text || '[option]');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.from) setFieldError(e.fieldErrors.from);
      toast(errorMessage(e), 'error');
    },
  });

  const random = useMutation({
    mutationFn: () =>
      api.post<Thread & { outcome: Outcome; sample: { name: string; from: string; text: string } }>(
        '/simulator/random',
      ),
    onSuccess: (r) => {
      setFrom(`+${r.sample.from}`);
      setName(r.sample.name);
      onResult(r, r.sample.text);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submitWithText = (msg: string) => {
    const t = msg.trim();
    if (!t) return;
    const externalId = `sim_${crypto.randomUUID()}`;
    setLastExternalId(externalId);
    setText('');
    send.mutate({ text: t, externalId });
  };

  const submit = () => submitWithText(text);

  const t = thread.data;
  const canSend = can('AGENT');

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="WhatsApp Channel Simulator"
        description="Test how Threadline responds to customer messages in real time through your active workflows, interactive menus, and AI knowledge rules."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="accent" dot>
              Simulated Offline Sandbox
            </Badge>
            {t?.conversation && (
              <Link
                to={`/app/inbox/${t.conversation.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
              >
                Inspect in Inbox
                <ArrowRight className="size-3.5 text-slate-400" />
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-6 px-8 lg:grid-cols-[280px_minmax(0,420px)_minmax(0,1fr)]">
        {/* Left Column: Customer Settings & Scenarios */}
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Customer Identity" description="Simulate specific customer profiles" />
            <div className="space-y-3.5 p-5">
              <Field label="WhatsApp Phone Number" htmlFor="sim-from" error={fieldError ?? undefined}>
                <Input id="sim-from" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Customer Name" htmlFor="sim-name">
                <Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Preset Customer Profiles" htmlFor="sim-sample">
                <Select
                  id="sim-sample"
                  value=""
                  onChange={(e) => {
                    const s = info.data?.samples[Number(e.target.value)];
                    if (s) {
                      setFrom(`+${s.from}`);
                      setName(s.name);
                      setText(s.text);
                    }
                  }}
                >
                  <option value="">Select a scenario...</option>
                  {info.data?.samples.map((s, i) => (
                    <option key={s.from} value={i}>
                      {s.name}: “{s.text}”
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="secondary"
                className="w-full"
                icon={<Shuffle className="size-3.5 text-slate-600" />}
                disabled={!canSend}
                loading={random.isPending}
                onClick={() => random.mutate()}
              >
                Simulate Random Customer
              </Button>
            </div>
          </Panel>

          {/* Quick Click Prompts */}
          <Panel>
            <PanelHeader title="Quick Test Scenarios" description="Click any prompt to send immediately" />
            <div className="space-y-2 p-4">
              {QUICK_TEST_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={!canSend || send.isPending}
                  onClick={() => submitWithText(p.text)}
                  className="w-full text-left rounded-lg border border-line bg-slate-50/70 p-2.5 transition-all hover:bg-emerald-50/60 hover:border-emerald-600/30 group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-slate-800 group-hover:text-emerald-800">
                      {p.label}
                    </span>
                    <span className="text-[10.5px] font-mono text-emerald-700 bg-emerald-100/60 rounded px-1.5 py-0.5">
                      Send ↵
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] font-medium text-slate-600 italic">“{p.text}”</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{p.hint}</p>
                </button>
              ))}
            </div>
          </Panel>
        </div>

        {/* Center Column: Realistic Smartphone Container */}
        <div className="mx-auto w-full max-w-[400px]">
          <div className="relative overflow-hidden rounded-[36px] border-[10px] border-slate-900 bg-slate-900 shadow-2xl ring-1 ring-slate-900/10">
            {/* Phone Speaker Notch */}
            <div className="absolute top-2 left-1/2 z-20 h-4 w-28 -translate-x-1/2 rounded-full bg-slate-900 flex items-center justify-center">
              <div className="h-1.5 w-10 rounded-full bg-slate-800" />
            </div>

            {/* WhatsApp App Header */}
            <div className="flex items-center gap-3 bg-[#075e54] px-4 pt-7 pb-3 text-white shadow">
              <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-white font-bold text-[14px]">
                {name ? name[0]?.toUpperCase() : 'C'}
                <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#075e54]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold leading-tight">
                  {t?.customer?.name || name || 'Customer'}
                </p>
                <p className="text-[11px] text-emerald-100 flex items-center gap-1">
                  <span>online</span>
                  <span>•</span>
                  <span>{waId.length >= 8 ? formatPhone(waId) : 'Simulated device'}</span>
                </p>
              </div>
            </div>

            {/* WhatsApp Chat Canvas */}
            <div className="h-[480px] overflow-y-auto bg-[#efeae2] p-2">
              <ChatThread
                variant="phone"
                messages={t?.messages ?? []}
                showSender={false}
                emptyText="Send a message below or tap a Quick Scenario to test the automation."
                onSelectOption={
                  canSend ? (o) => send.mutate({ text: o.title, interactiveReplyId: o.id }) : undefined
                }
              />
            </div>

            {/* Input Bar */}
            <form
              className="flex items-center gap-2 bg-[#f0f2f5] p-2.5 border-t border-slate-300"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Input
                aria-label="Message"
                placeholder={canSend ? 'Type a message…' : 'Viewer mode: read-only'}
                disabled={!canSend}
                className="rounded-full bg-white border-none shadow-xs px-4 text-[13.5px] placeholder:text-slate-400"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                className="size-9 rounded-full p-0 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Send"
                disabled={!canSend || !text.trim()}
                loading={send.isPending}
                icon={<Send className="size-4" />}
              />
            </form>
          </div>
        </div>

        {/* Right Column: Live Pipeline Trace & Diagnostic Log */}
        <div className="space-y-5">
          {/* Active Conversation Overview */}
          <Panel>
            <PanelHeader
              title="Active Thread Status"
              description="Real-time triage status for this customer"
              actions={
                t?.conversation && (
                  <Link
                    to={`/app/inbox/${t.conversation.id}`}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Open in Inbox
                    <ExternalLink className="size-3" />
                  </Link>
                )
              }
            />
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-slate-500 font-medium">Pipeline Status:</span>
                {t?.conversation ? (
                  <ConversationStatusBadge status={t.conversation.status} />
                ) : (
                  <span className="text-[12px] text-slate-400 font-medium">Waiting for first message</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-slate-500 font-medium">Channel Delivery:</span>
                <Badge tone="accent">Simulated Instant Dispatch</Badge>
              </div>
              {lastExternalId && canSend && (
                <div className="pt-2 border-t border-line">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full text-[12px]"
                    icon={<RotateCcw className="size-3 text-slate-500" />}
                    onClick={() =>
                      send.mutate({ text: '(duplicate delivery test)', externalId: lastExternalId, replay: true })
                    }
                  >
                    Test Idempotency (Replay Message ID)
                  </Button>
                </div>
              )}
            </div>
          </Panel>

          {/* Execution Pipeline Trace */}
          <Panel>
            <PanelHeader
              title="Inbound Pipeline Trace"
              description="Resolution tree showing how each inbound message was routed"
            />
            {!log.length && (
              <div className="p-8 text-center">
                <Zap className="mx-auto size-6 text-slate-300 mb-2" />
                <p className="text-[13px] font-medium text-slate-600">No events traced yet</p>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  Send a message on the simulator to see step-by-step trigger resolution.
                </p>
              </div>
            )}
            <ul className="divide-y divide-line max-h-[440px] overflow-y-auto">
              {log.map((l, i) => (
                <li key={i} className="p-4 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-bold text-slate-900">
                      “{l.text}”
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">{shortTime(l.at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {l.outcome.duplicate ? (
                      <Badge tone="warn">Duplicate Webhook Suppressed</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
                        <Sparkles className="size-3 text-emerald-600" />
                        {handledLabel(l.outcome.handledBy)}
                      </span>
                    )}
                    {l.outcome.handedOff && (
                      <Badge tone="warn">
                        Human Escalation Triggered
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
