import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// Load the monorepo root .env (works from src/ in dev and dist/ in production).
dotenv.config({ path: path.resolve(here, '../../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  ENCRYPTION_KEY: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  SERVE_WEB: z.string().default('false'),
  WHATSAPP_MODE: z.enum(['simulated', 'cloud']).default('simulated'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_ORG_SLUG: z.string().optional(),
  AI_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message instead of a stack trace deep in a request.
  console.error(
    'Invalid environment configuration:\n' +
      parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
  );
  process.exit(1);
}
const env = parsed.data;
const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: env.JWT_SECRET,
  encryptionKey: blank(env.ENCRYPTION_KEY),
  logLevel: env.LOG_LEVEL,
  serveWeb: env.SERVE_WEB === 'true',
  webDist: path.resolve(here, '../../web/dist'),
  whatsapp: {
    mode: env.WHATSAPP_MODE,
    phoneNumberId: blank(env.WHATSAPP_PHONE_NUMBER_ID),
    businessAccountId: blank(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    accessToken: blank(env.WHATSAPP_ACCESS_TOKEN),
    appSecret: blank(env.WHATSAPP_APP_SECRET),
    verifyToken: blank(env.WHATSAPP_VERIFY_TOKEN),
    apiVersion: env.WHATSAPP_API_VERSION,
    orgSlug: blank(env.WHATSAPP_ORG_SLUG),
  },
  ai: {
    provider: env.AI_PROVIDER,
    apiKey: blank(env.AI_API_KEY),
    model: blank(env.AI_MODEL),
    baseUrl: blank(env.AI_BASE_URL),
  },
};

/** True when the real WhatsApp Cloud API has everything it needs to send. */
export const whatsappCloudReady = () =>
  config.whatsapp.mode === 'cloud' && !!config.whatsapp.phoneNumberId && !!config.whatsapp.accessToken;

/** The AI provider actually in use: falls back to the mock when no key is configured. */
export const effectiveAiProvider = (): 'mock' | 'anthropic' | 'openai' =>
  config.ai.provider !== 'mock' && config.ai.apiKey && config.ai.model ? config.ai.provider : 'mock';
