import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { config } from './config';

export { Prisma } from './generated/prisma/client';
export type * from './generated/prisma/client';

export function createPrisma(url = config.databaseUrl) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Shared client for the process. Prisma 7 talks to PostgreSQL through the pg driver adapter. */
export const prisma = createPrisma();
export type Db = typeof prisma;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
