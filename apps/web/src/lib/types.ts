import type { WorkflowDefinition } from '@wa/shared';

export type Role = 'OWNER' | 'ADMIN' | 'AGENT' | 'VIEWER';
export type ConversationStatus = 'OPEN' | 'AUTOMATED' | 'NEEDS_HUMAN' | 'RESOLVED';

export interface Session {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string; isDemo?: boolean };
  role: Role;
}

export interface Tag {
  id: string;
  name: string;
}

export interface CustomerLite {
  id: string;
  name: string | null;
  waId: string;
}

export interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'AUTOMATION' | 'AI' | 'AGENT' | 'SYSTEM';
  body: string;
  kind: string;
  payload: Record<string, unknown> | null;
  status: 'RECEIVED' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  error: string | null;
  intent: string | null;
  menuOptionId: string | null;
  executionId: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  channel: 'SIMULATED' | 'WHATSAPP';
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  customer: CustomerLite;
}

export interface Lead {
  id: string;
  status: 'NEW' | 'QUALIFIED' | 'CONTACTED' | 'WON' | 'LOST';
  interest: string;
  notes: string;
  details: Record<string, unknown>;
  valueMinor: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  number: string;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  items: { sku: string; name: string; quantity: number; priceMinor: number }[];
  totalMinor: number;
  currency: string;
  createdAt: string;
}

export interface Execution {
  id: string;
  status: 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'HANDED_OFF';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  attempt: number;
  log: { stepId: string; type: string; status: string; detail?: string; at: string; durationMs: number }[];
  workflow?: { name: string };
  workflowId: string;
  version?: { version: number };
  conversation?: { id: string; customer: { name: string | null; waId: string } } | null;
}

export interface ConversationDetail extends ConversationSummary {
  state: { type: string; menuId?: string; executionId?: string; waiting?: { stepId: string } } | null;
  handedOffAt: string | null;
  assignedToUserId: string | null;
  messages: Message[];
  executions: Execution[];
  customer: CustomerLite & {
    notes: string;
    customFields: Record<string, string>;
    firstSeenAt: string;
    lastInteractionAt: string;
    tags: Tag[];
    leads: Lead[];
    orders: Order[];
    conversations: {
      id: string;
      createdAt: string;
      status: ConversationStatus;
      lastMessagePreview: string;
    }[];
  };
}

export interface MenuOption {
  id: string;
  position: number;
  title: string;
  description: string;
  actionType: 'REPLY' | 'SUBMENU' | 'PRODUCT_LIST' | 'HANDOFF' | 'RUN_WORKFLOW' | 'AI_ANSWER';
  actionConfig: Record<string, string | undefined>;
}

export interface Menu {
  id: string;
  name: string;
  header: string;
  body: string;
  buttonLabel: string;
  isDefault: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
  options: MenuOption[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  priority: number;
  latestVersion: number;
  activeIsLatest: boolean;
  updatedAt: string;
  stats30d: { succeeded: number; failed: number; waiting: number };
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  priority: number;
  activeVersionId: string | null;
  latestVersionId: string;
  definition: WorkflowDefinition;
  versions: { id: string; version: number; createdAt: string }[];
  validation: { ok: boolean; errors: string[]; warnings: string[] } | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  priceMinor: number;
  currency: string;
  stock: number;
}

export interface KnowledgeEntry {
  id: string;
  category: 'FAQ' | 'POLICY' | 'PRODUCT' | 'SERVICE' | 'CONTACT' | 'OTHER';
  title: string;
  content: string;
  keywords: string[];
  isActive: boolean;
  updatedAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AnalyticsTotals {
  conversations: number;
  automated: number;
  human: number;
  needsHuman: number;
  escalated: number;
  escalationRate: number | null;
  automationSuccessRate: number | null;
  executions: { succeeded: number; failed: number };
  avgFirstResponseSeconds: number | null;
  avgHumanResponseSeconds: number | null;
  responsesMeasured: number;
}

export interface VolumePoint {
  date: string;
  conversations: number;
  messages: number;
  automated: number;
  human: number;
}

export interface AuditEntry {
  id: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
