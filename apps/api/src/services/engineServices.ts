import { formatMoney, type BusinessAction } from '@wa/shared';
import type { EngineServices, OutboundMessage } from '@wa/workflow-engine';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { runAction } from './actions';
import { assistantRespond } from './ai/assistant';
import { renderMenu } from './menus';

export interface ServiceScope {
  orgId: string;
  customerId: string;
  conversationId?: string;
  /** Test mode: no writes; read-only lookups still use real data. */
  dryRun?: boolean;
  at?: Date;
}

export interface ServiceFlags {
  handoff: boolean;
  handoffNote?: string;
  pendingToolExecutionId?: string;
  aiIntent?: string;
  aiProvider?: string;
}

export async function productList(
  orgId: string,
  category: string | undefined,
  limit: number,
  intro?: string,
): Promise<OutboundMessage> {
  const items = await prisma.product.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    take: limit,
  });
  return {
    kind: 'products',
    text:
      intro ||
      (items.length
        ? `Here are ${category ? `our ${category.toLowerCase()} products` : 'some of our products'}:`
        : 'No products are available right now.'),
    items: items.map((p) => ({
      id: p.sku,
      title: p.name,
      description: `${formatMoney(p.priceMinor, p.currency)}${p.stock > 0 ? '' : ' · out of stock'}`,
    })),
  };
}

/** Engine capabilities backed by PostgreSQL. In dry-run mode, writes are skipped. */
export function createDbServices(scope: ServiceScope): { services: EngineServices; flags: ServiceFlags } {
  const flags: ServiceFlags = { handoff: false };
  const services: EngineServices = {
    renderMenu: (menuId) => renderMenu(scope.orgId, menuId, { allowDraft: scope.dryRun }),
    listProducts: ({ category, limit, intro }) => productList(scope.orgId, category, limit, intro),
    async addTag(tag) {
      if (scope.dryRun) return;
      const t = await prisma.tag.upsert({
        where: { organizationId_name: { organizationId: scope.orgId, name: tag } },
        update: {},
        create: { organizationId: scope.orgId, name: tag },
      });
      await prisma.customer.update({
        where: { id: scope.customerId },
        data: { tags: { connect: { id: t.id } } },
      });
    },
    async assignHuman(note) {
      flags.handoff = true;
      flags.handoffNote = note;
    },
    async aiRespond({ instructions, text }) {
      const r = await assistantRespond({
        orgId: scope.orgId,
        customerId: scope.customerId,
        conversationId: scope.conversationId,
        text,
        instructions,
        dryRun: scope.dryRun,
        at: scope.at,
      });
      flags.aiIntent = r.intent;
      flags.aiProvider = r.provider;
      if (r.pendingToolExecutionId) flags.pendingToolExecutionId = r.pendingToolExecutionId;
      return { text: r.text, handoff: r.handoff };
    },
    async runAction(action: BusinessAction, params) {
      const r = await runAction(action, params, {
        orgId: scope.orgId,
        customerId: scope.customerId,
        conversationId: scope.conversationId,
        source: scope.dryRun ? 'test' : 'workflow',
        dryRun: scope.dryRun,
        at: scope.at,
      });
      if (r.requiresConfirmation && r.toolExecutionId) flags.pendingToolExecutionId = r.toolExecutionId;
      if (scope.dryRun && !r.message && r.ok)
        return { ...r, message: `[Test mode] ${action} would run with ${JSON.stringify(params)}` };
      return r;
    },
    async saveCustomerField(key, value) {
      if (scope.dryRun) return;
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: scope.customerId } });
      await prisma.customer.update({
        where: { id: c.id },
        data: {
          customFields: {
            ...(c.customFields as Record<string, unknown>),
            [key]: value,
          } as Prisma.InputJsonValue,
        },
      });
    },
  };
  return { services, flags };
}

export async function recordHandoff(
  orgId: string,
  conversationId: string,
  reason: string,
  actor: 'WORKFLOW' | 'AI' | 'SYSTEM',
  at?: Date,
) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'NEEDS_HUMAN', handedOffAt: at ?? new Date(), state: { type: 'none' } },
  });
  await audit({
    organizationId: orgId,
    actorType: actor,
    action: 'conversation.handed_off',
    entityType: 'Conversation',
    entityId: conversationId,
    metadata: { reason },
  });
}
