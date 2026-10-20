import { Router } from 'express';
import { z } from 'zod';
import {
  CustomerUpdateSchema,
  LEAD_STATUSES,
  LeadUpdateSchema,
  LeadUpsertSchema,
  PaginationQuery,
} from '@wa/shared';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, badRequest, notFound, pageArgs, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';
import { emitBusinessEvent } from '../services/events';

export const customersRouter = Router();
export const leadsRouter = Router();
export const catalogRouter = Router();

const CustomerQuery = PaginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  leadStatus: z.enum(LEAD_STATUSES).optional(),
});

function customerWhere(org: string, q: z.infer<typeof CustomerQuery>): Prisma.CustomerWhereInput {
  const digits = q.search?.replace(/\D/g, '');
  return {
    organizationId: org,
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            ...(digits ? [{ waId: { contains: digits } }] : []),
          ],
        }
      : {}),
    ...(q.tag ? { tags: { some: { name: q.tag } } } : {}),
    ...(q.leadStatus ? { leads: { some: { status: q.leadStatus } } } : {}),
  };
}

customersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(CustomerQuery, req.query);
    const where = customerWhere(orgId(req), q);
    const [rows, total, tags] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { lastInteractionAt: 'desc' },
        include: {
          tags: true,
          leads: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { conversations: true, orders: true } },
        },
        ...pageArgs(q.page, q.pageSize),
      }),
      prisma.customer.count({ where }),
      prisma.tag.findMany({ where: { organizationId: orgId(req) }, orderBy: { name: 'asc' } }),
    ]);
    res.json({ data: rows, page: q.page, pageSize: q.pageSize, total, tags });
  }),
);

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

customersRouter.get(
  '/export.csv',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const q = parse(CustomerQuery.omit({ page: true, pageSize: true }), req.query);
    const rows = await prisma.customer.findMany({
      where: customerWhere(orgId(req), { ...q, page: 1, pageSize: 1 }),
      orderBy: { lastInteractionAt: 'desc' },
      take: 10000,
      include: { tags: true, leads: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const header = [
      'name',
      'whatsapp_number',
      'tags',
      'lead_status',
      'lead_interest',
      'last_interaction',
      'first_seen',
      'notes',
      'custom_fields',
    ];
    const lines = rows.map((c) =>
      [
        c.name,
        `+${c.waId}`,
        c.tags.map((t) => t.name).join('; '),
        c.leads[0]?.status ?? '',
        c.leads[0]?.interest ?? '',
        c.lastInteractionAt.toISOString(),
        c.firstSeenAt.toISOString(),
        c.notes,
        JSON.stringify(c.customFields),
      ]
        .map(csvCell)
        .join(','),
    );
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'customers.exported',
      entityType: 'Customer',
      metadata: { count: rows.length },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send([header.join(','), ...lines].join('\n'));
  }),
);

customersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const c = await prisma.customer.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        tags: true,
        leads: { orderBy: { createdAt: 'desc' } },
        orders: { orderBy: { createdAt: 'desc' } },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          include: { messages: { orderBy: { createdAt: 'desc' }, take: 5 } },
        },
      },
    });
    if (!c) throw notFound('Customer');
    res.json(c);
  }),
);

customersRouter.patch(
  '/:id',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(CustomerUpdateSchema, req.body);
    const c = await prisma.customer.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!c) throw notFound('Customer');
    let tagOps = {};
    if (input.tags) {
      const tags = await Promise.all(
        input.tags.map((name) =>
          prisma.tag.upsert({
            where: { organizationId_name: { organizationId: orgId(req), name } },
            update: {},
            create: { organizationId: orgId(req), name },
          }),
        ),
      );
      tagOps = { tags: { set: tags.map((t) => ({ id: t.id })) } };
    }
    const updated = await prisma.customer.update({
      where: { id: c.id },
      data: {
        ...(input.name !== undefined ? { name: input.name || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.customFields ? { customFields: input.customFields } : {}),
        ...tagOps,
      },
      include: { tags: true },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'customer.updated',
      entityType: 'Customer',
      entityId: c.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json(updated);
  }),
);

leadsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(z.object({ status: z.enum(LEAD_STATUSES).optional() }), req.query);
    res.json(
      await prisma.lead.findMany({
        where: { organizationId: orgId(req), ...(q.status ? { status: q.status } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        include: { customer: { select: { id: true, name: true, waId: true } } },
      }),
    );
  }),
);

leadsRouter.post(
  '/',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(LeadUpsertSchema, req.body);
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: orgId(req) },
    });
    if (!customer) throw notFound('Customer');
    if (
      input.conversationId &&
      !(await prisma.conversation.count({ where: { id: input.conversationId, organizationId: orgId(req) } }))
    )
      throw badRequest('Unknown conversation');
    const lead = await prisma.lead.create({
      data: {
        ...input,
        valueMinor: input.valueMinor ?? null,
        organizationId: orgId(req),
        source: 'dashboard',
      },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'lead.created',
      entityType: 'Lead',
      entityId: lead.id,
    });
    await emitBusinessEvent(orgId(req), 'lead.created', {
      customerId: customer.id,
      conversationId: input.conversationId,
      entityId: lead.id,
    });
    res.status(201).json(lead);
  }),
);

leadsRouter.patch(
  '/:id',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(LeadUpdateSchema, req.body);
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!lead) throw notFound('Lead');
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { ...input, conversationId: undefined },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'lead.updated',
      entityType: 'Lead',
      entityId: lead.id,
      metadata: { status: updated.status },
    });
    res.json(updated);
  }),
);

catalogRouter.get(
  '/products',
  ah(async (req, res) => {
    res.json(
      await prisma.product.findMany({
        where: { organizationId: orgId(req) },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
    );
  }),
);

catalogRouter.patch(
  '/orders/:id/status',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const { status } = parse(
      z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']) }),
      req.body,
    );
    const order = await prisma.order.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!order) throw notFound('Order');
    const updated = await prisma.order.update({ where: { id: order.id }, data: { status } });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'order.status_changed',
      entityType: 'Order',
      entityId: order.id,
      metadata: { from: order.status, to: status },
    });
    await emitBusinessEvent(orgId(req), 'order.status_changed', {
      customerId: order.customerId,
      entityId: `${order.id}:${status}`,
      variables: { orderNumber: order.number, orderStatus: status.toLowerCase() },
    });
    res.json(updated);
  }),
);
