import { z } from 'zod';

/**
 * Workflow definitions are stored as JSON in WorkflowVersion.definition.
 * A definition is one trigger plus an ordered list of steps. Steps run in order
 * unless a step sets `next` (jump) or is a condition (branch to onTrue/onFalse).
 */

export const TRIGGER_TYPES = [
  'incoming_message',
  'first_time_customer',
  'keyword',
  'menu_selection',
  'event',
  'business_hours',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const BUSINESS_EVENTS = ['order.created', 'order.status_changed', 'lead.created'] as const;
export type BusinessEvent = (typeof BUSINESS_EVENTS)[number];

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('incoming_message') }),
  z.object({ type: z.literal('first_time_customer') }),
  z.object({
    type: z.literal('keyword'),
    keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
    match: z.enum(['contains', 'exact', 'starts_with']).default('contains'),
  }),
  z.object({
    type: z.literal('menu_selection'),
    menuId: z.string().min(1),
    optionId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('event'), event: z.enum(BUSINESS_EVENTS) }),
  z.object({ type: z.literal('business_hours'), when: z.enum(['inside', 'outside']) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const STEP_TYPES = [
  'send_text',
  'send_menu',
  'ask_question',
  'send_product_list',
  'collect_details',
  'condition',
  'assign_human',
  'add_tag',
  'ai_response',
  'business_action',
  'end',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** Actions an automation may execute. Each one is validated and authorized server-side. */
export const BUSINESS_ACTIONS = [
  'create_lead',
  'check_order_status',
  'check_product_availability',
  'place_order',
] as const;
export type BusinessAction = (typeof BUSINESS_ACTIONS)[number];

export const CONDITION_FIELDS = [
  'message.text',
  'customer.isNew',
  'customer.hasTag',
  'businessHours.open',
  'variable',
] as const;
export const CONDITION_OPS = ['contains', 'equals', 'not_equals', 'is_true', 'is_false', 'gt', 'lt'] as const;

const stepId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/, 'Step ids use letters, digits, - and _ (max 40)');
const base = {
  id: stepId,
  label: z.string().max(80).optional(),
  next: stepId.nullable().optional(),
};
const varName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'Variable names start with a letter');

export const ConditionRuleSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.string().max(200).optional(),
  variable: varName.optional(),
});
export type ConditionRule = z.infer<typeof ConditionRuleSchema>;

export const StepSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('send_text'), text: z.string().min(1).max(4096) }),
  z.object({ ...base, type: z.literal('send_menu'), menuId: z.string().min(1) }),
  z.object({
    ...base,
    type: z.literal('ask_question'),
    question: z.string().min(1).max(1024),
    variable: varName,
    validation: z.enum(['text', 'number', 'email', 'phone']).default('text'),
    saveToCustomerField: z.boolean().default(false),
  }),
  z.object({
    ...base,
    type: z.literal('send_product_list'),
    category: z.string().max(60).optional(),
    limit: z.number().int().min(1).max(10).default(5),
    intro: z.string().max(300).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('collect_details'),
    fields: z
      .array(
        z.object({
          variable: varName,
          prompt: z.string().min(1).max(300),
          validation: z.enum(['text', 'number', 'email', 'phone']).default('text'),
        }),
      )
      .min(1)
      .max(8),
    saveToCustomerFields: z.boolean().default(true),
  }),
  z.object({
    ...base,
    type: z.literal('condition'),
    mode: z.enum(['all', 'any']).default('all'),
    rules: z.array(ConditionRuleSchema).min(1).max(10),
    onTrue: stepId.nullable(),
    onFalse: stepId.nullable(),
  }),
  z.object({ ...base, type: z.literal('assign_human'), note: z.string().max(300).optional() }),
  z.object({ ...base, type: z.literal('add_tag'), tag: z.string().min(1).max(40) }),
  z.object({ ...base, type: z.literal('ai_response'), instructions: z.string().max(1000).optional() }),
  z.object({
    ...base,
    type: z.literal('business_action'),
    action: z.enum(BUSINESS_ACTIONS),
    // Values may reference variables, e.g. "{{vars.orderNumber}}".
    params: z.record(z.string().max(500)).default({}),
    resultVariable: varName.optional(),
  }),
  z.object({ ...base, type: z.literal('end') }),
]);
export type Step = z.infer<typeof StepSchema>;

export const WorkflowDefinitionSchema = z.object({
  trigger: TriggerSchema,
  steps: z.array(StepSchema).min(1).max(40),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinitionSchema>;

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  incoming_message: 'Any incoming message',
  first_time_customer: 'First-time customer',
  keyword: 'Keyword or phrase',
  menu_selection: 'Menu selection',
  event: 'Order or lead event',
  business_hours: 'Business hours',
};

export const STEP_LABELS: Record<StepType, string> = {
  send_text: 'Send a text reply',
  send_menu: 'Show an interactive menu',
  ask_question: 'Ask a question',
  send_product_list: 'Send a product list',
  collect_details: 'Collect customer details',
  condition: 'Condition',
  assign_human: 'Assign to a human',
  add_tag: 'Add a tag',
  ai_response: 'AI-assisted reply',
  business_action: 'Run a business action',
  end: 'End workflow',
};

export const BUSINESS_ACTION_LABELS: Record<BusinessAction, string> = {
  create_lead: 'Create or update a lead',
  check_order_status: 'Check order status',
  check_product_availability: 'Check product availability',
  place_order: 'Place an order (requires confirmation)',
};
