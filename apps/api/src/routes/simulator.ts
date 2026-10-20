import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { normalizeWaId, SimulatorMessageSchema } from '@wa/shared';
import { config } from '../config';
import { prisma } from '../db';
import { ah, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';
import { handleInbound } from '../services/inbound';

/**
 * Simulated WhatsApp channel. Messages go through exactly the same pipeline as
 * Cloud API webhooks (handleInbound), so workflows, menus and the assistant behave
 * identically; only delivery is simulated.
 */
export const simulatorRouter = Router();

export const SAMPLE_INBOUND = [
  { name: 'Kavya Iyer', from: '919810011001', text: 'Hi' },
  { name: 'Rohan Mehta', from: '919810011002', text: 'Do you have the Arc floor lamp in stock?' },
  { name: 'Sana Qureshi', from: '919810011003', text: 'What are your store timings?' },
  { name: 'Vikram Rao', from: '919810011004', text: 'I want a bulk order for my office' },
  { name: 'Neha Kapoor', from: '919810011005', text: 'track my order' },
  { name: 'Arjun Nair', from: '919810011006', text: 'What is your return policy?' },
  { name: 'Ishita Bose', from: '919810011007', text: 'I want a refund for a damaged item' },
  { name: 'Farhan Sheikh', from: '919810011008', text: 'Do you deliver to Pune?' },
];

const SimBody = SimulatorMessageSchema.extend({
  // Lets developers replay the same provider id to observe duplicate protection.
  externalId: z.string().max(100).optional(),
});

async function thread(org: string, waId: string) {
  const customer = await prisma.customer.findUnique({
    where: { organizationId_waId: { organizationId: org, waId } },
  });
  if (!customer) return { customer: null, conversation: null, messages: [] };
  const conversation = await prisma.conversation.findFirst({
    where: { organizationId: org, customerId: customer.id },
    orderBy: { lastMessageAt: 'desc' },
  });
  const messages = conversation
    ? await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })
    : [];
  return { customer, conversation, messages };
}

simulatorRouter.get('/info', (_req, res) => {
  res.json({
    channel: 'simulated',
    note: 'Messages are processed by the real automation pipeline; nothing is sent to WhatsApp.',
    samples: SAMPLE_INBOUND,
    whatsappMode: config.whatsapp.mode,
  });
});

simulatorRouter.get(
  '/thread',
  ah(async (req, res) => {
    const { waId } = parse(z.object({ waId: z.string().min(6).max(20) }), req.query);
    res.json(await thread(orgId(req), normalizeWaId(waId)));
  }),
);

simulatorRouter.post(
  '/messages',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const input = parse(SimBody, req.body);
    const waId = normalizeWaId(input.from);
    const outcome = await handleInbound(orgId(req), {
      waId,
      name: input.name,
      text: input.text,
      interactiveReplyId: input.interactiveReplyId,
      externalId: input.externalId ?? `sim_${crypto.randomUUID()}`,
      channel: 'SIMULATED',
    });
    res.status(outcome.duplicate ? 200 : 201).json({ outcome, ...(await thread(orgId(req), waId)) });
  }),
);

/** Simulated inbound generator: sends one sample customer message. */
simulatorRouter.post(
  '/random',
  requireRole('AGENT'),
  ah(async (req, res) => {
    const sample = SAMPLE_INBOUND[crypto.randomInt(SAMPLE_INBOUND.length)];
    const outcome = await handleInbound(orgId(req), {
      waId: sample.from,
      name: sample.name,
      text: sample.text,
      externalId: `sim_${crypto.randomUUID()}`,
      channel: 'SIMULATED',
    });
    res.status(201).json({ sample, outcome, ...(await thread(orgId(req), sample.from)) });
  }),
);
