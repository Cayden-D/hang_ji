import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import authRouter from './routes/auth.js';
import ordersRouter from './routes/orders.js';
import uploadsRouter from './routes/uploads.js';
import usersRouter from './routes/users.js';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pcRoot = path.join(publicRoot, 'pc');

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(pinoHttp({ logger }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:']
      }
    }
  }));
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'hangji-api' }));
  app.get('/api/public-config', (_req, res) => res.json({ corpId: config.dingTalk.corpId }));
  app.use('/api/auth', authRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/admin/users', usersRouter);
  app.use('/pc', express.static(pcRoot, { index: 'index.html', maxAge: config.env === 'production' ? '1h' : 0 }));

  app.use((_req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', 'API route not found')));
  app.use((error, req, res, _next) => {
    const status = error instanceof AppError ? error.status : 500;
    if (status >= 500) req.log.error({ err: error }, 'Request failed');
    else req.log.warn({ err: error }, 'Request rejected');
    res.status(status).json({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: status === 500 ? 'Internal server error' : error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
  });
  return app;
};
