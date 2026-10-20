/** Language generation is isolated behind this interface; business logic lives in tools. */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  parameters: Record<string, unknown>;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  output: string;
}

/** Runs one tool on the server after validation and permission checks. */
export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
) => Promise<{ ok: boolean; output: string; handoff?: boolean }>;

export interface ProviderInput {
  system: string;
  history: ChatTurn[];
  message: string;
  tools: ToolSpec[];
  executeTool: ToolExecutor;
  knowledge: { title: string; content: string; keywords: string[] }[];
}

export interface ProviderOutput {
  text: string;
  intent: string;
  confidence: number;
  toolCalls: ToolCallRecord[];
  handoff?: boolean;
}

export interface AiProvider {
  readonly name: 'mock' | 'anthropic' | 'openai';
  run(input: ProviderInput): Promise<ProviderOutput>;
}
