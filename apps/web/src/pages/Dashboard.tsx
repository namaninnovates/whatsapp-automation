import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  GitBranch,
  Inbox,
  MessageSquare,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  UserCheck,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TRIGGER_LABELS, type TriggerType } from '@wa/shared';
import { ConversationStatusBadge } from '../components/StatusBadges';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Panel,
  PanelHeader,
  Segmented,
} from '../components/ui';
import { api } from '../lib/api';
import { describeAudit, RANGE_OPTIONS, shortDate, type Range } from '../lib/insights';
import type { AnalyticsTotals, AuditEntry, ConversationSummary, VolumePoint } from '../lib/types';
import { cn, formatPhone, pct, timeAgo } from '../lib/utils';

interface DashboardData {
  isDemo: boolean;
  totals: AnalyticsTotals;
  volume: VolumePoint[];
  recentConversations: ConversationSummary[];
  activeWorkflows: {
    id: string;
    name: string;
    triggerType: TriggerType;
    stats: { succeeded: number; handedOff: number; failed: number; waiting: number } | null;
  }[];
  activity: AuditEntry[];
  failedExecutions: {
    id: string;
    workflowId: string;
    startedAt: string;
    error: string | null;
    workflow: { name: string };
  }[];
}

export function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-[12.5px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-[24px] font-bold tracking-tight text-slate-900 tabular">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  accentColor = 'emerald',
}: {
  icon: typeof MessageSquare;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accentColor?: 'emerald' | 'amber' | 'blue' | 'purple';
}) {
  const colorMap = {
    emerald: {
      bg: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
      bar: 'bg-emerald-500',
    },
    amber: {
      bg: 'bg-amber-50 text-amber-700 ring-amber-600/20',
      bar: 'bg-amber-500',
    },
    blue: {
      bg: 'bg-blue-50 text-blue-700 ring-blue-600/20',
      bar: 'bg-blue-500',
    },
    purple: {
      bg: 'bg-purple-50 text-purple-700 ring-purple-600/20',
      bar: 'bg-purple-500',
    },
  };

  const style = colorMap[accentColor];

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-xs transition-all hover:shadow-sm">
      <div className={`absolute top-0 left-0 h-1 w-full ${style.bar}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[12.5px] font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-[26px] font-bold tracking-tight text-slate-900 tabular">{value}</p>
        </div>
        <div className={`flex size-10 items-center justify-center rounded-xl ring-1 shadow-xs ${style.bg}`}>
          <Icon className="size-5" />
        </div>
      </div>
      {sub && <p className="mt-2.5 text-[12px] text-slate-500 flex items-center gap-1">{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<Range>('30d');
  const q = useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => api.get<DashboardData>(`/dashboard?range=${range}`),
    refetchInterval: 20000,
  });
  const d = q.data;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Dashboard"
        description="Monitor real-time inbound traffic, automated bot resolutions, and agent escalations across WhatsApp."
        actions={
          <div className="flex items-center gap-2.5">
            {d?.isDemo && <Badge tone="warn" dot>Demo Workspace</Badge>}
            <Segmented label="Date range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('size-3.5', q.isFetching && 'animate-spin')} />}
              onClick={() => q.refetch()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {q.isLoading && <LoadingBlock rows={6} />}
      {q.error && <ErrorBlock error={q.error} onRetry={() => q.refetch()} />}

      {d && (
        <div className="space-y-6 px-8">
          {/* Quick Action Hero Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-600/20 bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 p-6 text-white shadow-md">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-[12px] font-semibold tracking-wide uppercase text-emerald-300">
                  Channel Active & Ready
                </span>
              </div>
              <h2 className="mt-1 text-[20px] font-bold">WhatsApp Business Inbound Pipeline</h2>
              <p className="mt-1 text-[13px] text-slate-300 max-w-xl">
                Workflows and AI assistant automatically triage customer inquiries, answer queries from your knowledge base, and escalate to your team.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/app/simulator"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-slate-900 shadow hover:bg-slate-100 transition-all active:scale-98"
              >
                <Smartphone className="size-4 text-emerald-600" />
                Open WhatsApp Simulator
              </Link>
              <Link
                to="/app/automations"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-700/60 border border-emerald-500/40 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-emerald-600 transition-all active:scale-98"
              >
                <Plus className="size-4" />
                New Workflow
              </Link>
            </div>
          </div>

          {/* 4 Metric Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon={MessageSquare}
              label="Total Conversations"
              value={d.totals.conversations}
              sub={`Last ${range.replace('d', ' days')} total volume`}
              accentColor="blue"
            />
            <MetricCard
              icon={Bot}
              label="Automated by Bot"
              value={d.totals.automated}
              sub="Handled seamlessly without staff intervention"
              accentColor="emerald"
            />
            <MetricCard
              icon={UserCheck}
              label="Needs Human Agent"
              value={d.totals.needsHuman}
              sub={`${d.totals.escalated} conversations handed off to inbox`}
              accentColor="amber"
            />
            <MetricCard
              icon={Zap}
              label="Automation Rate"
              value={pct(d.totals.automationSuccessRate)}
              sub={`${d.totals.executions.succeeded} succeeded · ${d.totals.executions.failed} failed`}
              accentColor="purple"
            />
          </div>

          {/* Volume Chart */}
          <Panel>
            <PanelHeader
              title="Daily Inbound Conversation Volume"
              description="Breakdown of automated bot executions versus human agent handoffs."
              actions={
                <div className="flex items-center gap-4 text-[12px] font-medium">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="size-2.5 rounded-sm bg-emerald-600" /> Automated
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="size-2.5 rounded-sm bg-amber-500" /> Human Agent
                  </span>
                </div>
              }
            />
            <div className="h-[260px] p-4">
              {d.totals.conversations ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.volume} margin={{ left: -15, right: 10, top: 10 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={20}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      labelFormatter={(l) => shortDate(String(l))}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      }}
                      cursor={{ fill: '#f1f5f9' }}
                    />
                    <Bar dataKey="automated" name="Automated" stackId="a" fill="#059669" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="human" name="Human Agent" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="No conversations in this period" className="py-12" />
              )}
            </div>
          </Panel>

          {/* Grid: Recent Conversations & Active Workflows */}
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            {/* Recent Conversations */}
            <Panel>
              <PanelHeader
                title="Recent Customer Conversations"
                description="Live updates from customers chatting through WhatsApp."
                actions={
                  <Link
                    to="/app/inbox"
                    className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Go to Inbox
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                }
              />
              {d.recentConversations.length ? (
                <ul className="divide-y divide-line">
                  {d.recentConversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/app/inbox/${c.id}`}
                        className="group flex items-center gap-3.5 px-5 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-700 group-hover:bg-emerald-100 group-hover:text-emerald-800 transition-colors">
                          {c.customer.name ? c.customer.name[0]?.toUpperCase() : '#'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-slate-800">
                            {c.customer.name || formatPhone(c.customer.waId)}
                          </p>
                          <p className="truncate text-[12.5px] text-slate-500">{c.lastMessagePreview}</p>
                        </div>
                        <ConversationStatusBadge status={c.status} />
                        <span className="w-16 text-right text-[11.5px] text-slate-400 tabular">
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Inbox className="size-5" />} title="No conversations yet">
                  Send a test message from the simulator to see it stream here live.
                </EmptyState>
              )}
            </Panel>

            {/* Sidebar Column: Active Workflows & Activity */}
            <div className="space-y-6">
              {/* Active Workflows */}
              <Panel>
                <PanelHeader
                  title="Live Workflows"
                  description="Active automations currently handling triggers."
                  actions={
                    <Link
                      to="/app/automations"
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 hover:text-emerald-800"
                    >
                      All Workflows
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  }
                />
                {d.activeWorkflows.length ? (
                  <ul className="divide-y divide-line">
                    {d.activeWorkflows.map((w) => (
                      <li key={w.id}>
                        <Link
                          to={`/app/automations/${w.id}`}
                          className="group flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 group-hover:bg-emerald-100 transition-colors">
                            <GitBranch className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-semibold text-slate-800 group-hover:text-emerald-700 transition-colors">
                              {w.name}
                            </p>
                            <p className="text-[11.5px] text-slate-400">{TRIGGER_LABELS[w.triggerType]}</p>
                          </div>
                          <span className="text-right text-[12px] text-slate-500 tabular">
                            {w.stats ? (
                              <span className="font-semibold text-slate-700">
                                {w.stats.succeeded + w.stats.handedOff} runs
                              </span>
                            ) : (
                              '0 runs'
                            )}
                            {w.stats?.failed ? (
                              <span className="ml-1.5 font-bold text-rose-600">({w.stats.failed} err)</span>
                            ) : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="No active workflows"
                    action={
                      <Link to="/app/automations" className="text-[13px] font-semibold text-emerald-600">
                        Create one now
                      </Link>
                    }
                  />
                )}
              </Panel>

              {/* Failures if any */}
              {d.failedExecutions.length > 0 && (
                <Panel className="border-rose-300/80 bg-rose-50/20">
                  <PanelHeader
                    title={
                      <span className="inline-flex items-center gap-1.5 text-rose-700">
                        <AlertTriangle className="size-4" /> Automation Errors
                      </span>
                    }
                  />
                  <ul className="divide-y divide-rose-100">
                    {d.failedExecutions.map((f) => (
                      <li key={f.id} className="px-5 py-3">
                        <Link
                          to={`/app/automations/${f.workflowId}`}
                          className="text-[13px] font-semibold text-rose-900 hover:underline"
                        >
                          {f.workflow.name}
                        </Link>
                        <p className="truncate text-[12px] text-slate-500 mt-0.5" title={f.error ?? ''}>
                          {f.error} · {timeAgo(f.startedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {/* Audit Activity */}
              <Panel>
                <PanelHeader title="Recent Audit Stream" />
                <ul className="divide-y divide-line">
                  {d.activity.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                      <span className="truncate text-[12.5px] font-medium text-slate-700">
                        {describeAudit(a)}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400 tabular">{timeAgo(a.createdAt)}</span>
                    </li>
                  ))}
                  {!d.activity.length && (
                    <li className="px-5 py-6 text-center text-[12.5px] text-slate-400">No recent activity.</li>
                  )}
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
