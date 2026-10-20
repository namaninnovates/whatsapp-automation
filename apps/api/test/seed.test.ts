import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('database migrations and seed', () => {
  it('applies migrations (global setup) and seeds the demo organization twice without errors', async () => {
    for (let run = 0; run < 2; run++) {
      execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        stdio: 'pipe',
      });
    }
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'brightlane-home' } });
    expect(org.isDemo).toBe(true);
    const [conversations, executions, failed] = await Promise.all([
      prisma.conversation.count({ where: { organizationId: org.id } }),
      prisma.workflowExecution.count({ where: { organizationId: org.id } }),
      prisma.workflowExecution.count({ where: { organizationId: org.id, status: 'FAILED' } }),
    ]);
    expect(conversations).toBeGreaterThan(20);
    expect(executions).toBeGreaterThan(20);
    expect(failed).toBeGreaterThanOrEqual(1);
  }, 120000);
});
