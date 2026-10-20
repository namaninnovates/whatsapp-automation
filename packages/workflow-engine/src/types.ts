import type { BusinessAction, WorkflowDefinition } from '@wa/shared';

export interface MenuOptionView {
  id: string;
  title: string;
  description?: string;
}

/** Messages produced by a workflow run. The transport layer decides how to deliver them. */
export type OutboundMessage =
  | { kind: 'text'; text: string }
  | {
      kind: 'menu';
      menuId: string;
      header?: string;
      body: string;
      buttonLabel: string;
      options: MenuOptionView[];
    }
  | { kind: 'products'; text: string; items: { id: string; title: string; description?: string }[] };

export interface EngineCustomer {
  id: string;
  name?: string | null;
  isNew: boolean;
  tags: string[];
}

export interface EngineContext {
  message: { text: string; interactiveReplyId?: string };
  customer: EngineCustomer;
  businessHoursOpen: boolean;
  variables: Record<string, string>;
  event?: string;
}

export interface ActionResult {
  ok: boolean;
  /** Text to send to the customer, if any. */
  message?: string;
  /** Machine-readable output stored in the execution log and optional result variable. */
  data?: Record<string, unknown>;
  /** The action was accepted but needs explicit customer confirmation before it runs. */
  requiresConfirmation?: boolean;
  error?: string;
}

/**
 * Side-effecting capabilities are injected so the same engine runs against
 * the database (live), an in-memory sandbox (test mode) or unit-test fakes.
 */
export interface EngineServices {
  renderMenu(menuId: string): Promise<OutboundMessage | null>;
  listProducts(input: { category?: string; limit: number; intro?: string }): Promise<OutboundMessage>;
  addTag(tag: string): Promise<void>;
  assignHuman(note?: string): Promise<void>;
  aiRespond(input: { instructions?: string; text: string }): Promise<{ text: string; handoff?: boolean }>;
  runAction(action: BusinessAction, params: Record<string, string>): Promise<ActionResult>;
  saveCustomerField?(key: string, value: string): Promise<void>;
}

export type StepLogStatus = 'ok' | 'error' | 'waiting' | 'skipped';
export interface StepLogEntry {
  stepId: string;
  type: string;
  status: StepLogStatus;
  detail?: string;
  at: string;
  durationMs: number;
}

export type ExecutionStatus = 'SUCCEEDED' | 'WAITING' | 'FAILED' | 'HANDED_OFF';

export interface WaitingState {
  stepId: string;
  /** For collect_details: index of the field being asked. */
  fieldIndex?: number;
  retries?: number;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  messages: OutboundMessage[];
  log: StepLogEntry[];
  variables: Record<string, string>;
  waiting?: WaitingState;
  error?: string;
  handedOff: boolean;
  /** True when a business action asked for confirmation (e.g. place_order). */
  pendingConfirmation?: boolean;
}

export interface EngineLimits {
  maxSteps: number;
  maxVisitsPerStep: number;
  timeoutMs: number;
  stepTimeoutMs: number;
  maxAnswerRetries: number;
}

export const DEFAULT_LIMITS: EngineLimits = {
  maxSteps: 30,
  maxVisitsPerStep: 3,
  timeoutMs: 8000,
  stepTimeoutMs: 5000,
  maxAnswerRetries: 2,
};

export interface RunInput {
  definition: WorkflowDefinition;
  context: EngineContext;
  services: EngineServices;
  /** Resume a WAITING execution with the customer's latest message as the answer. */
  resume?: WaitingState;
  limits?: Partial<EngineLimits>;
  now?: () => number;
}

export type TriggerEvent =
  | {
      kind: 'message';
      text: string;
      isNewCustomer: boolean;
      businessHoursOpen: boolean;
      menuSelection?: { menuId: string; optionId: string };
    }
  | { kind: 'event'; event: string };
