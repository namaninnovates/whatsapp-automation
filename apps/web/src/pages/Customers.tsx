import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Search, Users } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LEAD_STATUSES, formatMoney } from '@wa/shared';
import { ConversationStatusBadge } from '../components/StatusBadges';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Panel,
  Segmented,
  Select,
  TagInput,
  Textarea,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, errorMessage } from '../lib/api';
import type { ConversationStatus, Lead, Order, Tag } from '../lib/types';
import { dateTime, formatPhone, timeAgo } from '../lib/utils';

interface CustomerRow {
  id: string;
  name: string | null;
  waId: string;
  lastInteractionAt: string;
  firstSeenAt: string;
  tags: Tag[];
  leads: Lead[];
  _count: { conversations: number; orders: number };
}
interface CustomerDetail extends Omit<CustomerRow, '_count'> {
  notes: string;
  customFields: Record<string, string>;
  orders: Order[];
  conversations: {
    id: string;
    status: ConversationStatus;
    lastMessageAt: string;
    lastMessagePreview: string;
  }[];
}
type LeadRow = Lead & { customer: { id: string; name: string | null; waId: string } };

const LEAD_TONE: Record<string, 'neutral' | 'accent' | 'info' | 'warn' | 'danger'> = {
  NEW: 'info',
  QUALIFIED: 'accent',
  CONTACTED: 'neutral',
  WON: 'accent',
  LOST: 'danger',
};
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function LeadStatusSelect({ lead, disabled }: { lead: Lead; disabled?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (status: string) => api.patch(`/leads/${lead.id}`, { status }),
    onSuccess: () => {
      toast('Lead updated');
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Select
      aria-label="Lead status"
      className="h-7 w-[120px] text-[12.5px]"
      disabled={disabled || m.isPending}
      value={lead.status}
      onChange={(e) => m.mutate(e.target.value)}
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s} value={s}>
          {cap(s)}
        </option>
      ))}
    </Select>
  );
}

function CustomerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
  });
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [name, setName] = useState('');
  useEffect(() => {
    if (q.data) {
      setNotes(q.data.notes);
      setTags(q.data.tags.map((t) => t.name));
      setName(q.data.name ?? '');
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch(`/customers/${id}`, { name, notes, tags }),
    onSuccess: () => {
      toast('Customer saved');
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const c = q.data;
  return (
    <Drawer
      open
      onClose={onClose}
      title={c ? c.name || formatPhone(c.waId) : 'Customer'}
      actions={
        can('AGENT') && (
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {c && (
        <fieldset disabled={!can('AGENT')} className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 text-[12.5px]">
            <div>
              <p className="text-ink-3">WhatsApp</p>
              <p className="font-medium">{formatPhone(c.waId)}</p>
            </div>
            <div>
              <p className="text-ink-3">First seen</p>
              <p className="font-medium">{dateTime(c.firstSeenAt)}</p>
            </div>
          </div>
          <Field label="Name" htmlFor="c-name">
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Tags" htmlFor="c-tags">
            <TagInput id="c-tags" value={tags} onChange={setTags} placeholder="Add a tag" />
          </Field>
          <Field label="Notes" htmlFor="c-notes">
            <Textarea id="c-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {Object.keys(c.customFields ?? {}).length > 0 && (
            <div>
              <p className="mb-1 text-[12.5px] font-medium text-ink-2">Collected details</p>
              <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-[12.5px]">
                {Object.entries(c.customFields).map(([k, v]) => (
                  <Fragment key={k}>
                    <dt className="text-ink-3">{k}</dt>
                    <dd>{v}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          )}
          <section>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">Leads</p>
            {!c.leads.length && <p className="text-[12.5px] text-ink-3">No leads.</p>}
            <ul className="space-y-2">
              {c.leads.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px]">{l.interest || 'General enquiry'}</p>
                    <p className="text-[12px] text-ink-3">{timeAgo(l.createdAt)}</p>
                  </div>
                  <LeadStatusSelect lead={l} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">Orders</p>
            {!c.orders.length && <p className="text-[12.5px] text-ink-3">No orders.</p>}
            <ul className="space-y-1">
              {c.orders.map((o) => (
                <li key={o.id} className="flex justify-between text-[12.5px]">
                  <span className="font-medium">
                    {o.number} <span className="font-normal text-ink-3">· {cap(o.status)}</span>
                  </span>
                  <span className="tabular">{formatMoney(o.totalMinor, o.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">Conversations</p>
            <ul className="space-y-1">
              {c.conversations.map((cv) => (
                <li key={cv.id}>
                  <Link
                    to={`/app/inbox/${cv.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-subtle"
                  >
                    <span className="truncate">{cv.lastMessagePreview}</span>
                    <ConversationStatusBadge status={cv.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </fieldset>
      )}
    </Drawer>
  );
}

function LeadsTable() {
  const [status, setStatus] = useState('');
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['leads', status],
    queryFn: () => api.get<LeadRow[]>(`/leads${status ? `?status=${status}` : ''}`),
  });
  return (
    <div className="space-y-4">
      <Select
        aria-label="Lead status filter"
        className="w-[180px]"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">All statuses</option>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {cap(s)}
          </option>
        ))}
      </Select>
      {q.isLoading && <LoadingBlock />}
      {q.data && !q.data.length && (
        <Panel>
          <EmptyState title="No leads">
            Leads are created by workflows, the assistant or your team.
          </EmptyState>
        </Panel>
      )}
      {!!q.data?.length && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-subtle/60 text-[12px] text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Interest</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 font-medium">
                    {l.customer.name || formatPhone(l.customer.waId)}
                  </td>
                  <td className="max-w-[320px] truncate px-4 py-2.5 text-ink-2">{l.interest || '—'}</td>
                  <td className="px-4 py-2.5 tabular text-ink-2">
                    {l.valueMinor != null ? formatMoney(l.valueMinor, 'INR') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-ink-3">{timeAgo(l.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    <LeadStatusSelect lead={l} disabled={!can('AGENT')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

export function CustomersPage() {
  const [view, setView] = useState<'customers' | 'leads'>('customers');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { can } = useAuth();
  const s = useDebounced(search, 250);
  const filters = new URLSearchParams({
    ...(s ? { search: s } : {}),
    ...(tag ? { tag } : {}),
    ...(leadStatus ? { leadStatus } : {}),
  });
  useEffect(() => setPage(1), [s, tag, leadStatus]);
  const q = useQuery({
    queryKey: ['customers', filters.toString(), page],
    queryFn: () =>
      api.get<{ data: CustomerRow[]; total: number; page: number; pageSize: number; tags: Tag[] }>(
        `/customers?${filters.toString()}&page=${page}&pageSize=25`,
      ),
    placeholderData: (prev) => prev,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Customers & leads"
        description="Everyone who has messaged you, with tags, collected details and lead status."
        actions={
          <>
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'customers', label: 'Customers' },
                { value: 'leads', label: 'Leads' },
              ]}
            />
            {view === 'customers' && can('AGENT') && (
              <a href={api.url(`/customers/export.csv?${filters.toString()}`)} download>
                <Button icon={<Download className="size-3.5" />} tabIndex={-1}>
                  Export CSV
                </Button>
              </a>
            )}
          </>
        }
      />
      <div className="space-y-4 p-6">
        {view === 'leads' ? (
          <LeadsTable />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-[280px]">
                <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-3" />
                <Input
                  aria-label="Search customers"
                  placeholder="Name or phone number"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select
                aria-label="Tag filter"
                className="w-[160px]"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              >
                <option value="">All tags</option>
                {q.data?.tags.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Lead filter"
                className="w-[160px]"
                value={leadStatus}
                onChange={(e) => setLeadStatus(e.target.value)}
              >
                <option value="">Any lead status</option>
                {LEAD_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {cap(st)}
                  </option>
                ))}
              </Select>
            </div>
            {q.isLoading && <LoadingBlock />}
            {q.error && <ErrorBlock error={q.error} />}
            {q.data && !q.data.data.length && (
              <Panel>
                <EmptyState icon={<Users className="size-4" />} title="No customers found">
                  Customers appear when they send their first message.
                </EmptyState>
              </Panel>
            )}
            {!!q.data?.data.length && (
              <Panel className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-line bg-subtle/60 text-[12px] text-ink-3">
                    <tr>
                      <th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Tags</th>
                      <th className="px-4 py-2 font-medium">Lead</th>
                      <th className="px-4 py-2 font-medium">Conversations</th>
                      <th className="px-4 py-2 font-medium">Last interaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {q.data.data.map((c) => (
                      <tr
                        key={c.id}
                        className="cursor-pointer hover:bg-subtle/40"
                        onClick={() => setOpen(c.id)}
                      >
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            className="text-left font-medium hover:underline"
                            onClick={() => setOpen(c.id)}
                          >
                            {c.name || 'Unknown'}
                          </button>
                          <p className="text-[12px] text-ink-3">{formatPhone(c.waId)}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {c.tags.map((t) => (
                              <Badge key={t.id}>{t.name}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {c.leads[0] ? (
                            <Badge tone={LEAD_TONE[c.leads[0].status]}>{cap(c.leads[0].status)}</Badge>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular text-ink-2">
                          {c._count.conversations}
                          {c._count.orders > 0 && (
                            <span className="text-ink-3"> · {c._count.orders} orders</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-ink-3">{timeAgo(c.lastInteractionAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12.5px] text-ink-3">
                  <span>{q.data.total} customers</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      Previous
                    </Button>
                    <span className="tabular">
                      {page} / {pages}
                    </span>
                    <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              </Panel>
            )}
          </>
        )}
      </div>
      {open && <CustomerDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
