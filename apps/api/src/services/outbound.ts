import type { OutboundMessage } from '@wa/workflow-engine';
import { prisma, type Prisma } from '../db';
import { transportFor } from './whatsapp/transport';

export type SenderKind = 'AUTOMATION' | 'AI' | 'AGENT' | 'SYSTEM';

/** Plain-text rendering used for the inbox, previews and channels without interactive support. */
export function renderText(m: OutboundMessage): string {
  if (m.kind === 'text') return m.text;
  if (m.kind === 'products')
    return [
      m.text,
      ...m.items.map((it, i) => `${i + 1}. ${it.title}${it.description ? ` — ${it.description}` : ''}`),
    ].join('\n');
  return [m.header, m.body, '', ...m.options.map((o, i) => `${i + 1}. ${o.title}`)]
    .filter((x) => x !== undefined)
    .join('\n');
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SEND_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

interface DeliverOptions {
  sender: SenderKind;
  executionId?: string;
  intent?: string;
  meta?: Record<string, unknown>;
  at?: Date;
}

/**
 * Persists outbound messages, sends them through the conversation's transport and
 * records delivery status. Returns the stored message rows.
 */
export async function deliver(conversationId: string, messages: OutboundMessage[], opts: DeliverOptions) {
  if (!messages.length) return [];
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { customer: true },
  });
  const transport = transportFor(conv.channel);
  const stored = [];
  let menuId: string | null = null;
  let offset = 0;
  for (const m of messages) {
    const createdAt = opts.at ? new Date(opts.at.getTime() + 1000 + offset++ * 400) : undefined;
    const row = await prisma.message.create({
      data: {
        organizationId: conv.organizationId,
        conversationId,
        direction: 'OUTBOUND',
        senderType: opts.sender,
        body: renderText(m),
        kind: m.kind,
        payload: { ...(m as object), ...(opts.meta ?? {}) } as Prisma.InputJsonValue,
        status: 'QUEUED',
        executionId: opts.executionId,
        intent: opts.intent,
        ...(createdAt ? { createdAt } : {}),
      },
    });
    if (m.kind === 'menu') menuId = m.menuId;

    let status: 'SENT' | 'DELIVERED' | 'FAILED' = 'FAILED';
    let externalId: string | undefined;
    let error: string | undefined;
    const lastInbound = conv.lastInboundAt?.getTime() ?? 0;
    if (!transport) {
      error = 'WhatsApp Cloud API is not configured. Set WHATSAPP_MODE=cloud and the credentials in .env.';
    } else if (conv.channel === 'WHATSAPP' && Date.now() - lastInbound > WINDOW_MS) {
      error = 'Outside the 24-hour customer service window. Free-form messages need an approved template.';
    } else {
      // Transient Cloud API failures (rate limits, 5xx) are retried with exponential backoff.
      let r = await transport.send(conv.customer.waId, m);
      for (let attempt = 1; r.status === 'FAILED' && r.retryable && attempt < SEND_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** (attempt - 1)));
        r = await transport.send(conv.customer.waId, m);
      }
      status = r.status;
      externalId = r.externalId;
      error = r.error;
    }
    stored.push(
      await prisma.message.update({
        where: { id: row.id },
        data: { status, externalId, error },
      }),
    );
  }
  const last = stored[stored.length - 1];
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: last.createdAt,
      lastMessagePreview: last.body.slice(0, 140),
      // An outbound menu waits for the customer's selection.
      ...(menuId ? { state: { type: 'menu', menuId } } : {}),
    },
  });
  return stored;
}
