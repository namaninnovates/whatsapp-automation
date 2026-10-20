import { Router } from 'express';
import { z } from 'zod';
import { AssistantConfigSchema } from '@wa/shared';
import { config, effectiveAiProvider } from '../config';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, notFound, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';
import { assistantRespond } from '../services/ai/assistant';

export const assistantRouter = Router();

const providerInfo = () => ({
  configured: config.ai.provider,
  effective: effectiveAiProvider(),
  model: effectiveAiProvider() === 'mock' ? 'deterministic mock' : config.ai.model,
  keyConfigured: !!config.ai.apiKey,
});

assistantRouter.get(
  '/',
  ah(async (req, res) => {
    const p = await prisma.businessProfile.findUnique({ where: { organizationId: orgId(req) } });
    if (!p) throw notFound('Business profile');
    const knowledgeCount = await prisma.knowledgeEntry.count({
      where: { organizationId: orgId(req), isActive: true },
    });
    res.json({
      config: {
        aiEnabled: p.aiEnabled,
        description: p.description,
        instructions: p.instructions,
        tone: p.tone,
        topics: p.topics,
        escalationRules: p.escalationRules,
        approvedActions: p.approvedActions,
        confidenceThreshold: p.confidenceThreshold,
      },
      provider: providerInfo(),
      knowledgeCount,
    });
  }),
);

assistantRouter.put(
  '/',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const input = parse(AssistantConfigSchema, req.body);
    const p = await prisma.businessProfile.update({ where: { organizationId: orgId(req) }, data: input });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'assistant.updated',
      entityType: 'BusinessProfile',
      entityId: p.id,
      metadata: { approvedActions: p.approvedActions, threshold: p.confidenceThreshold },
    });
    res.json({ ok: true });
  }),
);

/** Try the assistant without sending anything: write actions are described, not executed. */
assistantRouter.post(
  '/test',
  ah(async (req, res) => {
    const { message } = parse(z.object({ message: z.string().trim().min(1).max(1000) }), req.body);
    const r = await assistantRespond({
      orgId: orgId(req),
      customerId: '__test__',
      text: message,
      dryRun: true,
    });
    res.json(r);
  }),
);
