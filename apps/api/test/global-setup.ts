/**
 * Resets the test database and applies every migration in prisma/migrations.
 * Uses plain SQL so tests do not depend on the Prisma CLI being available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));

export default async function setup() {
  dotenv.config({ path: path.resolve(here, '../../../.env') });
  const url =
    process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/wa_automation_test';
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Cannot connect to the test database (${url}). Start PostgreSQL with "npm run db:up". ${(e as Error).message}`,
    );
  }
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const dir = path.resolve(here, '../../../prisma/migrations');
  const migrations = fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql')))
    .sort();
  for (const m of migrations) await client.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  await client.end();
}
