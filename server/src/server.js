import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';

const app = createApp();
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, env: config.env }, 'Hangji API is listening');
});

const shutdown = async (signal) => {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
