import { Router } from 'express';
import { MenuSchema } from '@wa/shared';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, badRequest, notFound, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';
import { renderMenu } from '../services/menus';
import { toCloudPayload } from '../services/whatsapp/transport';

export const menusRouter = Router();

const withOptions = { options: { orderBy: { position: 'asc' as const } } };

async function assertOptionTargets(org: string, input: ReturnType<typeof MenuSchema.parse>, selfId?: string) {
  for (const o of input.options) {
    if (o.actionType === 'SUBMENU') {
      if (o.actionConfig.menuId === selfId) throw badRequest(`"${o.title}" cannot open the same menu`);
      if (!(await prisma.menu.count({ where: { id: o.actionConfig.menuId, organizationId: org } })))
        throw badRequest(`"${o.title}" opens a menu that does not exist`);
    }
    if (
      o.actionType === 'RUN_WORKFLOW' &&
      !(await prisma.workflow.count({ where: { id: o.actionConfig.workflowId, organizationId: org } }))
    )
      throw badRequest(`"${o.title}" runs a workflow that does not exist`);
  }
}

menusRouter.get(
  '/',
  ah(async (req, res) => {
    const menus = await prisma.menu.findMany({
      where: { organizationId: orgId(req) },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      include: withOptions,
    });
    res.json(menus);
  }),
);

menusRouter.get(
  '/:id',
  ah(async (req, res) => {
    const menu = await prisma.menu.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: withOptions,
    });
    if (!menu) throw notFound('Menu');
    res.json(menu);
  }),
);

menusRouter.post(
  '/',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const input = parse(MenuSchema, req.body);
    await assertOptionTargets(orgId(req), input);
    const menu = await prisma.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.menu.updateMany({ where: { organizationId: orgId(req) }, data: { isDefault: false } });
      return tx.menu.create({
        data: {
          organizationId: orgId(req),
          name: input.name,
          header: input.header,
          body: input.body,
          buttonLabel: input.buttonLabel,
          isDefault: input.isDefault,
          options: {
            create: input.options.map((o, i) => ({
              position: i,
              title: o.title,
              description: o.description,
              actionType: o.actionType,
              actionConfig: o.actionConfig as Prisma.InputJsonValue,
            })),
          },
        },
        include: withOptions,
      });
    });
    await audit({
      organizationId: menu.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'menu.created',
      entityType: 'Menu',
      entityId: menu.id,
      metadata: { name: menu.name },
    });
    res.status(201).json(menu);
  }),
);

/** Replaces the menu content and options (order = array order). Published menus update immediately. */
menusRouter.put(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const input = parse(MenuSchema, req.body);
    const existing = await prisma.menu.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: withOptions,
    });
    if (!existing) throw notFound('Menu');
    await assertOptionTargets(orgId(req), input, existing.id);
    const menu = await prisma.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.menu.updateMany({
          where: { organizationId: orgId(req), id: { not: existing.id } },
          data: { isDefault: false },
        });
      const keep = input.options
        .map((o) => o.id)
        .filter((id): id is string => !!id && existing.options.some((e) => e.id === id));
      await tx.menuOption.deleteMany({ where: { menuId: existing.id, id: { notIn: keep } } });
      for (const [i, o] of input.options.entries()) {
        const data = {
          position: i,
          title: o.title,
          description: o.description,
          actionType: o.actionType,
          actionConfig: o.actionConfig as Prisma.InputJsonValue,
        };
        // Existing option ids are kept so analytics and workflow triggers stay linked.
        if (o.id && keep.includes(o.id)) await tx.menuOption.update({ where: { id: o.id }, data });
        else await tx.menuOption.create({ data: { ...data, menuId: existing.id } });
      }
      return tx.menu.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          header: input.header,
          body: input.body,
          buttonLabel: input.buttonLabel,
          isDefault: input.isDefault,
        },
        include: withOptions,
      });
    });
    await audit({
      organizationId: menu.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'menu.updated',
      entityType: 'Menu',
      entityId: menu.id,
    });
    res.json(menu);
  }),
);

for (const [path, publish] of [
  ['publish', true],
  ['unpublish', false],
] as const) {
  menusRouter.post(
    `/:id/${path}`,
    requireRole('ADMIN'),
    ah(async (req, res) => {
      const existing = await prisma.menu.findFirst({
        where: { id: req.params.id, organizationId: orgId(req) },
      });
      if (!existing) throw notFound('Menu');
      const menu = await prisma.menu.update({
        where: { id: existing.id },
        data: { isPublished: publish, ...(publish ? { publishedAt: new Date() } : {}) },
        include: withOptions,
      });
      await audit({
        organizationId: menu.organizationId,
        actorType: 'USER',
        actorId: req.auth!.userId,
        action: `menu.${path}ed`,
        entityType: 'Menu',
        entityId: menu.id,
      });
      res.json(menu);
    }),
  );
}

menusRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const existing = await prisma.menu.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('Menu');
    await prisma.menu.delete({ where: { id: existing.id } });
    await audit({
      organizationId: existing.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'menu.deleted',
      entityType: 'Menu',
      entityId: existing.id,
      metadata: { name: existing.name },
    });
    res.status(204).end();
  }),
);

/** The exact Cloud API payload this menu produces (button message for ≤3 options, list otherwise). */
menusRouter.get(
  '/:id/preview',
  ah(async (req, res) => {
    const msg = await renderMenu(orgId(req), req.params.id, { allowDraft: true });
    if (!msg) throw notFound('Menu');
    res.json({ message: msg, cloudPayload: toCloudPayload('<customer wa_id>', msg) });
  }),
);
