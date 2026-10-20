import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CheckCircle2,
  GitBranch,
  Inbox as InboxIcon,
  RotateCcw,
  Search,
  Send,
  UserRoundCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatMoney, LEAD_STATUSES } from '@wa/shared';
import { ChatThread } from '../components/chat/ChatThread';
import { ConversationStatusBadge, ExecutionStatusBadge, STATUS_LABEL } from '../components/StatusBadges';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Select,
  Spinner,
  TagInput,
  Textarea,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, errorMessage } from '../lib/api';
import type {
  ConversationDetail,
  ConversationStatus,
  ConversationSummary,
  Lead,
  Order,
  Paginated,
} from '../lib/types';
import { cn, dateTime, formatPhone, initials, shortTime, timeAgo } from '../lib/utils';

const FILTERS: { value: ConversationStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'NEEDS_HUMAN', label: 'Needs human' },
  { value: 'AUTOMATED', label: 'Automated' },
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
];

function ConversationList({ activeId }: { activeId?: string }) {
  const [status, setStatus] = useState<ConversationStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(false);
  const s = useDebounced(search);
  const params = new URLSearchParams({ pageSize: '50' });
  if (status !== 'ALL') params.set('status', status);
  if (s) params.set('search', s);
  if (unread) params.set('unread', 'true');
  const q = useQuery({
    queryKey: ['conversations', status, s, unread],
    queryFn: () => api.get<Paginated<ConversationSummary>>(`/conversations?${params}`),
    refetchInterval: 6000,
  });

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="space-y-2 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-3" />
          <Input
            aria-label="Search conversations"
            placeholder="Search name, number or message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={cn(
                'h-6 rounded-[4px] px-2 text-[12px] font-medium',
                status === f.value ? 'bg-ink text-white' : 'text-ink-2 hover:bg-subtle',
              )}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={unread}
              onChange={(e) => setUnread(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />{' '}
            Unread
          </label>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isLoading && <LoadingBlock rows={6} />}
        {q.error && <ErrorBlock error={q.error} />}
        {q.data && !q.data.data.length && (
          <EmptyState icon={<InboxIcon className="size-4" />} title="No conversations match" />
        )}
        <ul>
          {q.data?.data.map((c) => (
            <li key={c.id}>
              <Link
                to={`/app/inbox/${c.id}`}
                aria-current={c.id === activeId ? 'page' : undefined}
                className={cn(
                  'block border-b border-line px-3 py-2.5 transition-colors',
                  c.id === activeId ? 'bg-subtle' : 'hover:bg-subtle/50',
                )}
              >
                <div className="flex items-center gap-2">
                  {c.unreadCount > 0 && (
                    <span
                      aria-label={`${c.unreadCount} unread`}
                      className="size-2 shrink-0 rounded-full bg-accent"
                    />
                  )}
                  <span
                    className={cn(
                      'flex-1 truncate text-[13.5px]',
                      c.unreadCount ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {c.customer.name || formatPhone(c.customer.waId)}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-3 tabular">
                    {shortTime(c.lastMessageAt)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{c.lastMessagePreview || '—'}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <ConversationStatusBadge status={c.status} />
                  {c.channel === 'SIMULATED' && <Badge tone="outline">Simulated</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function stateLabel(c: ConversationDetail) {
  const s = c.state?.type;
  if (c.status === 'NEEDS_HUMAN') return 'Paused: a team member is handling this conversation';
  if (s === 'menu') return 'Waiting for the customer to pick a menu option';
  if (s === 'workflow_wait') return 'Workflow is waiting for the customer’s answer';
  if (s === 'confirm') return 'Waiting for the customer to confirm an action (YES/NO)';
  if (c.status === 'RESOLVED') return 'Resolved; a new message reopens it';
  return 'Automation active';
}

function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [draft, setDraft] = useState('');
  const q = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`),
    refetchInterval: 4000,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['conversation', id] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
  };
  const markRead = useMutation({
    mutationFn: () => api.patch(`/conversations/${id}`, { markRead: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
  const unread = q.data?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0 && can('AGENT')) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread]);

  const send = useMutation({
    mutationFn: (body: string) => api.post(`/conversations/${id}/messages`, { body }),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const setStatus = useMutation({
    mutationFn: (status: ConversationStatus) => api.patch(`/conversations/${id}`, { status }),
    onSuccess: (_d, status) => {
      toast(`Marked as ${STATUS_LABEL[status].toLowerCase()}`);
      invalidate();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const events = useMemo(
    () =>
      (q.data?.executions ?? []).map((e) => ({
        id: `ex-${e.id}`,
        at: e.startedAt,
        node: (
          <Link
            to={`/app/automations/${e.workflowId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:border-line-strong"
            title={e.error ?? undefined}
          >
            <GitBranch className="size-3" /> {e.workflow?.name} · <ExecutionStatusBadge status={e.status} />
          </Link>
        ),
      })),
    [q.data?.executions],
  );

  if (q.isLoading)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="flex-1">
        <ErrorBlock error={q.error} />
      </div>
    );
  const c = q.data;

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">
              {c.customer.name || formatPhone(c.customer.waId)}
            </p>
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <Bot className="size-3.5" /> {stateLabel(c)}
            </p>
          </div>
          {can('AGENT') && (
            <div className="flex shrink-0 items-center gap-1.5">
              {c.status === 'NEEDS_HUMAN' && (
                <Button
                  size="sm"
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => setStatus.mutate('AUTOMATED')}
                >
                  Hand back to automation
                </Button>
              )}
              {c.status !== 'NEEDS_HUMAN' && c.status !== 'RESOLVED' && (
                <Button
                  size="sm"
                  icon={<UserRoundCheck className="size-3.5" />}
                  onClick={() => setStatus.mutate('NEEDS_HUMAN')}
                >
                  Take over
                </Button>
              )}
              {c.status !== 'RESOLVED' && (
                <Button
                  size="sm"
                  icon={<CheckCircle2 className="size-3.5" />}
                  onClick={() => setStatus.mutate('RESOLVED')}
                >
                  Resolve
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatThread messages={c.messages} events={events} />
        </div>
        {can('AGENT') ? (
          <form
            className="border-t border-line bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) send.mutate(draft.trim());
            }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="Reply"
                rows={2}
                value={draft}
                placeholder={
                  c.channel === 'SIMULATED'
                    ? 'Reply (simulated channel: not sent to WhatsApp)'
                    : 'Reply on WhatsApp'
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim())
                    send.mutate(draft.trim());
                }}
              />
              <Button
                type="submit"
                variant="primary"
                loading={send.isPending}
                disabled={!draft.trim()}
                icon={<Send className="size-3.5" />}
              >
                Send
              </Button>
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              Sending a reply pauses automation for this conversation until you hand it back. Ctrl/⌘ + Enter
              to send.
            </p>
          </form>
        ) : (
          <p className="border-t border-line bg-surface px-4 py-3 text-[12.5px] text-ink-3">
            Your role can view conversations but not reply.
          </p>
        )}
      </section>
      <CustomerPanel c={c} onChange={invalidate} />
    </>
  );
}

function CustomerPanel({ c, onChange }: { c: ConversationDetail; onChange: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const customer = c.customer;
  const [notes, setNotes] = useState(customer.notes);
  const [tags, setTags] = useState(customer.tags.map((t) => t.name));
  useEffect(() => {
    setNotes(customer.notes);
    setTags(customer.tags.map((t) => t.name));
  }, [customer.id, customer.notes, customer.tags]);
  const save = useMutation({
    mutationFn: (body: object) => api.patch(`/customers/${customer.id}`, body),
    onSuccess: () => {
      toast('Customer updated');
      onChange();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const lead = customer.leads[0] as Lead | undefined;
  const createLead = useMutation({
    mutationFn: () =>
      api.post('/leads', { customerId: customer.id, conversationId: c.id, interest: 'From conversation' }),
    onSuccess: () => {
      toast('Lead created');
      onChange();
    },
  });
  const updateLead = useMutation({
    mutationFn: (status: string) => api.patch(`/leads/${lead!.id}`, { status }),
    onSuccess: onChange,
  });
  const orderStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Order['status'] }) =>
      api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => {
      toast('Order updated; matching workflows were notified');
      onChange();
    },
  });
  const fields = Object.entries(customer.customFields ?? {});
  const dirtyTags = tags.join('|') !== customer.tags.map((t) => t.name).join('|');

  return (
    <aside
      className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface"
      aria-label="Customer details"
    >
      <div className="border-b border-line p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted text-[12px] font-semibold text-ink-2">
            {initials(customer.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{customer.name || 'Unknown'}</p>
            <p className="text-[12.5px] text-ink-3 tabular">{formatPhone(customer.waId)}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-ink-3">First seen</dt>
          <dd>{dateTime(customer.firstSeenAt)}</dd>
          <dt className="text-ink-3">Last message</dt>
          <dd>{timeAgo(customer.lastInteractionAt)}</dd>
          <dt className="text-ink-3">Status</dt>
          <dd>
            <ConversationStatusBadge status={c.status} />
          </dd>
          <dt className="text-ink-3">Channel</dt>
          <dd>{c.channel === 'SIMULATED' ? 'Simulated' : 'WhatsApp'}</dd>
        </dl>
      </div>

      <div className="space-y-3 border-b border-line p-4">
        <Field label="Tags">
          <TagInput value={tags} onChange={setTags} placeholder="Add a tag" />
        </Field>
        <Field label="Notes">
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes"
            disabled={!can('AGENT')}
          />
        </Field>
        {can('AGENT') && (dirtyTags || notes !== customer.notes) && (
          <Button
            size="sm"
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate({ notes, tags })}
          >
            Save changes
          </Button>
        )}
      </div>

      {fields.length > 0 && (
        <div className="border-b border-line p-4">
          <h3 className="mb-2 text-[12.5px] font-semibold text-ink-2">Collected details</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            {fields.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="truncate" title={String(v)}>
                  {String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="border-b border-line p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12.5px] font-semibold text-ink-2">Lead</h3>
          {!lead && can('AGENT') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => createLead.mutate()}
              loading={createLead.isPending}
            >
              Create lead
            </Button>
          )}
        </div>
        {lead ? (
          <div className="space-y-2 text-[12.5px]">
            <p className="text-ink-2">{lead.interest || 'No interest recorded'}</p>
            {lead.details && Object.keys(lead.details).length > 0 && (
              <p className="text-ink-3">{Object.values(lead.details).join(' · ')}</p>
            )}
            <Select
              aria-label="Lead status"
              value={lead.status}
              disabled={!can('AGENT')}
              onChange={(e) => updateLead.mutate(e.target.value)}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-3">No lead yet.</p>
        )}
      </div>

      <div className="border-b border-line p-4">
        <h3 className="mb-2 text-[12.5px] font-semibold text-ink-2">Orders</h3>
        {customer.orders.length ? (
          <ul className="space-y-2">
            {customer.orders.map((o) => (
              <li key={o.id} className="rounded-md border border-line p-2 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium tabular">{o.number}</span>
                  <span className="tabular">{formatMoney(o.totalMinor, o.currency)}</span>
                </div>
                <p className="truncate text-ink-3">
                  {o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
                </p>
                <Select
                  aria-label={`Status of ${o.number}`}
                  className="mt-1.5 h-7"
                  value={o.status}
                  disabled={!can('AGENT')}
                  onChange={(e) =>
                    orderStatus.mutate({ id: o.id, status: e.target.value as Order['status'] })
                  }
                >
                  {['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'].map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">No orders.</p>
        )}
      </div>

      <div className="p-4">
        <h3 className="mb-2 text-[12.5px] font-semibold text-ink-2">Automation runs</h3>
        {c.executions.length ? (
          <ul className="space-y-1.5">
            {c.executions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                <Link to={`/app/automations/${e.workflowId}`} className="truncate hover:underline">
                  {e.workflow?.name}
                </Link>
                <ExecutionStatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">No workflow runs in this conversation.</p>
        )}
      </div>
    </aside>
  );
}

export function InboxPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const first = useQuery({
    queryKey: ['conversations', 'first'],
    queryFn: () => api.get<Paginated<ConversationSummary>>('/conversations?pageSize=1'),
    enabled: !id,
  });
  useEffect(() => {
    if (!id && first.data?.data[0]) navigate(`/app/inbox/${first.data.data[0].id}`, { replace: true });
  }, [id, first.data, navigate]);

  return (
    <div className="flex h-full min-h-0">
      <ConversationList activeId={id} />
      {id ? (
        <Thread key={id} id={id} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          {first.isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              icon={<InboxIcon className="size-4" />}
              title="No conversations yet"
              action={
                <Link to="/app/simulator" className="text-[13px] font-medium text-accent-ink">
                  Open the WhatsApp simulator
                </Link>
              }
            >
              Messages from customers appear here.
            </EmptyState>
          )}
        </div>
      )}
    </div>
  );
}
