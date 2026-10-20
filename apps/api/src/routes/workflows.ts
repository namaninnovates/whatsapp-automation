import { Router } from 'express';
import { z } from 'zod';
import { type WorkflowDefinitionSchema, WorkflowTestSchema, WorkflowUpsertSchema } from '@wa/shared';
import { matchTrigger, runWorkflow, validateDefinition, type EngineContext } from '@wa/workflow-engine';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, badRequest, HttpError, notFound, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';
import { businessHoursOpenFor } from '../services/context';
import { createDbServices } from '../services/engineServices';
import { loadActiveWorkflows, startExecution } from '../services/executions';

export const workflowsRouter = Router();

async function getWorkflow(org: string, id: string) {
  const wf = await prisma.workflow.findFirst({
    where: { id, organizationId: org },
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  if (!wf) throw notFound('Workflow');
  return wf;
}

/** Menus and workflows referenced by a definition must belong to the same organization. */
async function assertReferences(org: string, definition: z.infer<typeof WorkflowDefinitionSchema>) {
  const menuIds = new Set<string>();
  if (definition.trigger.type === 'menu_selection') menuIds.add(definition.trigger.menuId);
  for (const s of definition.steps) if (s.type === 'send_menu') menuIds.add(s.menuId);
  if (menuIds.size) {
    const found = await prisma.menu.count({ where: { organizationId: org, id: { in: [...menuIds] } } });
    if (found !== menuIds.size) throw badRequest('The workflow references a menu that does not exist');
  }
}

workflowsRouter.get(
  '/',
  ah(async (req, res) => {
    const since = new Date(Date.now() - 30 * 864e5);
    const workflows = await prisma.workflow.findMany({
      where: { organizationId: orgId(req) },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, id: true } } },
    });
    const stats = await prisma.workflowExecution.groupBy({
      by: ['workflowId', 'status'],
      where: { organizationId: orgId(req), startedAt: { gte: since } },
      _count: { _all: true },
    });
    res.json(
      workflows.map((w) => {
        const s = stats.filter((x) => x.workflowId === w.id);
        const count = (st: string) => s.find((x) => x.status === st)?._count._all ?? 0;
        return {
          ...w,
          latestVersion: w.versions[0]?.version ?? 0,
          activeIsLatest: w.activeVersionId === w.versions[0]?.id,
          stats30d: {
            succeeded: count('SUCCEEDED') + count('HANDED_OFF'),
            failed: count('FAILED'),
            waiting: count('WAITING'),
          },
        };
      }),
    );
  }),
);

workflowsRouter.post(
  '/validate',
  ah(async (req, res) => {
    res.json(validateDefinition(req.body?.definition));
  }),
);

workflowsRouter.post(
  '/',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const input = parse(WorkflowUpsertSchema, req.body);
    await assertReferences(orgId(req), input.definition);
    const wf = await prisma.workflow.create({
      data: {
        organizationId: orgId(req),
        name: input.name,
        description: input.description,
        priority: input.priority,
        triggerType: input.definition.trigger.type,
        versions: {
          create: {
            version: 1,
            definition: input.definition as Prisma.InputJsonValue,
            createdById: req.auth!.userId,
          },
        },
      },
      include: { versions: true },
    });
    await audit({
      organizationId: wf.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.created',
      entityType: 'Workflow',
      entityId: wf.id,
      metadata: { name: wf.name },
    });
    res.status(201).json({ ...wf, validation: validateDefinition(input.definition) });
  }),
);

workflowsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    const latest = wf.versions[0];
    res.json({
      ...wf,
      versions: wf.versions.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt })),
      definition: latest?.definition,
      latestVersionId: latest?.id,
      validation: latest ? validateDefinition(latest.definition) : null,
    });
  }),
);

/** Saving always creates a new immutable version. An active workflow switches to it only if it is valid. */
workflowsRouter.put(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const input = parse(WorkflowUpsertSchema, req.body);
    const wf = await getWorkflow(orgId(req), req.params.id);
    await assertReferences(orgId(req), input.definition);
    const validation = validateDefinition(input.definition);
    const next = (wf.versions[0]?.version ?? 0) + 1;
    const version = await prisma.workflowVersion.create({
      data: {
        workflowId: wf.id,
        version: next,
        definition: input.definition as Prisma.InputJsonValue,
        createdById: req.auth!.userId,
      },
    });
    const updated = await prisma.workflow.update({
      where: { id: wf.id },
      data: {
        name: input.name,
        description: input.description,
        priority: input.priority,
        triggerType: input.definition.trigger.type,
        ...(wf.isActive && validation.ok ? { activeVersionId: version.id } : {}),
      },
    });
    await audit({
      organizationId: wf.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.saved',
      entityType: 'Workflow',
      entityId: wf.id,
      metadata: { version: next, valid: validation.ok },
    });
    res.json({
      ...updated,
      latestVersion: next,
      validation,
      activeVersionUpdated: wf.isActive && validation.ok,
    });
  }),
);

workflowsRouter.post(
  '/:id/activate',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    const latest = wf.versions[0];
    if (!latest) throw badRequest('Save the workflow before activating it');
    const validation = validateDefinition(latest.definition);
    if (!validation.ok)
      throw new HttpError(
        422,
        'invalid_workflow',
        'Fix the workflow before activating it',
        validation.errors,
      );
    const updated = await prisma.workflow.update({
      where: { id: wf.id },
      data: { isActive: true, activeVersionId: latest.id },
    });
    await audit({
      organizationId: wf.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.activated',
      entityType: 'Workflow',
      entityId: wf.id,
      metadata: { version: latest.version },
    });
    res.json(updated);
  }),
);

workflowsRouter.post(
  '/:id/deactivate',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    const updated = await prisma.workflow.update({ where: { id: wf.id }, data: { isActive: false } });
    await audit({
      organizationId: wf.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.deactivated',
      entityType: 'Workflow',
      entityId: wf.id,
    });
    res.json(updated);
  }),
);

workflowsRouter.post(
  '/:id/duplicate',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    const latest = wf.versions[0];
    const copy = await prisma.workflow.create({
      data: {
        organizationId: wf.organizationId,
        name: `${wf.name} (copy)`.slice(0, 80),
        description: wf.description,
        priority: wf.priority,
        triggerType: wf.triggerType,
        versions: latest
          ? {
              create: {
                version: 1,
                definition: latest.definition as Prisma.InputJsonValue,
                createdById: req.auth!.userId,
              },
            }
          : undefined,
      },
    });
    await audit({
      organizationId: wf.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.duplicated',
      entityType: 'Workflow',
      entityId: copy.id,
      metadata: { from: wf.id },
    });
    res.status(201).json(copy);
  }),
);

workflowsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    await prisma.workflow.delete({ where: { id: wf.id } });
    await audit({
      organizationId: wf.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.deleted',
      entityType: 'Workflow',
      entityId: wf.id,
      metadata: { name: wf.name },
    });
    res.status(204).end();
  }),
);

/**
 * Test mode: runs the same engine against a sample message with sandboxed services
 * (read-only lookups are real; writes, tags and handoffs are only reported).
 */
workflowsRouter.post(
  '/:id/test',
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    const body = parse(WorkflowTestSchema.extend({ definition: z.unknown().optional() }), req.body);
    const defSource = body.definition ?? wf.versions[0]?.definition;
    const validation = validateDefinition(defSource);
    if (!validation.definition)
      throw new HttpError(422, 'invalid_workflow', 'The workflow definition is invalid', validation.errors);
    const definition = validation.definition;
    const open = await businessHoursOpenFor(orgId(req));
    const triggerEvent = body.event
      ? ({ kind: 'event', event: body.event } as const)
      : ({
          kind: 'message',
          text: body.message,
          isNewCustomer: body.isNewCustomer,
          businessHoursOpen: open,
        } as const);
    const matched = matchTrigger(definition.trigger, triggerEvent);
    const { services, flags } = createDbServices({ orgId: orgId(req), customerId: '__test__', dryRun: true });
    let context: EngineContext = {
      message: { text: body.message },
      customer: { id: '__test__', name: body.customerName, isNew: body.isNewCustomer, tags: [] },
      businessHoursOpen: open,
      variables: {},
      event: body.event,
    };
    const runs = [];
    let r = await runWorkflow({ definition, context, services });
    runs.push({ input: body.message, ...r });
    for (const answer of body.answers) {
      if (r.status !== 'WAITING' || !r.waiting) break;
      context = { ...context, message: { text: answer }, variables: r.variables };
      r = await runWorkflow({ definition, context, services, resume: r.waiting });
      runs.push({ input: answer, ...r });
    }
    res.json({ matchedTrigger: matched, validation, runs, handoff: flags.handoff, finalStatus: r.status });
  }),
);

workflowsRouter.get(
  '/:id/executions',
  ah(async (req, res) => {
    const wf = await getWorkflow(orgId(req), req.params.id);
    const executions = await prisma.workflowExecution.findMany({
      where: { workflowId: wf.id },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        version: { select: { version: true } },
        conversation: { select: { id: true, customer: { select: { name: true, waId: true } } } },
      },
    });
    res.json(executions);
  }),
);

/** Safe retry: only failed executions, each attempt with its own idempotency key. */
workflowsRouter.post(
  '/executions/:executionId/retry',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const ex = await prisma.workflowExecution.findFirst({
      where: { id: req.params.executionId, organizationId: orgId(req) },
    });
    if (!ex) throw notFound('Execution');
    if (ex.status !== 'FAILED') throw badRequest('Only failed executions can be retried');
    if (!ex.conversationId) throw badRequest('The conversation for this execution no longer exists');
    const wf = (await loadActiveWorkflows(orgId(req))).find((w) => w.id === ex.workflowId);
    if (!wf) throw badRequest('Activate the workflow before retrying');
    const trigger = await prisma.message.findFirst({
      where: { id: ex.triggerEventId.split(':retry:')[0], organizationId: orgId(req) },
    });
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: ex.conversationId },
      include: { customer: { include: { tags: true } } },
    });
    const attempt = ex.attempt + 1;
    const r = await startExecution(wf, {
      orgId: orgId(req),
      conversationId: conv.id,
      customerId: conv.customerId,
      triggerEventId: `${ex.triggerEventId.split(':retry:')[0]}:retry:${attempt}`,
      attempt,
      context: {
        message: { text: trigger?.body ?? '' },
        customer: {
          id: conv.customerId,
          name: conv.customer.name,
          isNew: false,
          tags: conv.customer.tags.map((t) => t.name),
        },
        businessHoursOpen: await businessHoursOpenFor(orgId(req)),
        variables: {},
      },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'workflow.retried',
      entityType: 'WorkflowExecution',
      entityId: ex.id,
      metadata: { attempt },
    });
    res.json(r);
  }),
);
