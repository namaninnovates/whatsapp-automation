import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  List,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn, shortTime } from '../../lib/utils';

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'AUTOMATION' | 'AI' | 'AGENT' | 'SYSTEM';
  body: string;
  kind: string;
  payload?: Record<string, unknown> | null;
  status?: string;
  error?: string | null;
  createdAt?: string;
}

export interface MenuPayload {
  menuId?: string;
  header?: string;
  body: string;
  buttonLabel?: string;
  options: { id: string; title: string; description?: string }[];
}

export interface ThreadEvent {
  id: string;
  at: string;
  node: ReactNode;
}

function StatusIcon({ status, error }: { status?: string; error?: string | null }) {
  if (!status) return null;
  if (status === 'FAILED')
    return (
      <span title={error ?? 'Failed'} className="inline-flex items-center gap-0.5 text-danger">
        <AlertCircle className="size-3" /> Not sent
      </span>
    );
  if (status === 'READ') return <CheckCheck aria-label="Read" className="size-3.5 text-info" />;
  if (status === 'DELIVERED') return <CheckCheck aria-label="Delivered" className="size-3.5" />;
  if (status === 'SENT') return <Check aria-label="Sent" className="size-3.5" />;
  if (status === 'QUEUED') return <Clock aria-label="Queued" className="size-3" />;
  return null;
}

/** Renders an interactive menu the way WhatsApp does: reply buttons for ≤3 options, a list otherwise. */
export function MenuBubble({
  menu,
  onSelect,
  disabled,
}: {
  menu: MenuPayload;
  onSelect?: (o: { id: string; title: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const asButtons = menu.options.length <= 3;
  return (
    <div>
      {menu.header && <p className="mb-0.5 font-semibold">{menu.header}</p>}
      <p className="whitespace-pre-wrap">{menu.body}</p>
      <div className="-mx-2.5 mt-2 border-t border-ink/10">
        {asButtons ? (
          menu.options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={disabled || !onSelect}
              onClick={() => onSelect?.(o)}
              className="block w-full border-b border-ink/10 px-2.5 py-1.5 text-center text-[13px] font-medium text-[#027eb5] last:border-b-0 enabled:hover:bg-ink/[0.03] disabled:cursor-default"
            >
              {o.title}
            </button>
          ))
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center justify-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium text-[#027eb5] hover:bg-ink/[0.03]"
            >
              <List className="size-3.5" />
              {menu.buttonLabel || 'View options'}
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <ul className="border-t border-ink/10 bg-white/70">
                {menu.options.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={disabled || !onSelect}
                      onClick={() => {
                        setOpen(false);
                        onSelect?.(o);
                      }}
                      className="block w-full px-3 py-1.5 text-left enabled:hover:bg-ink/[0.03] disabled:cursor-default"
                    >
                      <span className="block text-[13px] text-ink">{o.title}</span>
                      {o.description && (
                        <span className="block text-[11.5px] text-ink-3">{o.description}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function senderLabel(m: ChatMessage) {
  const p = m.payload ?? {};
  if (m.senderType === 'AUTOMATION') return { icon: <Bot className="size-3" />, text: 'Automated' };
  if (m.senderType === 'AI')
    return {
      icon: <Sparkles className="size-3" />,
      text: p.aiProvider === 'mock' ? 'Assistant · mock' : 'Assistant',
    };
  if (m.senderType === 'AGENT')
    return { icon: <UserRound className="size-3" />, text: (p.agentName as string) || 'Team member' };
  return null;
}

/**
 * Message list shared by the inbox, the simulator, workflow tests and previews.
 * `events` are interleaved by time (e.g. workflow execution markers).
 */
export function ChatThread({
  messages,
  events = [],
  variant = 'inbox',
  onSelectOption,
  showSender = true,
  emptyText = 'No messages yet.',
  autoScroll = true,
  className,
}: {
  messages: ChatMessage[];
  events?: ThreadEvent[];
  variant?: 'inbox' | 'phone';
  onSelectOption?: (o: { id: string; title: string }) => void;
  showSender?: boolean;
  emptyText?: string;
  autoScroll?: boolean;
  className?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length + events.length;
  useEffect(() => {
    if (autoScroll) end.current?.scrollIntoView({ block: 'end' });
  }, [count, autoScroll]);

  const items: (
    { t: 'm'; at: number; m: ChatMessage; idx: number } | { t: 'e'; at: number; e: ThreadEvent }
  )[] = [
    ...messages.map((m, idx) => ({
      t: 'm' as const,
      at: m.createdAt ? new Date(m.createdAt).getTime() : idx,
      m,
      idx,
    })),
    ...events.map((e) => ({ t: 'e' as const, at: new Date(e.at).getTime(), e })),
  ].sort((a, b) => a.at - b.at || (a.t === 'e' ? -1 : 1));

  const lastMenuIdx = messages.map((m) => m.kind).lastIndexOf('menu');

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 px-4 py-4',
        variant === 'phone' ? 'bg-chat' : 'bg-canvas',
        className,
      )}
    >
      {!count && <p className="py-10 text-center text-[13px] text-ink-3">{emptyText}</p>}
      {items.map((it) => {
        if (it.t === 'e')
          return (
            <div key={it.e.id} className="my-1 flex justify-center">
              {it.e.node}
            </div>
          );
        const m = it.m;
        const out = m.direction === 'OUTBOUND';
        const label = out && showSender ? senderLabel(m) : null;
        const menu =
          m.kind === 'menu' && m.payload && Array.isArray((m.payload as unknown as MenuPayload).options)
            ? (m.payload as unknown as MenuPayload)
            : null;
        return (
          <div key={m.id} className={cn('flex flex-col', out ? 'items-end' : 'items-start')}>
            {label && (
              <span
                className={cn(
                  'mb-0.5 inline-flex items-center gap-1 px-1 text-[11px] font-medium',
                  m.senderType === 'AGENT' ? 'text-ink-2' : 'text-accent-ink',
                )}
              >
                {label.icon}
                {label.text}
              </span>
            )}
            <div
              className={cn(
                'max-w-[78%] rounded-lg px-2.5 py-1.5 text-[13.5px] leading-snug shadow-xs',
                out
                  ? m.senderType === 'AGENT' && variant === 'inbox'
                    ? 'bg-surface border border-line-strong'
                    : 'bg-bubble-out'
                  : 'bg-surface border border-line',
                m.status === 'FAILED' && 'ring-1 ring-danger/40',
              )}
            >
              {menu ? (
                <MenuBubble menu={menu} onSelect={onSelectOption} disabled={it.idx !== lastMenuIdx} />
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              )}
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-ink-3">
                {m.createdAt && <span className="tabular">{shortTime(m.createdAt)}</span>}
                {out && <StatusIcon status={m.status} error={m.error} />}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
