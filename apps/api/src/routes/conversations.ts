import { Router } from 'express';
import { ConversationListQuery, SendReplySchema, UpdateConversationSchema } from '@wa/shared';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, notFound, pageArgs, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';
import { deliver } from '../services/outbound';

export const conversationsRouter = Router();

conversationsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(ConversationListQuery, req.query);
    const where: Prisma.ConversationWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status } : {}),
      ...(q.unread === 'true' ? { unreadCount: { gt: 0 } } : {}),
      ...(q.search
        ? {
            OR: [
              { customer: { name: { contains: q.search, mode: 'insensitive' } } },
              { customer: { waId: { contains: q.search.replace(/\D/g, '') || q.search } } },
              { lastMessagePreview: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        include: { customer: { select: { id: true, name: true, waId: true } } },
        ...pageArgs(q.page, q.pageSize),
      }),
      prisma.conversation.count({ where }),
    ]);
    res.json({ data, page: q.page, pageSize: q.pageSize, total });
  }),
);

conversationsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        customer: {
          include: {
            tags: true,
            leads: { orderBy: { createdAt: 'desc' }, take: 5 },
            orders: { orderBy: { createdAt: 'desc' }, take: 5 },
            conversations: {
              select: { id: true, createdAt: true, status: true, lastMessagePreview: true },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
        executions: {
          orderBy: { startedAt: 'desc' },
          take: 10,
          include: { workflow: { select: { name: true } } },
        },
      },
    });
    if (!conv) throw notFound('Conversation');
    const messages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    res.json({ ...conv, messages });
  }),
);

conversationsRouter.post(
  '/:id/messages',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const { body } = parse(SendReplySchema, req.body);
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!conv) throw notFound('Conversation');
    // A human reply takes over the conversation; automation pauses until handed back.
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: 'NEEDS_HUMAN',
        assignedToUserId: req.auth!.userId,
        handedOffAt: conv.handedOffAt ?? new Date(),
        unreadCount: 0,
        state: { type: 'none' },
      },
    });
    const [message] = await deliver(conv.id, [{ kind: 'text', text: body }], {
      sender: 'AGENT',
      meta: { agentId: req.auth!.userId, agentName: req.auth!.name },
    });
    await audit({
      organizationId: conv.organizationId,
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'message.sent',
      entityType: 'Conversation',
      entityId: conv.id,
    });
    res.status(201).json(message);
  }),
);

conversationsRouter.patch(
  '/:id',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(UpdateConversationSchema, req.body);
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!conv) throw notFound('Conversation');
    const data: Prisma.ConversationUpdateInput = {};
    if (input.markRead) data.unreadCount = 0;
    if (input.assignToMe) data.assignedToUserId = req.auth!.userId;
    if (input.status) {
      data.status = input.status;
      if (input.status === 'RESOLVED' || input.status === 'AUTOMATED') data.state = { type: 'none' };
      if (input.status === 'NEEDS_HUMAN') data.handedOffAt = conv.handedOffAt ?? new Date();
    }
    const updated = await prisma.conversation.update({ where: { id: conv.id }, data });
    if (input.status && input.status !== conv.status) {
      await audit({
        organizationId: conv.organizationId,
        actorType: 'USER',
        actorId: req.auth!.userId,
        action: 'conversation.status_changed',
        entityType: 'Conversation',
        entityId: conv.id,
        metadata: { from: conv.status, to: input.status },
      });
    }
    res.json(updated);
  }),
);
