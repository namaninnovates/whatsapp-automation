import { prisma } from '../db';

export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type Range = keyof typeof RANGE_DAYS;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function rangeStart(range: Range) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (RANGE_DAYS[range] - 1));
  return d;
}

/**
 * All figures are computed from stored records (conversations, messages, executions).
 * Nothing here is estimated or hard-coded.
 */
export async function computeAnalytics(orgId: string, range: Range) {
  const since = rangeStart(range);
  const conversations = await prisma.conversation.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    select: { id: true, createdAt: true, handedOffAt: true, status: true },
  });
  const ids = conversations.map((c) => c.id);
  const outboundBySender = await prisma.message.groupBy({
    by: ['conversationId', 'senderType'],
    where: { organizationId: orgId, conversationId: { in: ids }, direction: 'OUTBOUND' },
    _count: { _all: true },
  });
  const humanConvs = new Set(
    outboundBySender.filter((m) => m.senderType === 'AGENT').map((m) => m.conversationId),
  );
  for (const c of conversations) if (c.handedOffAt) humanConvs.add(c.id);
  const botConvs = new Set(
    outboundBySender
      .filter((m) => m.senderType === 'AUTOMATION' || m.senderType === 'AI')
      .map((m) => m.conversationId),
  );
  const automated = conversations.filter((c) => botConvs.has(c.id) && !humanConvs.has(c.id)).length;
  const human = conversations.filter((c) => humanConvs.has(c.id)).length;
  const escalated = conversations.filter((c) => c.handedOffAt).length;

  // Daily series
  const days: string[] = [];
  for (let d = new Date(since); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) days.push(dayKey(d));
  const inbound = await prisma.message.findMany({
    where: { organizationId: orgId, direction: 'INBOUND', createdAt: { gte: since } },
    select: { createdAt: true, conversationId: true },
  });
  const volume = days.map((day) => ({
    date: day,
    conversations: conversations.filter((c) => dayKey(c.createdAt) === day).length,
    messages: inbound.filter((m) => dayKey(m.createdAt) === day).length,
    automated: conversations.filter(
      (c) => dayKey(c.createdAt) === day && botConvs.has(c.id) && !humanConvs.has(c.id),
    ).length,
    human: conversations.filter((c) => dayKey(c.createdAt) === day && humanConvs.has(c.id)).length,
  }));

  // Workflow outcomes
  const execs = await prisma.workflowExecution.groupBy({
    by: ['workflowId', 'status'],
    where: { organizationId: orgId, startedAt: { gte: since } },
    _count: { _all: true },
  });
  const wfNames = await prisma.workflow.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });
  const workflows = wfNames
    .map((w) => {
      const rows = execs.filter((e) => e.workflowId === w.id);
      const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
      return {
        id: w.id,
        name: w.name,
        succeeded: n('SUCCEEDED'),
        handedOff: n('HANDED_OFF'),
        failed: n('FAILED'),
        waiting: n('WAITING'),
      };
    })
    .filter((w) => w.succeeded + w.failed + w.handedOff + w.waiting > 0)
    .sort((a, b) => b.succeeded + b.failed - (a.succeeded + a.failed));
  const succeeded = workflows.reduce((s, w) => s + w.succeeded + w.handedOff, 0);
  const failed = workflows.reduce((s, w) => s + w.failed, 0);

  // Menu options and intents
  const menuSel = await prisma.message.groupBy({
    by: ['menuOptionId'],
    where: { organizationId: orgId, createdAt: { gte: since }, menuOptionId: { not: null } },
    _count: { _all: true },
  });
  const options = await prisma.menuOption.findMany({
    where: { id: { in: menuSel.map((m) => m.menuOptionId!) } },
    include: { menu: { select: { name: true } } },
  });
  const menuOptions = menuSel
    .map((m) => ({
      optionId: m.menuOptionId,
      title: options.find((o) => o.id === m.menuOptionId)?.title ?? 'Deleted option',
      menu: options.find((o) => o.id === m.menuOptionId)?.menu.name ?? '',
      count: m._count._all,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const intentRows = await prisma.message.groupBy({
    by: ['intent'],
    where: { organizationId: orgId, direction: 'INBOUND', createdAt: { gte: since }, intent: { not: null } },
    _count: { _all: true },
  });
  const intents = intentRows
    .filter((r) => r.intent && !r.intent.startsWith('menu:'))
    .map((r) => ({ intent: r.intent!, count: r._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Average first response time: inbound message → next outbound in the same conversation.
  const msgs = await prisma.message.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    select: { conversationId: true, direction: true, createdAt: true, senderType: true },
    orderBy: { createdAt: 'asc' },
    take: 20000,
  });
  const pending = new Map<string, Date>();
  const gaps: number[] = [];
  const humanGaps: number[] = [];
  for (const m of msgs) {
    if (m.direction === 'INBOUND') {
      if (!pending.has(m.conversationId)) pending.set(m.conversationId, m.createdAt);
    } else {
      const start = pending.get(m.conversationId);
      if (start) {
        const s = (m.createdAt.getTime() - start.getTime()) / 1000;
        gaps.push(s);
        if (m.senderType === 'AGENT') humanGaps.push(s);
        pending.delete(m.conversationId);
      }
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);

  return {
    range,
    since: since.toISOString(),
    totals: {
      conversations: conversations.length,
      automated,
      human,
      needsHuman: conversations.filter((c) => c.status === 'NEEDS_HUMAN').length,
      escalated,
      escalationRate: conversations.length ? escalated / conversations.length : null,
      automationSuccessRate: succeeded + failed ? succeeded / (succeeded + failed) : null,
      executions: { succeeded, failed },
      avgFirstResponseSeconds: avg(gaps),
      avgHumanResponseSeconds: avg(humanGaps),
      responsesMeasured: gaps.length,
    },
    volume,
    workflows,
    menuOptions,
    intents,
  };
}
