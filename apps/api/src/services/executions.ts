import { WorkflowDefinitionSchema, type WorkflowDefinition, type Trigger } from '@wa/shared';
import {
  runWorkflow,
  type EngineContext,
  type ExecutionResult,
  type WaitingState,
} from '@wa/workflow-engine';
import { prisma, type Prisma } from '../db';
import { audit } from '../lib/audit';
import { isUniqueViolation } from '../lib/http';
import { logger } from '../logger';
import { createDbServices, recordHandoff } from './engineServices';
import { deliver } from './outbound';

export interface ActiveWorkflow {
  id: string;
  name: string;
  priority: number;
  createdAt: Date;
  trigger: Trigger;
  versionId: string;
  definition: WorkflowDefinition;
}

/** Active workflows with their activated version, parsed and ready for trigger matching. */
export async function loadActiveWorkflows(orgId: string): Promise<ActiveWorkflow[]> {
  const rows = await prisma.workflow.findMany({
    where: { organizationId: orgId, isActive: true, activeVersionId: { not: null } },
  });
  const versions = await prisma.workflowVersion.findMany({
    where: { id: { in: rows.map((r) => r.activeVersionId!) } },
  });
  const out: ActiveWorkflow[] = [];
  for (const w of rows) {
    const v = versions.find((x) => x.id === w.activeVersionId);
    const parsed = v && WorkflowDefinitionSchema.safeParse(v.definition);
    if (!v || !parsed || !parsed.success) {
      logger.warn({ workflowId: w.id }, 'Skipping workflow with invalid active version');
      continue;
    }
    out.push({
      id: w.id,
      name: w.name,
      priority: w.priority,
      createdAt: w.createdAt,
      trigger: parsed.data.trigger,
      versionId: v.id,
      definition: parsed.data,
    });
  }
  return out;
}

interface RunArgs {
  orgId: string;
  conversationId: string;
  customerId: string;
  context: EngineContext;
  at?: Date;
}

/** Persists the outcome of an engine run: execution row, replies, conversation state, handoff. */
async function persistOutcome(
  executionId: string,
  workflowName: string,
  args: RunArgs,
  result: ExecutionResult,
  flags: ReturnType<typeof createDbServices>['flags'],
  previousLog: unknown[] = [],
) {
  const terminal = result.status !== 'WAITING';
  const failed = result.status === 'FAILED';
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status: result.status === 'SUCCEEDED' && flags.handoff ? 'HANDED_OFF' : result.status,
      log: [...previousLog, ...result.log] as unknown as Prisma.InputJsonValue,
      variables: result.variables as Prisma.InputJsonValue,
      waitingStepId: result.waiting?.stepId ?? null,
      error: result.error ?? null,
      finishedAt: terminal ? (args.at ? new Date(args.at.getTime() + 1500) : new Date()) : null,
    },
  });

  // Clear any previous pending state; deliver() sets menu state when a menu goes out.
  await prisma.conversation.update({ where: { id: args.conversationId }, data: { state: { type: 'none' } } });
  const messages = [...result.messages];
  if (failed)
    messages.push({
      kind: 'text',
      text: 'Sorry, something went wrong on our side. A team member will follow up here shortly.',
    });
  await deliver(args.conversationId, messages, {
    sender: 'AUTOMATION',
    executionId,
    at: args.at,
    intent: flags.aiIntent,
    meta: flags.aiProvider ? { aiProvider: flags.aiProvider } : undefined,
  });

  if (result.status === 'WAITING' && result.waiting) {
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: {
        state: {
          type: 'workflow_wait',
          executionId,
          waiting: result.waiting as unknown as Prisma.InputJsonValue,
        },
      },
    });
  } else if (flags.pendingToolExecutionId) {
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: { state: { type: 'confirm', toolExecutionId: flags.pendingToolExecutionId } },
    });
  }
  if (flags.handoff || result.handedOff || failed) {
    await recordHandoff(
      args.orgId,
      args.conversationId,
      failed
        ? `Workflow "${workflowName}" failed: ${result.error}`
        : (flags.handoffNote ?? `Workflow "${workflowName}" assigned a human`),
      'WORKFLOW',
      args.at,
    );
  }
  if (failed) {
    await audit({
      organizationId: args.orgId,
      actorType: 'WORKFLOW',
      action: 'workflow.failed',
      entityType: 'WorkflowExecution',
      entityId: executionId,
      metadata: { workflow: workflowName, error: result.error },
    });
  }
  return { handedOff: flags.handoff || result.handedOff || failed };
}

/**
 * Starts an execution for a triggering event. The unique (workflowId, triggerEventId)
 * constraint guarantees a duplicate event can never run the same workflow twice.
 */
export async function startExecution(
  wf: ActiveWorkflow,
  args: RunArgs & { triggerEventId: string; attempt?: number },
) {
  let execution;
  try {
    execution = await prisma.workflowExecution.create({
      data: {
        organizationId: args.orgId,
        workflowId: wf.id,
        versionId: wf.versionId,
        conversationId: args.conversationId,
        triggerEventId: args.triggerEventId,
        status: 'RUNNING',
        attempt: args.attempt ?? 1,
        ...(args.at ? { startedAt: args.at } : {}),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      logger.info({ workflowId: wf.id, triggerEventId: args.triggerEventId }, 'Duplicate trigger ignored');
      return { duplicate: true as const };
    }
    throw e;
  }
  const { services, flags } = createDbServices({
    orgId: args.orgId,
    customerId: args.customerId,
    conversationId: args.conversationId,
    at: args.at,
  });
  const result = await runWorkflow({ definition: wf.definition, context: args.context, services });
  const outcome = await persistOutcome(execution.id, wf.name, args, result, flags);
  return { duplicate: false as const, executionId: execution.id, status: result.status, ...outcome };
}

/** Resumes an execution that was waiting for the customer's answer. */
export async function resumeExecution(executionId: string, waiting: WaitingState, args: RunArgs) {
  const execution = await prisma.workflowExecution.findFirst({
    where: { id: executionId, organizationId: args.orgId, status: 'WAITING' },
    include: { version: true, workflow: true },
  });
  if (!execution) return null;
  const parsed = WorkflowDefinitionSchema.safeParse(execution.version.definition);
  if (!parsed.success) return null;
  const { services, flags } = createDbServices({
    orgId: args.orgId,
    customerId: args.customerId,
    conversationId: args.conversationId,
    at: args.at,
  });
  const context = {
    ...args.context,
    variables: { ...(execution.variables as Record<string, string>), ...args.context.variables },
  };
  const result = await runWorkflow({ definition: parsed.data, context, services, resume: waiting });
  await persistOutcome(
    execution.id,
    execution.workflow.name,
    { ...args, context },
    result,
    flags,
    execution.log as unknown[],
  );
  return { executionId, status: result.status };
}
