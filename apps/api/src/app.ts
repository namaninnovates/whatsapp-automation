import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config';
import { errorHandler, HttpError } from './lib/http';
import { logger } from './logger';
import { requireAuth, requireJsonForMutations } from './middleware/auth';
import { assistantRouter } from './routes/assistant';
import { authRouter } from './routes/auth';
import { conversationsRouter } from './routes/conversations';
import { catalogRouter, customersRouter, leadsRouter } from './routes/customers';
import { analyticsRouter, dashboardRouter } from './routes/insights';
import { knowledgeRouter } from './routes/knowledge';
import { menusRouter } from './routes/menus';
import { settingsRouter } from './routes/settings';
import { simulatorRouter } from './routes/simulator';
import { webhookRouter } from './routes/webhooks';
import { workflowsRouter } from './routes/workflows';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: config.serveWeb ? undefined : false }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
    }),
  );
  if (!config.isTest)
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  // Keep the raw body for webhook signature verification.
  app.use(
    express.json({ limit: '1mb', verify: (req, _res, buf) => ((req as express.Request).rawBody = buf) }),
  );
  app.use(cookieParser());

  const limiter = (max: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => config.isTest,
    });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/webhooks', limiter(600), webhookRouter);

  const api = Router();
  api.use(requireJsonForMutations);
  // Brute-force protection on credential endpoints only; session checks (/auth/me) get the general limit.
  const credentialLimiter = limiter(20);
  api.use(['/auth/login', '/auth/signup'], credentialLimiter);
  api.use('/auth', limiter(300), authRouter);

  const secured = Router();
  secured.use(requireAuth);
  secured.use('/dashboard', dashboardRouter);
  secured.use('/analytics', analyticsRouter);
  secured.use('/conversations', conversationsRouter);
  secured.use('/workflows', workflowsRouter);
  secured.use('/menus', menusRouter);
  secured.use('/knowledge', knowledgeRouter);
  secured.use('/customers', customersRouter);
  secured.use('/leads', leadsRouter);
  secured.use('/assistant', assistantRouter);
  secured.use('/settings', settingsRouter);
  secured.use('/simulator', limiter(120), simulatorRouter);
  secured.use('/', catalogRouter);
  api.use(secured);
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Endpoint not found')));

  // Optional single-process production mode: serve the built web app.
  if (config.serveWeb && fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
