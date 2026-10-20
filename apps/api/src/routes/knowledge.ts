import { Router } from 'express';
import { z } from 'zod';
import { KNOWLEDGE_CATEGORIES, KnowledgeSchema } from '@wa/shared';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, notFound, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';

export const knowledgeRouter = Router();

knowledgeRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        search: z.string().trim().max(100).optional(),
        category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
      }),
      req.query,
    );
    const where: Prisma.KnowledgeEntryWhereInput = {
      organizationId: orgId(req),
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { content: { contains: q.search, mode: 'insensitive' } },
              { keywords: { has: q.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    res.json(
      await prisma.knowledgeEntry.findMany({ where, orderBy: [{ category: 'asc' }, { title: 'asc' }] }),
    );
  }),
);

knowledgeRouter.post(
  '/',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(KnowledgeSchema, req.body);
    const entry = await prisma.knowledgeEntry.create({
      data: { ...input, keywords: input.keywords.map((k) => k.toLowerCase()), organizationId: orgId(req) },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'knowledge.created',
      entityType: 'KnowledgeEntry',
      entityId: entry.id,
      metadata: { title: entry.title },
    });
    res.status(201).json(entry);
  }),
);

knowledgeRouter.put(
  '/:id',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(KnowledgeSchema, req.body);
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('Knowledge entry');
    const entry = await prisma.knowledgeEntry.update({
      where: { id: existing.id },
      data: { ...input, keywords: input.keywords.map((k) => k.toLowerCase()) },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'knowledge.updated',
      entityType: 'KnowledgeEntry',
      entityId: entry.id,
    });
    res.json(entry);
  }),
);

knowledgeRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('Knowledge entry');
    await prisma.knowledgeEntry.delete({ where: { id: existing.id } });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'knowledge.deleted',
      entityType: 'KnowledgeEntry',
      entityId: existing.id,
      metadata: { title: existing.title },
    });
    res.status(204).end();
  }),
);
