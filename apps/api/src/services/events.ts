import type { BusinessEvent } from '@wa/shared';
import { prisma } from '../db';
import { logger } from '../logger';
import { businessHoursOpenFor } from './context';
import { loadActiveWorkflows, startExecution } from './executions';

/**
 * Fires workflows whose trigger is an order or lead event. The trigger event id
 * includes the entity id, so the same event never runs a workflow twice.
 */
export async function emitBusinessEvent(
  orgId: string,
  event: BusinessEvent,
  ref: { customerId: string; conversationId?: string; entityId: string; variables?: Record<string, string> },
) {
  try {
    const workflows = (await loadActiveWorkflows(orgId)).filter(
      (w) => w.trigger.type === 'event' && w.trigger.event === event,
    );
    if (!workflows.length) return;
    const conversation = ref.conversationId
      ? await prisma.conversation.findFirst({ where: { id: ref.conversationId, organizationId: orgId } })
      : await prisma.conversation.findFirst({
          where: { organizationId: orgId, customerId: ref.customerId },
          orderBy: { lastMessageAt: 'desc' },
        });
    if (!conversation) return;
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: ref.customerId },
      include: { tags: true },
    });
    for (const wf of workflows) {
      await startExecution(wf, {
        orgId,
        conversationId: conversation.id,
        customerId: customer.id,
        triggerEventId: `${event}:${ref.entityId}`,
        context: {
          message: { text: '' },
          customer: {
            id: customer.id,
            name: customer.name,
            isNew: false,
            tags: customer.tags.map((t) => t.name),
          },
          businessHoursOpen: await businessHoursOpenFor(orgId),
          variables: ref.variables ?? {},
          event,
        },
      });
    }
  } catch (e) {
    logger.error({ err: e, event }, 'Business event handling failed');
  }
}
