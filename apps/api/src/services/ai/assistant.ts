import { ASSISTANT_ACTIONS, BUSINESS_ACTIONS, type BusinessAction } from '@wa/shared';
import { config, effectiveAiProvider } from '../../config';
import { prisma } from '../../db';
import { logger } from '../../logger';
import { runAction } from '../actions';
import { MockProvider, rankKnowledge } from './mock';
import { AnthropicProvider, OpenAiCompatibleProvider } from './remote';
import type { AiProvider, ToolCallRecord, ToolSpec } from './types';

const TOOL_SPECS: Record<string, ToolSpec> = {
  search_knowledge: {
    name: 'search_knowledge',
    description: "Search the business's approved knowledge base (FAQs, policies, products, contact details).",
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  check_product_availability: {
    name: 'check_product_availability',
    description: 'Look up products by name, SKU or category and return price and stock.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  check_order_status: {
    name: 'check_order_status',
    description: "Return the status of one of this customer's orders by order number.",
    parameters: {
      type: 'object',
      properties: { orderNumber: { type: 'string' } },
      required: ['orderNumber'],
    },
  },
  create_lead: {
    name: 'create_lead',
    description: 'Record a sales enquiry (bulk order, quotation, partnership) for the sales team.',
    parameters: {
      type: 'object',
      properties: { interest: { type: 'string' }, details: { type: 'string' } },
      required: ['interest'],
    },
  },
  place_order: {
    name: 'place_order',
    description:
      'Prepare an order. The customer must confirm before it is placed; never claim the order is placed.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 50 } },
      required: ['query', 'quantity'],
    },
  },
  escalate_to_human: {
    name: 'escalate_to_human',
    description:
      'Hand the conversation to a human team member when unsure, when the customer asks, or for sensitive topics.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
};

export function getProvider(): AiProvider {
  const p = effectiveAiProvider();
  if (p === 'anthropic') return new AnthropicProvider(config.ai.apiKey!, config.ai.model!, config.ai.baseUrl);
  if (p === 'openai')
    return new OpenAiCompatibleProvider(config.ai.apiKey!, config.ai.model!, config.ai.baseUrl);
  return new MockProvider();
}

export interface AssistantInput {
  orgId: string;
  customerId: string;
  conversationId?: string;
  text: string;
  instructions?: string;
  dryRun?: boolean;
  at?: Date;
}

export interface AssistantResult {
  text: string;
  intent: string;
  confidence: number;
  handoff: boolean;
  provider: string;
  toolCalls: ToolCallRecord[];
  pendingToolExecutionId?: string;
  reason?: string;
}

/**
 * Orchestrates one assistant turn. The model only produces language and tool
 * requests; tools are validated, permission-checked against the business's
 * approved actions and executed here, then recorded.
 */
export async function assistantRespond(input: AssistantInput): Promise<AssistantResult> {
  const profile = await prisma.businessProfile.findUnique({ where: { organizationId: input.orgId } });
  const providerName = effectiveAiProvider();
  const base = { provider: providerName, toolCalls: [] as ToolCallRecord[] };
  if (!profile || !profile.aiEnabled) {
    return {
      ...base,
      text: 'A team member will reply to you shortly.',
      intent: 'assistant_disabled',
      confidence: 0,
      handoff: true,
      reason: 'Assistant is turned off',
    };
  }

  // Escalation rules are enforced deterministically, before any model call.
  const lower = input.text.toLowerCase();
  const rule = profile.escalationRules.find((r) => r.trim() && lower.includes(r.toLowerCase().trim()));
  if (rule) {
    return {
      ...base,
      text: "I'm connecting you with a member of our team. They'll reply here shortly.",
      intent: 'escalation',
      confidence: 1,
      handoff: true,
      reason: `Matched escalation rule "${rule}"`,
    };
  }

  const approved = new Set<string>(
    profile.approvedActions.filter((a) => (ASSISTANT_ACTIONS as readonly string[]).includes(a)),
  );
  const tools = [...approved, 'escalate_to_human'].map((n) => TOOL_SPECS[n]).filter(Boolean);
  const knowledge = await prisma.knowledgeEntry.findMany({
    where: { organizationId: input.orgId, isActive: true },
    select: { title: true, content: true, keywords: true },
  });
  let pending: string | undefined;
  let toolHandoff = false;

  const executeTool = async (name: string, args: Record<string, unknown>) => {
    if (name === 'escalate_to_human') {
      toolHandoff = true;
      return { ok: true, output: 'Escalated to a human team member.', handoff: true };
    }
    if (!approved.has(name)) {
      logger.warn({ name }, 'Assistant requested a tool that is not approved');
      return { ok: false, output: `The tool ${name} is not approved for this business.` };
    }
    if (name === 'search_knowledge') {
      const q = String(args.query ?? input.text);
      const hits = rankKnowledge(q, knowledge).slice(0, 3);
      return {
        ok: true,
        output: hits.length
          ? hits.map((h) => `${h.entry.title}: ${h.entry.content}`).join('\n\n')
          : 'No matching knowledge entries.',
      };
    }
    if ((BUSINESS_ACTIONS as readonly string[]).includes(name)) {
      const r = await runAction(name as BusinessAction, args, {
        orgId: input.orgId,
        customerId: input.customerId,
        conversationId: input.conversationId,
        source: 'assistant',
        dryRun: input.dryRun,
        at: input.at,
      });
      if (r.requiresConfirmation && r.toolExecutionId) pending = r.toolExecutionId;
      return { ok: r.ok, output: r.message ?? (r.ok ? JSON.stringify(r.data ?? {}) : (r.error ?? 'Failed')) };
    }
    return { ok: false, output: `Unknown tool ${name}.` };
  };

  const history = input.conversationId
    ? (
        await prisma.message.findMany({
          where: { conversationId: input.conversationId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      )
        .reverse()
        .filter((m) => m.body && m.body !== input.text)
        .map((m) => ({
          role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
          content: m.body,
        }))
    : [];

  const system = [
    `You are the WhatsApp assistant for ${profile.displayName}.`,
    profile.description && `About the business: ${profile.description}`,
    profile.instructions && `Instructions: ${profile.instructions}`,
    input.instructions && `For this step: ${input.instructions}`,
    `Tone: ${profile.tone}. Keep replies short enough for WhatsApp (under 600 characters).`,
    profile.topics.length
      ? `Only handle these topics: ${profile.topics.join(', ')}. For anything else, call escalate_to_human.`
      : '',
    'Only state facts that come from tool results or the knowledge base. If you are not sure, call escalate_to_human.',
    'Never claim an order, refund or other consequential action is complete unless a tool result says so.',
  ]
    .filter(Boolean)
    .join('\n');

  let out;
  try {
    out = await getProvider().run({ system, history, message: input.text, tools, executeTool, knowledge });
  } catch (e) {
    logger.error({ err: e }, 'AI provider failed; escalating');
    return {
      ...base,
      text: "Sorry, I'm having trouble right now. A team member will reply shortly.",
      intent: 'provider_error',
      confidence: 0,
      handoff: true,
      reason: 'Provider error',
    };
  }

  const handoff = toolHandoff || !!out.handoff || out.confidence < profile.confidenceThreshold;
  const text =
    out.confidence < profile.confidenceThreshold && !toolHandoff
      ? "I'm not completely sure about that, so I've asked a team member to help. They'll reply here shortly."
      : out.text || 'A team member will reply shortly.';
  return {
    text,
    intent: out.intent,
    confidence: out.confidence,
    handoff,
    provider: providerName,
    toolCalls: out.toolCalls,
    pendingToolExecutionId: pending,
    reason: handoff
      ? out.confidence < profile.confidenceThreshold
        ? `Confidence ${out.confidence.toFixed(2)} below threshold ${profile.confidenceThreshold}`
        : 'Assistant escalated'
      : undefined,
  };
}
