import { prisma, type Prisma, type Tx } from '../db';

export interface AuditInput {
  organizationId: string;
  actorType: 'USER' | 'SYSTEM' | 'AI' | 'WORKFLOW' | 'CUSTOMER';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail for configuration changes and consequential actions. */
export async function audit(input: AuditInput, tx: Tx | typeof prisma = prisma) {
  await tx.auditLog.create({
    data: { ...input, metadata: (input.metadata ?? {}) as Prisma.InputJsonValue },
  });
}
