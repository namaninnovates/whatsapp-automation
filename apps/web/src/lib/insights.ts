import type { AuditEntry } from './types';

export type Range = '7d' | '30d' | '90d';
export const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

export const shortDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const ACTION_TEXT: Record<string, string> = {
  'workflow.activated': 'Workflow activated',
  'workflow.deactivated': 'Workflow deactivated',
  'workflow.saved': 'Workflow saved',
  'workflow.created': 'Workflow created',
  'workflow.failed': 'Workflow failed',
  'conversation.handed_off': 'Conversation handed to a human',
  'lead.created': 'Lead created',
  'lead.updated': 'Lead updated',
  'order.placed': 'Order placed by customer',
  'menu.updated': 'Menu updated',
  'menu.published': 'Menu published',
  'message.sent': 'Reply sent by a team member',
  'user.signed_in': 'Signed in',
};
export const describeAudit = (a: AuditEntry) => {
  const meta = a.metadata ?? {};
  const base = ACTION_TEXT[a.action] ?? a.action.replace(/[._]/g, ' ');
  const detail =
    (meta.workflow as string) ||
    (meta.name as string) ||
    (meta.reason as string) ||
    (meta.number as string) ||
    '';
  return detail ? `${base} · ${detail}` : base;
};
