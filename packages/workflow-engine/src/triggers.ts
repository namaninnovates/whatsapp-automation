import type { Trigger, TriggerType } from '@wa/shared';
import type { TriggerEvent } from './types';

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function matchTrigger(trigger: Trigger, event: TriggerEvent): boolean {
  if (event.kind === 'event') return trigger.type === 'event' && trigger.event === event.event;
  switch (trigger.type) {
    case 'incoming_message':
      return true;
    case 'first_time_customer':
      return event.isNewCustomer;
    case 'business_hours':
      return trigger.when === 'inside' ? event.businessHoursOpen : !event.businessHoursOpen;
    case 'menu_selection':
      return (
        !!event.menuSelection &&
        event.menuSelection.menuId === trigger.menuId &&
        (!trigger.optionId || trigger.optionId === event.menuSelection.optionId)
      );
    case 'keyword': {
      const text = normalise(event.text);
      if (!text) return false;
      return trigger.keywords.some((raw) => {
        const k = normalise(raw);
        if (trigger.match === 'exact') return text === k;
        if (trigger.match === 'starts_with') return text.startsWith(k);
        // "contains" matches whole words/phrases, so "hi" does not match "this".
        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text);
      });
    }
    case 'event':
      return false;
  }
}

/** Lower number = more specific = wins when several workflows match the same message. */
export const TRIGGER_SPECIFICITY: Record<TriggerType, number> = {
  menu_selection: 1,
  keyword: 2,
  first_time_customer: 3,
  business_hours: 4,
  incoming_message: 5,
  event: 6,
};

export interface CandidateWorkflow {
  id: string;
  priority: number;
  createdAt: Date | string;
  trigger: Trigger;
}

/** Picks the single workflow that should handle an event, or null. */
export function selectWorkflow<T extends CandidateWorkflow>(workflows: T[], event: TriggerEvent): T | null {
  const matches = workflows.filter((w) => matchTrigger(w.trigger, event));
  matches.sort(
    (a, b) =>
      TRIGGER_SPECIFICITY[a.trigger.type] - TRIGGER_SPECIFICITY[b.trigger.type] ||
      a.priority - b.priority ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return matches[0] ?? null;
}
