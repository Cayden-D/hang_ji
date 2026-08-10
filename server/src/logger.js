import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['req.headers.authorization', '*.appSecret', '*.accessToken', '*.token'],
    censor: '[REDACTED]'
  }
});
