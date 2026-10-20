import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { InviteMemberSchema, PaginationQuery, ProfileUpdateSchema, UpdateMemberSchema } from '@wa/shared';
import { config, effectiveAiProvider, whatsappCloudReady } from '../config';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { encryptionReady } from '../lib/crypto';
import { ah, badRequest, HttpError, notFound, pageArgs, parse } from '../lib/http';
import { orgId, requireRole } from '../middleware/auth';

export const settingsRouter = Router();

settingsRouter.get(
  '/profile',
  ah(async (req, res) => {
    const p = await prisma.businessProfile.findUnique({ where: { organizationId: orgId(req) } });
    if (!p) throw notFound('Business profile');
    res.json(p);
  }),
);

settingsRouter.put(
  '/profile',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const input = parse(ProfileUpdateSchema, req.body);
    const p = await prisma.businessProfile.update({
      where: { organizationId: orgId(req) },
      data: { ...input, contactEmail: input.contactEmail === '' ? null : input.contactEmail },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'profile.updated',
      entityType: 'BusinessProfile',
      entityId: p.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json(p);
  }),
);

settingsRouter.get(
  '/team',
  ah(async (req, res) => {
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: orgId(req) },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members);
  }),
);

/** Adds a member. New users get a one-time temporary password shown once to the owner. */
settingsRouter.post(
  '/team',
  requireRole('OWNER'),
  ah(async (req, res) => {
    const input = parse(InviteMemberSchema, req.body);
    let user = await prisma.user.findUnique({ where: { email: input.email } });
    let temporaryPassword: string | undefined;
    if (!user) {
      temporaryPassword = crypto.randomBytes(9).toString('base64url');
      user = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: await bcrypt.hash(temporaryPassword, 12),
        },
      });
    }
    if (
      await prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: user.id, organizationId: orgId(req) } },
      })
    ) {
      throw new HttpError(409, 'already_member', 'This person is already a member');
    }
    const m = await prisma.organizationMembership.create({
      data: { userId: user.id, organizationId: orgId(req), role: input.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'member.added',
      entityType: 'OrganizationMembership',
      entityId: m.id,
      metadata: { email: input.email, role: input.role },
    });
    res.status(201).json({ member: m, temporaryPassword });
  }),
);

async function ownersLeft(org: string, excluding: string) {
  return prisma.organizationMembership.count({
    where: { organizationId: org, role: 'OWNER', id: { not: excluding } },
  });
}

settingsRouter.patch(
  '/team/:id',
  requireRole('OWNER'),
  ah(async (req, res) => {
    const { role } = parse(UpdateMemberSchema, req.body);
    const m = await prisma.organizationMembership.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!m) throw notFound('Member');
    if (m.role === 'OWNER' && role !== 'OWNER' && !(await ownersLeft(orgId(req), m.id)))
      throw badRequest('An organization needs at least one owner');
    const updated = await prisma.organizationMembership.update({ where: { id: m.id }, data: { role } });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'member.role_changed',
      entityType: 'OrganizationMembership',
      entityId: m.id,
      metadata: { from: m.role, to: role },
    });
    res.json(updated);
  }),
);

settingsRouter.delete(
  '/team/:id',
  requireRole('OWNER'),
  ah(async (req, res) => {
    const m = await prisma.organizationMembership.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!m) throw notFound('Member');
    if (m.userId === req.auth!.userId) throw badRequest('You cannot remove yourself');
    if (m.role === 'OWNER' && !(await ownersLeft(orgId(req), m.id)))
      throw badRequest('An organization needs at least one owner');
    await prisma.organizationMembership.delete({ where: { id: m.id } });
    await audit({
      organizationId: orgId(req),
      actorType: 'USER',
      actorId: req.auth!.userId,
      action: 'member.removed',
      entityType: 'OrganizationMembership',
      entityId: m.id,
    });
    res.status(204).end();
  }),
);

const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : null);

/** Integration status and diagnostics. Secrets are never returned, only whether they are set. */
settingsRouter.get(
  '/integrations',
  ah(async (req, res) => {
    let database = { ok: true, error: null as string | null };
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      database = { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
    const lastWebhook = await prisma.webhookEvent.findFirst({
      where: { provider: 'whatsapp', organizationId: orgId(req) },
      orderBy: { receivedAt: 'desc' },
    });
    const w = config.whatsapp;
    const whatsappStatus = whatsappCloudReady()
      ? lastWebhook
        ? 'connected'
        : 'configured_unverified'
      : w.mode === 'cloud'
        ? 'incomplete'
        : 'simulated';
    res.json({
      whatsapp: {
        mode: w.mode,
        status: whatsappStatus,
        phoneNumberId: mask(w.phoneNumberId),
        businessAccountId: mask(w.businessAccountId),
        accessTokenSet: !!w.accessToken,
        appSecretSet: !!w.appSecret,
        verifyTokenSet: !!w.verifyToken,
        apiVersion: w.apiVersion,
        webhookPath: '/api/webhooks/whatsapp',
        lastWebhookAt: lastWebhook?.receivedAt ?? null,
      },
      ai: {
        configuredProvider: config.ai.provider,
        effectiveProvider: effectiveAiProvider(),
        model: config.ai.model ?? null,
        apiKeySet: !!config.ai.apiKey,
      },
      diagnostics: {
        environment: config.env,
        database,
        encryptionKeyValid: encryptionReady(),
        jwtSecretStrong: config.jwtSecret.length >= 32,
        corsOrigins: config.corsOrigins,
        nodeVersion: process.version,
      },
    });
  }),
);

settingsRouter.get(
  '/audit',
  requireRole('ADMIN'),
  ah(async (req, res) => {
    const q = parse(PaginationQuery, req.query);
    const where = { organizationId: orgId(req) };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q.page, q.pageSize) }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ data, page: q.page, pageSize: q.pageSize, total });
  }),
);
