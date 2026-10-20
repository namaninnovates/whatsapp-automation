import type { AiProvider, ProviderInput, ProviderOutput, ToolCallRecord } from './types';

/**
 * Real LLM providers. Both follow the same loop: the model may request tools,
 * the server validates and executes them (see assistant.ts), and the model writes
 * the final reply. At most MAX_ROUNDS tool rounds run per message.
 *
 * These providers are only used when AI_PROVIDER, AI_API_KEY and AI_MODEL are set.
 */
const MAX_ROUNDS = 3;
const TIMEOUT_MS = 20000;

function summarise(
  calls: ToolCallRecord[],
  text: string,
): Pick<ProviderOutput, 'intent' | 'confidence' | 'handoff'> {
  const handoff = calls.some((c) => c.name === 'escalate_to_human');
  const last = calls.filter((c) => c.name !== 'escalate_to_human').at(-1);
  return {
    intent: handoff
      ? 'escalation'
      : last
        ? last.name.replace(/^check_|^search_/, '')
        : text
          ? 'general'
          : 'unknown',
    // Models do not report calibrated confidence; escalation is expressed through the tool instead.
    confidence: text ? 0.8 : 0.2,
    handoff,
  };
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = 'https://api.anthropic.com',
  ) {}

  async run(input: ProviderInput): Promise<ProviderOutput> {
    type Block = {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    };
    const messages: { role: 'user' | 'assistant'; content: string | Block[] }[] = [
      ...input.history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: input.message },
    ];
    const calls: ToolCallRecord[] = [];
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 600,
          system: input.system,
          messages,
          tools: input.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
      const body = (await res.json()) as { content: Block[]; stop_reason: string };
      const text = body.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const uses = body.content.filter((b) => b.type === 'tool_use');
      if (body.stop_reason !== 'tool_use' || !uses.length || round === MAX_ROUNDS) {
        return { text, toolCalls: calls, ...summarise(calls, text) };
      }
      messages.push({ role: 'assistant', content: body.content });
      const results: Block[] = [];
      for (const u of uses) {
        const r = await input.executeTool(u.name!, u.input ?? {});
        calls.push({ name: u.name!, input: u.input ?? {}, ok: r.ok, output: r.output });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.output, is_error: !r.ok });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: '', toolCalls: calls, ...summarise(calls, '') };
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai' as const;
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = 'https://api.openai.com/v1',
  ) {}

  async run(input: ProviderInput): Promise<ProviderOutput> {
    type Msg = {
      role: string;
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
      tool_call_id?: string;
    };
    const messages: Msg[] = [
      { role: 'system', content: input.system },
      ...input.history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: input.message },
    ];
    const calls: ToolCallRecord[] = [];
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: input.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`AI provider error ${res.status}`);
      const body = (await res.json()) as { choices: { message: Msg }[] };
      const msg = body.choices[0].message;
      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length || round === MAX_ROUNDS) {
        const text = (msg.content ?? '').trim();
        return { text, toolCalls: calls, ...summarise(calls, text) };
      }
      messages.push(msg);
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }
        const r = await input.executeTool(tc.function.name, args);
        calls.push({ name: tc.function.name, input: args, ok: r.ok, output: r.output });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: r.output });
      }
    }
    return { text: '', toolCalls: calls, ...summarise(calls, '') };
  }
}
