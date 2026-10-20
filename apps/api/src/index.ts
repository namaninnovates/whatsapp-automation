import { createApp } from './app';
import { config, effectiveAiProvider, whatsappCloudReady } from './config';
import { prisma } from './db';
import { logger } from './logger';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      whatsapp: whatsappCloudReady() ? 'cloud' : 'simulated',
      ai: effectiveAiProvider(),
    },
    `API listening on http://localhost:${config.port}`,
  );
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
