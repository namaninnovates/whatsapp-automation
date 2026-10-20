import type { AiProvider, ProviderInput, ProviderOutput, ToolCallRecord } from './types';

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

/** Scores knowledge entries by keyword and title-word overlap with the message. */
export function rankKnowledge(message: string, entries: ProviderInput['knowledge']) {
  const msg = new Set(words(message));
  const lower = message.toLowerCase();
  return entries
    .map((e) => {
      let score = 0;
      for (const k of e.keywords) {
        const kw = k
          .toLowerCase()
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Whole-word/phrase match; longer phrases are more specific and weigh more.
        if (kw && new RegExp(`(^|[^a-z0-9])${kw}($|[^a-z0-9])`).test(lower))
          score += 2 * kw.split(/\s+/).length;
      }
      for (const w of words(e.title)) if (msg.has(w)) score += 1;
      return { entry: e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Deterministic stand-in for an LLM, used when no AI key is configured.
 * It follows the same tool-calling path as real providers, so permissions,
 * validation and logging are exercised identically.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock' as const;

  async run(input: ProviderInput): Promise<ProviderOutput> {
    const text = input.message.trim();
    const lower = text.toLowerCase();
    const calls: ToolCallRecord[] = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      const allowed = input.tools.some((t) => t.name === name);
      if (!allowed) {
        calls.push({ name, input: args, ok: false, output: 'Tool not approved for this business' });
        return null;
      }
      const r = await input.executeTool(name, args);
      calls.push({ name, input: args, ok: r.ok, output: r.output });
      return r;
    };

    if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening))( there| again)?[\s!.,]*$/.test(lower)) {
      return {
        text: 'Hello! I can help with products, order status, pricing and our policies. What do you need?',
        intent: 'greeting',
        confidence: 0.9,
        toolCalls: calls,
      };
    }

    const buy = lower.match(/\b(?:order|buy|purchase)\s+(\d{1,2})\s+(?:x\s+)?([a-z][a-z0-9 -]{2,60})/);
    if (buy) {
      const r = await call('place_order', { query: buy[2].trim(), quantity: Number(buy[1]) });
      if (r) return { text: r.output, intent: 'place_order', confidence: 0.85, toolCalls: calls };
    }

    const orderNo = text.match(/\b(?:ord[-\s#]*)?(\d{4,6})\b/i);
    if (
      /\b(track|order status|where is my order|my order|delivery status)\b/.test(lower) ||
      /\bord[-\s#]*\d{3,}/i.test(text)
    ) {
      if (!orderNo)
        return {
          text: 'Please share your order number (for example ORD-1042) and I will check it.',
          intent: 'order_status',
          confidence: 0.8,
          toolCalls: calls,
        };
      const r = await call('check_order_status', { orderNumber: orderNo[1] });
      if (r) return { text: r.output, intent: 'order_status', confidence: 0.85, toolCalls: calls };
    }

    if (/\b(bulk|wholesale|corporate|quotation|quote|b2b)\b/.test(lower)) {
      const r = await call('create_lead', { interest: text.slice(0, 200) });
      if (r)
        return {
          text: 'Thanks! I have passed your enquiry to our sales team. They will contact you on this number with a quote.',
          intent: 'lead',
          confidence: 0.85,
          toolCalls: calls,
        };
    }

    const avail = lower.match(
      /\b(?:do you have|available|availability|in stock|stock of|looking for)\b\s*(?:any\s+|the\s+|a\s+)?([a-z][a-z0-9 -]{2,60})?/,
    );
    if (avail) {
      const query = (avail[1] ?? lower.replace(/\b(is|are|the|available|in stock|do you have|any)\b/g, ' '))
        .replace(/[?.!]/g, '')
        .replace(/\b(in stock|available|right now|now|please|today)\b.*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (query) {
        const r = await call('check_product_availability', { query: query.split(' ').slice(0, 4).join(' ') });
        if (r) return { text: r.output, intent: 'product_availability', confidence: 0.8, toolCalls: calls };
      }
    }

    const ranked = rankKnowledge(text, input.knowledge);
    if (ranked.length) {
      const best = ranked[0];
      const confidence = Math.min(0.95, 0.45 + best.score * 0.12);
      await call('search_knowledge', { query: text.slice(0, 100) });
      return { text: best.entry.content, intent: 'faq', confidence, toolCalls: calls };
    }

    return {
      text: "I'm not sure I can answer that correctly, so I'll ask a team member to help.",
      intent: 'unknown',
      confidence: 0.25,
      toolCalls: calls,
    };
  }
}
