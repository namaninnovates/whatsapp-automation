import { normalizeWaId } from '@wa/shared';
import { selectWorkflow, type EngineContext, type WaitingState } from '@wa/workflow-engine';
import { prisma, type Prisma } from '../db';
import { isUniqueViolation } from '../lib/http';
import { logger } from '../logger';
import { confirmPendingAction } from './actions';
import { assistantRespond } from './ai/assistant';
import { businessHoursOpenFor } from './context';
import { productList, recordHandoff } from './engineServices';
import { loadActiveWorkflows, resumeExecution, startExecution } from './executions';
import { renderMenu, resolveMenuSelection } from './menus';
import { deliver } from './outbound';

export interface InboundInput {
  waId: string;
  name?: string;
  text: string;
  interactiveReplyId?: string;
  /** Provider message id (wamid for WhatsApp). Used for idempotency. */
  externalId: string;
  channel: 'SIMULATED' | 'WHATSAPP';
  /** Backdated timestamp, used by the seed script to replay history. */
  at?: Date;
}

export type InboundOutcome =
  | { duplicate: true }
  | { duplicate: false; conversationId: string; customerId: string; handledBy: string; handedOff: boolean };

type ConvState =
  | { type: 'none' }
  | { type: 'menu'; menuId: string }
  | { type: 'workflow_wait'; executionId: string; waiting: WaitingState }
  | { type: 'confirm'; toolExecutionId: string };

/**
 * The single entry point for every customer message, real or simulated:
 * idempotency → customer/conversation → pending state → workflows → assistant → default menu.
 */
export async function handleInbound(orgId: string, input: InboundInput): Promise<InboundOutcome> {
  const waId = normalizeWaId(input.waId);
  const at = input.at;
  const text = input.text.trim();

  // 1. Idempotency: a provider message id is processed at most once.
  try {
    await prisma.webhookEvent.create({
      data: {
        organizationId: orgId,
        provider: input.channel === 'WHATSAPP' ? 'whatsapp' : 'simulator',
        externalId: input.externalId,
        kind: 'message',
        payload: {
          waId,
          text,
          interactiveReplyId: input.interactiveReplyId ?? null,
        } as Prisma.InputJsonValue,
        ...(at ? { receivedAt: at } : {}),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { duplicate: true };
    throw e;
  }

  // 2. Customer, conversation and the inbound message, atomically.
  const { customer, conversation, isNew, message } = await prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findUnique({
      where: { organizationId_waId: { organizationId: orgId, waId } },
    });
    const now = at ?? new Date();
    const customer = existing
      ? await tx.customer.update({
          where: { id: existing.id },
          data: { lastInteractionAt: now, ...(input.name && !existing.name ? { name: input.name } : {}) },
        })
      : await tx.customer.create({
          data: {
            organizationId: orgId,
            waId,
            name: input.name ?? null,
            firstSeenAt: now,
            lastInteractionAt: now,
            createdAt: now,
          },
        });
    let conversation = await tx.conversation.findFirst({
      where: { organizationId: orgId, customerId: customer.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          organizationId: orgId,
          customerId: customer.id,
          channel: input.channel,
          createdAt: now,
          lastMessageAt: now,
        },
      });
    } else if (conversation.status === 'RESOLVED') {
      conversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN', state: { type: 'none' } },
      });
    }
    const message = await tx.message.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        body: text || (input.interactiveReplyId ? '[Selected an option]' : '[Unsupported message]'),
        status: 'RECEIVED',
        externalId: input.externalId,
        payload: input.interactiveReplyId ? { interactiveReplyId: input.interactiveReplyId } : undefined,
        createdAt: now,
      },
    });
    conversation = await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastInboundAt: now,
        lastMessagePreview: message.body.slice(0, 140),
        unreadCount: { increment: 1 },
      },
    });
    return { customer, conversation, isNew: !existing, message };
  });

  const done = (handledBy: string, handedOff = false): InboundOutcome => ({
    duplicate: false,
    conversationId: conversation.id,
    customerId: customer.id,
    handledBy,
    handedOff,
  });

  // 3. A human owns the conversation: automation stays quiet.
  if (conversation.status === 'NEEDS_HUMAN') return done('human');

  const tags = (await prisma.tag.findMany({ where: { customers: { some: { id: customer.id } } } })).map(
    (t) => t.name,
  );
  const businessHoursOpen = await businessHoursOpenFor(orgId, at ?? new Date());
  const context: EngineContext = {
    message: { text, interactiveReplyId: input.interactiveReplyId },
    customer: { id: customer.id, name: customer.name, isNew, tags },
    businessHoursOpen,
    variables: {},
  };
  const runArgs = { orgId, conversationId: conversation.id, customerId: customer.id, context, at };
  const state = (conversation.state ?? { type: 'none' }) as ConvState;

  try {
    // 4a. Waiting for an answer to a workflow question.
    if (state.type === 'workflow_wait') {
      const r = await resumeExecution(state.executionId, state.waiting, runArgs);
      if (r) return done('workflow');
    }

    // 4b. Waiting for YES/NO on a consequential action.
    if (state.type === 'confirm') {
      const yes = /^(yes|y|confirm|ok|okay|haan|ha)\b/i.test(text);
      const no = /^(no|n|cancel|stop)\b/i.test(text);
      if (yes || no) {
        const reply = await confirmPendingAction(orgId, state.toolExecutionId, customer.id, yes, at);
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { state: { type: 'none' } },
        });
        await deliver(conversation.id, [{ kind: 'text', text: reply }], {
          sender: 'AUTOMATION',
          at,
          intent: 'confirmation',
        });
        await markAutomated(conversation.id);
        return done('confirmation');
      }
      await deliver(
        conversation.id,
        [{ kind: 'text', text: 'Please reply YES to confirm or NO to cancel.' }],
        { sender: 'AUTOMATION', at },
      );
      return done('confirmation');
    }

    const workflows = await loadActiveWorkflows(orgId);

    // 4c. Menu selection.
    if (state.type === 'menu') {
      const sel = await resolveMenuSelection(orgId, state.menuId, text, input.interactiveReplyId);
      if (sel) {
        await prisma.message.update({
          where: { id: message.id },
          data: { menuOptionId: sel.option.id, intent: `menu:${sel.option.title}` },
        });
        const handled = await runMenuOption(orgId, sel, workflows, runArgs, message.id);
        await markAutomated(conversation.id);
        return done(handled.by, handled.handedOff);
      }
    }

    // 5. Workflow triggers (most specific wins).
    const wf = selectWorkflow(workflows, { kind: 'message', text, isNewCustomer: isNew, businessHoursOpen });
    if (wf) {
      const r = await startExecution(wf, { ...runArgs, triggerEventId: message.id });
      if (!r.duplicate) {
        await markAutomated(conversation.id);
        return done(`workflow:${wf.name}`, r.handedOff);
      }
    }

    // 6. Assistant fallback, then default menu.
    const profile = await prisma.businessProfile.findUnique({ where: { organizationId: orgId } });
    if (profile?.aiEnabled && text) {
      const ai = await assistantRespond({
        orgId,
        customerId: customer.id,
        conversationId: conversation.id,
        text,
        at,
      });
      await prisma.message.update({ where: { id: message.id }, data: { intent: ai.intent } });
      await deliver(conversation.id, [{ kind: 'text', text: ai.text }], {
        sender: 'AI',
        at,
        intent: ai.intent,
        meta: { aiProvider: ai.provider, confidence: ai.confidence, tools: ai.toolCalls.map((t) => t.name) },
      });
      if (ai.pendingToolExecutionId)
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { state: { type: 'confirm', toolExecutionId: ai.pendingToolExecutionId } },
        });
      if (ai.handoff) {
        await recordHandoff(orgId, conversation.id, ai.reason ?? 'Assistant escalated', 'AI', at);
        return done('assistant', true);
      }
      await markAutomated(conversation.id);
      return done('assistant');
    }
    const def = await prisma.menu.findFirst({
      where: { organizationId: orgId, isDefault: true, isPublished: true },
    });
    if (def) {
      const menu = await renderMenu(orgId, def.id);
      if (menu) {
        await deliver(conversation.id, [menu], { sender: 'AUTOMATION', at });
        await markAutomated(conversation.id);
        return done('default_menu');
      }
    }
    return done('none');
  } catch (e) {
    logger.error({ err: e, conversationId: conversation.id }, 'Inbound automation failed');
    await recordHandoff(orgId, conversation.id, 'Automation error', 'SYSTEM', at);
    return done('error', true);
  }
}

async function markAutomated(conversationId: string) {
  await prisma.conversation.updateMany({
    where: { id: conversationId, status: 'OPEN' },
    data: { status: 'AUTOMATED' },
  });
}

/** Executes the configured action of a selected menu option. */
async function runMenuOption(
  orgId: string,
  sel: NonNullable<Awaited<ReturnType<typeof resolveMenuSelection>>>,
  workflows: Awaited<ReturnType<typeof loadActiveWorkflows>>,
  args: { orgId: string; conversationId: string; customerId: string; context: EngineContext; at?: Date },
  triggerEventId: string,
): Promise<{ by: string; handedOff: boolean }> {
  const { option, menu } = sel;
  const cfg = option.actionConfig as Record<string, string | undefined>;
  // Workflows listening for this specific selection run in addition to RUN_WORKFLOW options.
  const listening = selectWorkflow(workflows, {
    kind: 'message',
    text: args.context.message.text,
    isNewCustomer: false,
    businessHoursOpen: args.context.businessHoursOpen,
    menuSelection: { menuId: menu.id, optionId: option.id },
  });
  const target =
    option.actionType === 'RUN_WORKFLOW'
      ? workflows.find((w) => w.id === cfg.workflowId)
      : listening?.trigger.type === 'menu_selection'
        ? listening
        : undefined;
  if (target) {
    const r = await startExecution(target, { ...args, triggerEventId });
    return { by: `workflow:${target.name}`, handedOff: !r.duplicate && r.handedOff };
  }
  await prisma.conversation.update({ where: { id: args.conversationId }, data: { state: { type: 'none' } } });
  switch (option.actionType) {
    case 'REPLY':
      await deliver(args.conversationId, [{ kind: 'text', text: cfg.text ?? '' }], {
        sender: 'AUTOMATION',
        at: args.at,
      });
      return { by: 'menu', handedOff: false };
    case 'SUBMENU': {
      const m = cfg.menuId ? await renderMenu(orgId, cfg.menuId) : null;
      await deliver(
        args.conversationId,
        [m ?? { kind: 'text', text: 'That menu is not available right now.' }],
        { sender: 'AUTOMATION', at: args.at },
      );
      return { by: 'menu', handedOff: false };
    }
    case 'PRODUCT_LIST':
      await deliver(args.conversationId, [await productList(orgId, cfg.category || undefined, 8)], {
        sender: 'AUTOMATION',
        at: args.at,
      });
      return { by: 'menu', handedOff: false };
    case 'HANDOFF':
      await deliver(
        args.conversationId,
        [
          {
            kind: 'text',
            text: cfg.note || 'Connecting you with our team. Someone will reply here shortly.',
          },
        ],
        { sender: 'AUTOMATION', at: args.at },
      );
      await recordHandoff(orgId, args.conversationId, `Menu option "${option.title}"`, 'WORKFLOW', args.at);
      return { by: 'menu', handedOff: true };
    case 'AI_ANSWER': {
      const ai = await assistantRespond({
        orgId,
        customerId: args.customerId,
        conversationId: args.conversationId,
        text: cfg.prompt || option.title,
        at: args.at,
      });
      await deliver(args.conversationId, [{ kind: 'text', text: ai.text }], {
        sender: 'AI',
        at: args.at,
        intent: ai.intent,
        meta: { aiProvider: ai.provider },
      });
      if (ai.handoff)
        await recordHandoff(orgId, args.conversationId, ai.reason ?? 'Assistant escalated', 'AI', args.at);
      return { by: 'menu:assistant', handedOff: ai.handoff };
    }
    case 'RUN_WORKFLOW':
      await deliver(
        args.conversationId,
        [{ kind: 'text', text: 'This option is not available right now.' }],
        { sender: 'AUTOMATION', at: args.at },
      );
      return { by: 'menu', handedOff: false };
  }
}
