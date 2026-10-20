/**
 * Runs before any test module is imported, so config.ts sees test settings.
 * Integration tests use DATABASE_URL_TEST (a separate database that is wiped).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/wa_automation_test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-tests-0123456789';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.WHATSAPP_MODE = 'simulated';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_ORG_SLUG = 'webhook-test-co';
process.env.AI_PROVIDER = 'mock';
process.env.AI_API_KEY = '';
