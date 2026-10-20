import { z } from 'zod';
import { formatMoney, type BusinessAction } from '@wa/shared';
import type { ActionResult } from '@wa/workflow-engine';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { emitBusinessEvent } from './events';

/**
 * Business actions callable by workflows and (when approved) by the assistant.
 * Inputs are validated here, on the server, regardless of who asked.
 */
const ParamSchemas = {
  check_product_availability: z.object({ query: z.string().trim().min(1).max(100) }),
  check_order_status: z.object({ orderNumber: z.string().trim().min(1).max(40) }),
  create_lead: z.object({
    interest: z.string().trim().max(200).default(''),
    details: z.string().max(2000).optional(),
    valueMinor: z.coerce.number().int().min(0).optional(),
  }),
  place_order: z.object({
    query: z.string().trim().min(1).max(100),
    quantity: z.coerce.number().int().min(1).max(50).default(1),
  }),
} satisfies Record<BusinessAction, z.ZodTypeAny>;

export interface ActionContext {
  orgId: string;
  customerId: string;
  conversationId?: string;
  source: 'workflow' | 'assistant' | 'menu' | 'test';
  /** Test mode: read-only actions run for real, write actions are only described. */
  dryRun?: boolean;
  at?: Date;
}

export interface ActionOutcome extends ActionResult {
  toolExecutionId?: string;
}

async function findProducts(orgId: string, query: string) {
  const q = query.trim();
  const singular = q.replace(/(?<=\w)s\b/g, '');
  const exact = await prisma.product.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { name: { contains: singular, mode: 'insensitive' } },
        { sku: { equals: q.toUpperCase() } },
        { category: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 5,
  });
  if (exact.length) return exact;
  // Fall back to matching any significant word ("terracotta vases" → "Terracotta vase set").
  const words = singular.split(/\s+/).filter((w) => w.length > 3);
  if (!words.length) return [];
  return prisma.product.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      OR: words.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })),
    },
    orderBy: { name: 'asc' },
    take: 5,
  });
}

const normaliseOrderNumber = (raw: string) => {
  const digits = raw.match(/\d{3,}/)?.[0];
  return digits ? `ORD-${digits}` : raw.trim().toUpperCase();
};

export async function runAction(
  action: BusinessAction,
  rawParams: Record<string, unknown>,
  ctx: ActionContext,
): Promise<ActionOutcome> {
  const schema = ParamSchemas[action];
  const parsed = schema.safeParse(rawParams);
  const record = async (
    status: 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'PENDING_CONFIRMATION',
    output: unknown,
    reason?: string,
  ) => {
    if (ctx.dryRun) return undefined;
    const row = await prisma.toolExecution.create({
      data: {
        organizationId: ctx.orgId,
        conversationId: ctx.conversationId,
        tool: action,
        input: rawParams as Prisma.InputJsonValue,
        output: (output ?? null) as Prisma.InputJsonValue,
        status,
        reason,
        resolvedAt: status === 'PENDING_CONFIRMATION' ? null : new Date(),
        ...(ctx.at ? { createdAt: ctx.at } : {}),
      },
    });
    return row.id;
  };
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    await record('REJECTED', null, reason);
    return { ok: false, error: `Invalid input for ${action}: ${reason}` };
  }
  const p = parsed.data as Record<string, unknown>;

  switch (action) {
    case 'check_product_availability': {
      const items = await findProducts(ctx.orgId, String(p.query));
      const data = {
        results: items.map((i) => ({ sku: i.sku, name: i.name, stock: i.stock, price: i.priceMinor })),
      };
      await record('SUCCEEDED', data);
      if (!items.length)
        return {
          ok: true,
          data,
          message: `I couldn't find "${p.query}" in our catalogue. Reply with another product name, or type MENU to see options.`,
        };
      const lines = items.map(
        (i) =>
          `• ${i.name} (${i.sku}) — ${formatMoney(i.priceMinor, i.currency)} — ${i.stock > 0 ? `${i.stock} in stock` : 'out of stock'}`,
      );
      return { ok: true, data, message: `Here is what I found:\n${lines.join('\n')}` };
    }
    case 'check_order_status': {
      const number = normaliseOrderNumber(String(p.orderNumber));
      // Customers can only see their own orders.
      const order = await prisma.order.findFirst({
        where: { organizationId: ctx.orgId, number, customerId: ctx.customerId },
      });
      const data = order ? { number: order.number, status: order.status } : { number, found: false };
      await record('SUCCEEDED', data);
      if (!order)
        return {
          ok: true,
          data,
          message: `I couldn't find order ${number} for this WhatsApp number. Please check the number, or type AGENT to talk to our team.`,
        };
      const label = {
        PENDING: 'received and awaiting confirmation',
        CONFIRMED: 'confirmed and being packed',
        SHIPPED: 'shipped and on its way',
        DELIVERED: 'delivered',
        CANCELLED: 'cancelled',
      }[order.status];
      return {
        ok: true,
        data,
        message: `Order ${order.number} is ${label}. Total ${formatMoney(order.totalMinor, order.currency)}.`,
      };
    }
    case 'create_lead': {
      if (ctx.dryRun) return { ok: true, data: { simulated: true, ...p }, message: undefined };
      const existing = await prisma.lead.findFirst({
        where: {
          organizationId: ctx.orgId,
          customerId: ctx.customerId,
          status: { in: ['NEW', 'QUALIFIED', 'CONTACTED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      const details = p.details ? { note: p.details } : {};
      const lead = existing
        ? await prisma.lead.update({
            where: { id: existing.id },
            data: {
              interest: String(p.interest || existing.interest),
              details: { ...(existing.details as object), ...details },
            },
          })
        : await prisma.lead.create({
            data: {
              organizationId: ctx.orgId,
              customerId: ctx.customerId,
              conversationId: ctx.conversationId,
              interest: String(p.interest ?? ''),
              details,
              valueMinor: (p.valueMinor as number | undefined) ?? null,
              ...(ctx.at ? { createdAt: ctx.at } : {}),
            },
          });
      const id = await record('SUCCEEDED', { leadId: lead.id });
      await audit({
        organizationId: ctx.orgId,
        actorType: ctx.source === 'assistant' ? 'AI' : 'WORKFLOW',
        action: existing ? 'lead.updated' : 'lead.created',
        entityType: 'Lead',
        entityId: lead.id,
        metadata: { interest: lead.interest },
      });
      if (!existing)
        await emitBusinessEvent(ctx.orgId, 'lead.created', {
          customerId: ctx.customerId,
          conversationId: ctx.conversationId,
          entityId: lead.id,
        });
      return { ok: true, data: { leadId: lead.id }, toolExecutionId: id };
    }
    case 'place_order': {
      const [product] = await findProducts(ctx.orgId, String(p.query));
      const qty = Number(p.quantity);
      if (!product) {
        await record('FAILED', null, 'Product not found');
        return {
          ok: true,
          data: { found: false },
          message: `I couldn't find "${p.query}". Reply with the product name exactly as listed.`,
        };
      }
      if (product.stock < qty) {
        await record('REJECTED', null, 'Insufficient stock');
        return {
          ok: true,
          data: { stock: product.stock },
          message: `Sorry, only ${product.stock} × ${product.name} ${product.stock === 1 ? 'is' : 'are'} in stock.`,
        };
      }
      const total = product.priceMinor * qty;
      const summary = {
        sku: product.sku,
        name: product.name,
        quantity: qty,
        totalMinor: total,
        currency: product.currency,
      };
      if (ctx.dryRun)
        return {
          ok: true,
          requiresConfirmation: true,
          data: summary,
          message: `[Test mode] Would ask the customer to confirm ${qty} × ${product.name} for ${formatMoney(total, product.currency)}.`,
        };
      // Consequential action: never executed without explicit customer confirmation.
      const id = await record('PENDING_CONFIRMATION', summary);
      return {
        ok: true,
        requiresConfirmation: true,
        toolExecutionId: id,
        data: summary,
        message: `You're about to order ${qty} × ${product.name} for ${formatMoney(total, product.currency)}.\nReply YES to confirm or NO to cancel.`,
      };
    }
  }
}

/** Executes a previously confirmed place_order request inside a transaction. */
export async function confirmPendingAction(
  orgId: string,
  toolExecutionId: string,
  customerId: string,
  accept: boolean,
  at?: Date,
): Promise<string> {
  const pending = await prisma.toolExecution.findFirst({
    where: { id: toolExecutionId, organizationId: orgId, status: 'PENDING_CONFIRMATION' },
  });
  if (!pending) return 'That request has already been handled.';
  if (!accept) {
    await prisma.toolExecution.update({
      where: { id: pending.id },
      data: { status: 'CANCELLED', resolvedAt: new Date() },
    });
    return 'No problem — the order was not placed.';
  }
  const s = pending.output as {
    sku: string;
    name: string;
    quantity: number;
    totalMinor: number;
    currency: string;
  };
  try {
    const order = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { organizationId: orgId, sku: s.sku } });
      if (!product || product.stock < s.quantity) throw new Error('Insufficient stock');
      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: s.quantity } } });
      const count = await tx.order.count({ where: { organizationId: orgId } });
      const created = await tx.order.create({
        data: {
          organizationId: orgId,
          customerId,
          number: `ORD-${1001 + count}`,
          status: 'PENDING',
          items: [{ sku: s.sku, name: s.name, quantity: s.quantity, priceMinor: product.priceMinor }],
          totalMinor: s.totalMinor,
          currency: s.currency,
          ...(at ? { createdAt: at } : {}),
        },
      });
      await tx.toolExecution.update({
        where: { id: pending.id },
        data: { status: 'SUCCEEDED', resolvedAt: new Date(), output: { ...s, orderNumber: created.number } },
      });
      await audit(
        {
          organizationId: orgId,
          actorType: 'CUSTOMER',
          actorId: customerId,
          action: 'order.placed',
          entityType: 'Order',
          entityId: created.id,
          metadata: { number: created.number, totalMinor: created.totalMinor },
        },
        tx,
      );
      return created;
    });
    await emitBusinessEvent(orgId, 'order.created', { customerId, entityId: order.id });
    return `Order ${order.number} is placed. Total ${formatMoney(order.totalMinor, order.currency)}. We'll message you when it ships.`;
  } catch {
    await prisma.toolExecution.update({
      where: { id: pending.id },
      data: { status: 'FAILED', resolvedAt: new Date(), reason: 'Stock changed before confirmation' },
    });
    return 'Sorry, that item just went out of stock, so the order was not placed.';
  }
}
