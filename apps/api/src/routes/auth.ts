import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { LoginSchema, SignupSchema } from '@wa/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { ah, HttpError, parse } from '../lib/http';
import { DEFAULT_HOURS } from '../lib/hours';
import { clearSession, issueSession, requireAuth } from '../middleware/auth';

export const authRouter = Router();

// Used to keep login timing similar when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'business';

authRouter.post(
  '/signup',
  ah(async (req, res) => {
    const input = parse(SignupSchema, req.body);
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw new HttpError(409, 'email_taken', 'An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const base = slugify(input.businessName);
    const slug = (await prisma.organization.findUnique({ where: { slug: base } }))
      ? `${base}-${Date.now().toString(36)}`
      : base;
    const { user, org } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
      const org = await tx.organization.create({ data: { name: input.businessName, slug } });
      await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: org.id, role: 'OWNER' },
      });
      await tx.businessProfile.create({
        data: {
          organizationId: org.id,
          displayName: input.businessName,
          topics: [],
          escalationRules: ['refund', 'complaint', 'speak to a human', 'agent'],
          approvedActions: ['search_knowledge', 'check_product_availability', 'check_order_status'],
          businessHours: DEFAULT_HOURS,
          notificationPrefs: { emailOnHandoff: true, emailDailySummary: false, notifyOnFailedWorkflow: true },
        },
      });
      await audit(
        {
          organizationId: org.id,
          actorType: 'USER',
          actorId: user.id,
          action: 'organization.created',
          entityType: 'Organization',
          entityId: org.id,
        },
        tx,
      );
      return { user, org };
    });
    issueSession(res, user.id, org.id);
    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: org.id, name: org.name, slug: org.slug },
      role: 'OWNER',
    });
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const input = parse(LoginSchema, req.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } } },
    });
    // Same error and similar timing whether or not the user exists.
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.memberships.length)
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    const m = user.memberships[0];
    issueSession(res, user.id, m.organizationId);
    await audit({
      organizationId: m.organizationId,
      actorType: 'USER',
      actorId: user.id,
      action: 'user.signed_in',
      entityType: 'User',
      entityId: user.id,
    });
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      organization: {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        isDemo: m.organization.isDemo,
      },
      role: m.role,
    });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.auth!.orgId } });
    res.json({
      user: { id: req.auth!.userId, name: req.auth!.name, email: req.auth!.email },
      organization: { id: org.id, name: org.name, slug: org.slug, isDemo: org.isDemo },
      role: req.auth!.role,
    });
  }),
);
