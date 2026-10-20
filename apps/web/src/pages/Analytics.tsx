import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Badge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Panel,
  PanelHeader,
  Segmented,
} from '../components/ui';
import { api } from '../lib/api';
import type { AnalyticsTotals, VolumePoint } from '../lib/types';
import { duration, pct } from '../lib/utils';
import { RANGE_OPTIONS, shortDate, type Range } from '../lib/insights';
import { Metric } from './Dashboard';

interface AnalyticsData {
  range: Range;
  totals: AnalyticsTotals;
  volume: VolumePoint[];
  workflows: {
    id: string;
    name: string;
    succeeded: number;
    handedOff: number;
    failed: number;
    waiting: number;
  }[];
  menuOptions: { optionId: string; title: string; menu: string; count: number }[];
  intents: { intent: string; count: number }[];
}

const axis = { tick: { fontSize: 11, fill: '#85878c' }, tickLine: false, axisLine: false } as const;
const tooltip = {
  contentStyle: { fontSize: 12, borderRadius: 6, border: '1px solid #e7e6e1' },
  cursor: { fill: '#f4f4f1' },
};
const humanIntent = (s: string) => s.replace(/[_:]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function HBars({ rows, empty }: { rows: { label: string; sub?: string; value: number }[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} className="py-8" />;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5 p-4">
      {rows.map((r) => (
        <li key={r.label + r.sub}>
          <div className="mb-1 flex justify-between text-[12.5px]">
            <span className="truncate">
              {r.label}
              {r.sub && <span className="text-ink-3"> · {r.sub}</span>}
            </span>
            <span className="tabular text-ink-2">{r.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-subtle">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsPage() {
  const [range, setRange] = useState<Range>('30d');
  const q = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => api.get<AnalyticsData>(`/analytics?range=${range}`),
  });
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Computed from stored messages, conversations and workflow runs."
        actions={<Segmented label="Date range" value={range} onChange={setRange} options={RANGE_OPTIONS} />}
      />
      {q.isLoading && <LoadingBlock rows={6} />}
      {q.error && <ErrorBlock error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <div className="space-y-5 p-6">
          <Panel className="grid grid-cols-3 divide-x divide-line max-lg:grid-cols-2 max-lg:divide-y xl:grid-cols-6">
            <Metric label="Conversations" value={d.totals.conversations} />
            <Metric
              label="Automated"
              value={d.totals.automated}
              sub={d.totals.conversations ? pct(d.totals.automated / d.totals.conversations) : undefined}
            />
            <Metric
              label="Escalation rate"
              value={pct(d.totals.escalationRate)}
              sub={`${d.totals.escalated} handed off`}
            />
            <Metric
              label="Automation success"
              value={pct(d.totals.automationSuccessRate)}
              sub={`${d.totals.executions.failed} failed runs`}
            />
            <Metric
              label="Avg first response"
              value={duration(d.totals.avgFirstResponseSeconds)}
              sub={`${d.totals.responsesMeasured} replies measured`}
            />
            <Metric label="Avg human response" value={duration(d.totals.avgHumanResponseSeconds)} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Conversations per day" description="Automated vs human-handled" />
              <div className="h-[240px] px-2 py-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.volume} margin={{ left: -18, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#ecebe6" />
                    <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axis} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip labelFormatter={(l) => shortDate(String(l))} {...tooltip} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="automated" name="Automated" stackId="a" fill="#1f8a5b" />
                    <Bar dataKey="human" name="Human" stackId="a" fill="#d39b4a" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Messages per day" description="Inbound and outbound" />
              <div className="h-[240px] px-2 py-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.volume} margin={{ left: -18, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#ecebe6" />
                    <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axis} />
                    <YAxis allowDecimals={false} {...axis} />
                    <Tooltip labelFormatter={(l) => shortDate(String(l))} {...tooltip} />
                    <Line
                      type="monotone"
                      dataKey="messages"
                      name="Messages"
                      stroke="#17181a"
                      strokeWidth={1.75}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader title="Workflow performance" />
            {d.workflows.length ? (
              <table className="w-full text-left text-[13px]">
                <thead className="border-y border-line bg-subtle/60 text-[12px] text-ink-3">
                  <tr>
                    <th className="px-4 py-2 font-medium">Workflow</th>
                    <th className="px-4 py-2 font-medium">Completed</th>
                    <th className="px-4 py-2 font-medium">Handed off</th>
                    <th className="px-4 py-2 font-medium">Waiting</th>
                    <th className="px-4 py-2 font-medium">Failed</th>
                    <th className="px-4 py-2 font-medium">Success</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular">
                  {d.workflows.map((w) => {
                    const done = w.succeeded + w.handedOff;
                    return (
                      <tr key={w.id}>
                        <td className="px-4 py-2.5 font-medium">{w.name}</td>
                        <td className="px-4 py-2.5">{w.succeeded}</td>
                        <td className="px-4 py-2.5">{w.handedOff}</td>
                        <td className="px-4 py-2.5">{w.waiting}</td>
                        <td className="px-4 py-2.5">
                          {w.failed ? <Badge tone="danger">{w.failed}</Badge> : 0}
                        </td>
                        <td className="px-4 py-2.5">
                          {pct(done + w.failed ? done / (done + w.failed) : null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No workflow runs in this period" />
            )}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Most selected menu options" />
              <HBars
                rows={d.menuOptions.map((m) => ({ label: m.title, sub: m.menu, value: m.count }))}
                empty="No menu selections yet"
              />
            </Panel>
            <Panel>
              <PanelHeader title="Common intents" description="Detected from inbound messages" />
              <HBars
                rows={d.intents.map((i) => ({ label: humanIntent(i.intent), value: i.count }))}
                empty="No intents detected yet"
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
