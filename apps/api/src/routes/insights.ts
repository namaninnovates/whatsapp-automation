import { Router } from 'express';
import { DateRangeQuery } from '@wa/shared';
import { prisma } from '../db';
import { ah, parse } from '../lib/http';
import { orgId } from '../middleware/auth';
import { computeAnalytics, rangeStart } from '../services/analytics';

export const dashboardRouter = Router();
export const analyticsRouter = Router();

dashboardRouter.get(
  '/',
  ah(async (req, res) => {
    const { range } = parse(DateRangeQuery, req.query);
    const org = orgId(req);
    const a = await computeAnalytics(org, range);
    const since = rangeStart(range);
    const [organization, recentConversations, activeWorkflows, activity, failedExecutions] =
      await Promise.all([
        prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { isDemo: true, name: true } }),
        prisma.conversation.findMany({
          where: { organizationId: org },
          orderBy: { lastMessageAt: 'desc' },
          take: 7,
          include: { customer: { select: { name: true, waId: true } } },
        }),
        prisma.workflow.findMany({
          where: { organizationId: org, isActive: true },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.auditLog.findMany({
          where: { organizationId: org },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.workflowExecution.findMany({
          where: { organizationId: org, status: 'FAILED', startedAt: { gte: since } },
          orderBy: { startedAt: 'desc' },
          take: 5,
          include: { workflow: { select: { name: true } } },
        }),
      ]);
    res.json({
      isDemo: organization.isDemo,
      range,
      totals: a.totals,
      volume: a.volume,
      recentConversations,
      activeWorkflows: activeWorkflows.map((w) => ({
        id: w.id,
        name: w.name,
        triggerType: w.triggerType,
        stats: a.workflows.find((x) => x.id === w.id) ?? null,
      })),
      activity,
      failedExecutions,
    });
  }),
);

analyticsRouter.get(
  '/',
  ah(async (req, res) => {
    const { range } = parse(DateRangeQuery, req.query);
    res.json(await computeAnalytics(orgId(req), range));
  }),
);
