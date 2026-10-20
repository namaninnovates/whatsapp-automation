import type { ConversationStatus, Execution } from '../lib/types';
import { Badge } from './ui';

const CONV: Record<ConversationStatus, { label: string; tone: 'accent' | 'warn' | 'neutral' | 'info' }> = {
  OPEN: { label: 'Open', tone: 'info' },
  AUTOMATED: { label: 'Automated', tone: 'accent' },
  NEEDS_HUMAN: { label: 'Needs human', tone: 'warn' },
  RESOLVED: { label: 'Resolved', tone: 'neutral' },
};

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  const s = CONV[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

const EXEC: Record<
  Execution['status'],
  { label: string; tone: 'accent' | 'warn' | 'neutral' | 'danger' | 'info' }
> = {
  RUNNING: { label: 'Running', tone: 'info' },
  WAITING: { label: 'Waiting for reply', tone: 'info' },
  SUCCEEDED: { label: 'Succeeded', tone: 'accent' },
  FAILED: { label: 'Failed', tone: 'danger' },
  HANDED_OFF: { label: 'Handed off', tone: 'warn' },
};

export function ExecutionStatusBadge({ status }: { status: Execution['status'] }) {
  const s = EXEC[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const STATUS_LABEL = Object.fromEntries(Object.entries(CONV).map(([k, v]) => [k, v.label])) as Record<
  ConversationStatus,
  string
>;
