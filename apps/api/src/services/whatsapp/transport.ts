import crypto from 'node:crypto';
import { WA_LIMITS } from '@wa/shared';
import type { OutboundMessage } from '@wa/workflow-engine';
import { config, whatsappCloudReady } from '../../config';
import { logger } from '../../logger';

export interface SendResult {
  ok: boolean;
  externalId?: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  error?: string;
  /** True for transient failures (rate limits, 5xx) that are safe to retry. */
  retryable?: boolean;
}

/** Transport boundary: automation logic never talks to WhatsApp directly. */
export interface WhatsAppTransport {
  readonly name: 'simulated' | 'cloud';
  send(to: string, message: OutboundMessage): Promise<SendResult>;
}

/** Local demo channel: nothing leaves the server; delivery is recorded as simulated. */
export class SimulatedTransport implements WhatsAppTransport {
  readonly name = 'simulated' as const;
  async send(): Promise<SendResult> {
    return { ok: true, status: 'DELIVERED', externalId: `sim_${crypto.randomUUID()}` };
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Builds a Cloud API message body that respects interactive-message limits. */
export function toCloudPayload(to: string, m: OutboundMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (m.kind === 'text')
    return { ...base, type: 'text', text: { body: clip(m.text, WA_LIMITS.textMax), preview_url: false } };
  if (m.kind === 'products') {
    const lines = m.items.map(
      (it, i) => `${i + 1}. ${it.title}${it.description ? ` — ${it.description}` : ''}`,
    );
    return {
      ...base,
      type: 'text',
      text: { body: clip([m.text, ...lines].join('\n'), WA_LIMITS.textMax), preview_url: false },
    };
  }
  const options = m.options.slice(0, WA_LIMITS.listRowsMax);
  const header = m.header ? { header: { type: 'text', text: clip(m.header, WA_LIMITS.headerMax) } } : {};
  if (options.length <= WA_LIMITS.replyButtonsMax) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...header,
        body: { text: clip(m.body, WA_LIMITS.bodyMax) },
        action: {
          buttons: options.map((o) => ({
            type: 'reply',
            reply: { id: o.id, title: clip(o.title, WA_LIMITS.replyButtonTitleMax) },
          })),
        },
      },
    };
  }
  return {
    ...base,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...header,
      body: { text: clip(m.body, WA_LIMITS.bodyMax) },
      action: {
        button: clip(m.buttonLabel || 'View options', WA_LIMITS.listButtonMax),
        sections: [
          {
            title: 'Options',
            rows: options.map((o) => ({
              id: o.id,
              title: clip(o.title, WA_LIMITS.listRowTitleMax),
              ...(o.description ? { description: clip(o.description, WA_LIMITS.listRowDescriptionMax) } : {}),
            })),
          },
        ],
      },
    },
  };
}

/** Simple token bucket so bursts stay under the Cloud API throughput limit. */
class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private perSecond: number) {
    this.tokens = perSecond;
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.perSecond, this.tokens + ((now - this.last) / 1000) * this.perSecond);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/** Official WhatsApp Business Platform (Cloud API) transport. */
export class CloudApiTransport implements WhatsAppTransport {
  readonly name = 'cloud' as const;
  private limiter = new RateLimiter(20);
  constructor(
    private phoneNumberId: string,
    private accessToken: string,
    private apiVersion: string,
  ) {}

  async send(to: string, message: OutboundMessage): Promise<SendResult> {
    await this.limiter.take();
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(toCloudPayload(to, message)),
        signal: AbortSignal.timeout(10000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { message?: string; code?: number };
      };
      if (!res.ok) {
        const code = body.error?.code;
        // 131047: outside the 24-hour customer service window (template required).
        const hint =
          code === 131047 ? ' (outside the 24-hour window: send an approved template instead)' : '';
        const retryable = res.status === 429 || res.status >= 500 || code === 130429 || code === 80007;
        logger.warn({ status: res.status, code }, 'WhatsApp Cloud API send failed');
        return {
          ok: false,
          status: 'FAILED',
          error: `${body.error?.message ?? `HTTP ${res.status}`}${hint}`,
          retryable,
        };
      }
      return { ok: true, status: 'SENT', externalId: body.messages?.[0]?.id };
    } catch (e) {
      return {
        ok: false,
        status: 'FAILED',
        error: e instanceof Error ? e.message : 'Network error',
        retryable: true,
      };
    }
  }
}

let cloud: CloudApiTransport | null = null;
const simulated = new SimulatedTransport();

/** Picks the transport for a conversation's channel. */
export function transportFor(channel: 'SIMULATED' | 'WHATSAPP'): WhatsAppTransport | null {
  if (channel === 'SIMULATED') return simulated;
  if (!whatsappCloudReady()) return null;
  cloud ??= new CloudApiTransport(
    config.whatsapp.phoneNumberId!,
    config.whatsapp.accessToken!,
    config.whatsapp.apiVersion,
  );
  return cloud;
}
