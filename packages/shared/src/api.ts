import { z } from 'zod';
import { WorkflowDefinitionSchema } from './workflow';

/** Request/response contracts shared by the API (validation) and the web app (forms). */

export const ROLES = ['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Record<Role, number> = { VIEWER: 1, AGENT: 2, ADMIN: 3, OWNER: 4 };

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const SignupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  businessName: z.string().trim().min(2, 'Enter your business name').max(80),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const CONVERSATION_STATUSES = ['OPEN', 'AUTOMATED', 'NEEDS_HUMAN', 'RESOLVED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const ConversationListQuery = PaginationQuery.extend({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  unread: z.enum(['true', 'false']).optional(),
});

export const SendReplySchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(4096),
});

export const UpdateConversationSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  assignToMe: z.boolean().optional(),
  markRead: z.boolean().optional(),
});

export const MENU_ACTION_TYPES = [
  'REPLY',
  'SUBMENU',
  'PRODUCT_LIST',
  'HANDOFF',
  'RUN_WORKFLOW',
  'AI_ANSWER',
] as const;
export type MenuActionType = (typeof MENU_ACTION_TYPES)[number];
export const MENU_ACTION_LABELS: Record<MenuActionType, string> = {
  REPLY: 'Send a reply',
  SUBMENU: 'Open another menu',
  PRODUCT_LIST: 'Send product list',
  HANDOFF: 'Hand off to a person',
  RUN_WORKFLOW: 'Run a workflow',
  AI_ANSWER: 'Answer with the assistant',
};

/** WhatsApp interactive message limits (Cloud API). */
export const WA_LIMITS = {
  listRowsMax: 10,
  listRowTitleMax: 24,
  listRowDescriptionMax: 72,
  listButtonMax: 20,
  replyButtonsMax: 3,
  replyButtonTitleMax: 20,
  headerMax: 60,
  bodyMax: 1024,
  textMax: 4096,
} as const;

export const MenuOptionSchema = z
  .object({
    id: z.string().optional(),
    title: z
      .string()
      .trim()
      .min(1, 'Option title is required')
      .max(WA_LIMITS.listRowTitleMax, `Max ${WA_LIMITS.listRowTitleMax} characters (WhatsApp limit)`),
    description: z
      .string()
      .trim()
      .max(WA_LIMITS.listRowDescriptionMax, `Max ${WA_LIMITS.listRowDescriptionMax} characters`)
      .default(''),
    actionType: z.enum(MENU_ACTION_TYPES),
    actionConfig: z
      .object({
        text: z.string().max(WA_LIMITS.textMax).optional(),
        menuId: z.string().optional(),
        category: z.string().max(60).optional(),
        note: z.string().max(300).optional(),
        workflowId: z.string().optional(),
        prompt: z.string().max(500).optional(),
      })
      .default({}),
  })
  .superRefine((o, ctx) => {
    const c = o.actionConfig;
    if (o.actionType === 'REPLY' && !c.text?.trim())
      ctx.addIssue({ code: 'custom', path: ['actionConfig', 'text'], message: 'Reply text is required' });
    if (o.actionType === 'SUBMENU' && !c.menuId)
      ctx.addIssue({ code: 'custom', path: ['actionConfig', 'menuId'], message: 'Choose a menu' });
    if (o.actionType === 'RUN_WORKFLOW' && !c.workflowId)
      ctx.addIssue({ code: 'custom', path: ['actionConfig', 'workflowId'], message: 'Choose a workflow' });
  });
export type MenuOptionInput = z.input<typeof MenuOptionSchema>;

export const MenuSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  header: z.string().trim().max(WA_LIMITS.headerMax).default(''),
  body: z.string().trim().min(1, 'Message text is required').max(WA_LIMITS.bodyMax),
  buttonLabel: z.string().trim().min(1).max(WA_LIMITS.listButtonMax).default('View options'),
  isDefault: z.boolean().default(false),
  options: z
    .array(MenuOptionSchema)
    .min(1, 'Add at least one option')
    .max(WA_LIMITS.listRowsMax, `WhatsApp lists allow ${WA_LIMITS.listRowsMax} options`),
});
export type MenuInput = z.input<typeof MenuSchema>;

export const WorkflowUpsertSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(300).default(''),
  priority: z.number().int().min(1).max(1000).default(100),
  definition: WorkflowDefinitionSchema,
});
export type WorkflowUpsertInput = z.input<typeof WorkflowUpsertSchema>;

export const WorkflowTestSchema = z.object({
  message: z.string().trim().max(1000).default(''),
  isNewCustomer: z.boolean().default(false),
  customerName: z.string().max(80).default('Test customer'),
  answers: z.array(z.string().max(500)).max(10).default([]),
  event: z.string().optional(),
});

export const KNOWLEDGE_CATEGORIES = ['FAQ', 'POLICY', 'PRODUCT', 'SERVICE', 'CONTACT', 'OTHER'] as const;
export const KnowledgeSchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES),
  title: z.string().trim().min(1, 'Title is required').max(160),
  content: z.string().trim().min(1, 'Content is required').max(5000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  isActive: z.boolean().default(true),
});
export type KnowledgeInput = z.input<typeof KnowledgeSchema>;

export const LEAD_STATUSES = ['NEW', 'QUALIFIED', 'CONTACTED', 'WON', 'LOST'] as const;
export const CustomerUpdateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  customFields: z.record(z.string().max(500)).optional(),
});
export const LeadUpsertSchema = z.object({
  customerId: z.string().min(1),
  conversationId: z.string().optional(),
  status: z.enum(LEAD_STATUSES).default('NEW'),
  interest: z.string().trim().max(200).default(''),
  valueMinor: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(2000).default(''),
});
export const LeadUpdateSchema = LeadUpsertSchema.partial().omit({ customerId: true });

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const BusinessHoursSchema = z.record(
  z.enum(DAYS),
  z.object({
    open: z.boolean(),
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
  }),
);
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const ProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  contactEmail: z.string().email().nullable().optional().or(z.literal('')),
  contactPhone: z.string().max(30).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  timezone: z.string().max(60).optional(),
  businessHours: BusinessHoursSchema.optional(),
  notificationPrefs: z
    .object({
      emailOnHandoff: z.boolean(),
      emailDailySummary: z.boolean(),
      notifyOnFailedWorkflow: z.boolean(),
    })
    .optional(),
});

export const ASSISTANT_ACTIONS = [
  'search_knowledge',
  'check_product_availability',
  'check_order_status',
  'create_lead',
  'place_order',
] as const;
export type AssistantAction = (typeof ASSISTANT_ACTIONS)[number];
export const AssistantConfigSchema = z.object({
  aiEnabled: z.boolean(),
  description: z.string().max(2000),
  instructions: z.string().max(4000),
  tone: z.string().max(200),
  topics: z.array(z.string().trim().min(1).max(60)).max(30),
  escalationRules: z.array(z.string().trim().min(1).max(80)).max(30),
  approvedActions: z.array(z.enum(ASSISTANT_ACTIONS)),
  confidenceThreshold: z.number().min(0).max(1),
});
export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

export const InviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
});
export const UpdateMemberSchema = z.object({ role: z.enum(ROLES) });

export const SimulatorMessageSchema = z.object({
  from: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{8,18}$/, 'Use a phone number such as +91 98765 43210'),
  name: z.string().trim().max(80).optional(),
  text: z.string().trim().max(4096).default(''),
  interactiveReplyId: z.string().max(100).optional(),
});

export const DateRangeQuery = z.object({
  range: z.enum(['7d', '30d', '90d']).default('30d'),
});

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
