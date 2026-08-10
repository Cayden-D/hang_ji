import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('*'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('hangji'),
  DB_USER: z.string().default('hangji'),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-now'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  DING_APP_KEY: z.string().default(''),
  DING_APP_SECRET: z.string().default(''),
  DING_CORP_ID: z.string().default(''),
  DING_AGENT_ID: z.string().default(''),
  DING_ADMIN_USER_IDS: z.string().default(''),
  DING_PURCHASE_USER_IDS: z.string().default(''),
  DING_LOGISTICS_USER_IDS: z.string().default(''),
  DING_MINIAPP_APP_ID: z.string().default(''),
  DING_MINIAPP_ORDER_PATH: z.string().default('pages/index/index?orderId='),
  OSS_REGION: z.string().default(''),
  OSS_BUCKET: z.string().default(''),
  OSS_ACCESS_KEY_ID: z.string().default(''),
  OSS_ACCESS_KEY_SECRET: z.string().default(''),
  OSS_ENDPOINT: z.string().default(''),
  OSS_CUSTOM_DOMAIN: z.string().refine((value) => !value || /^https:\/\//i.test(value), {
    message: 'OSS_CUSTOM_DOMAIN must use https://'
  }).default(''),
  OSS_UPLOAD_DIR: z.string().default('hangji'),
  OSS_DOWNLOAD_URL_TTL: z.coerce.number().int().min(60).max(86400).default(3600)
});

const env = envSchema.parse(process.env);
if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'development-only-secret-change-me-now') {
  throw new Error('JWT_SECRET must be replaced in production');
}

const idSet = (value) => new Set(value.split(',').map((item) => item.trim()).filter(Boolean));

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((item) => item.trim()),
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionLimit: env.DB_CONNECTION_LIMIT
  },
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  dingTalk: {
    appKey: env.DING_APP_KEY,
    appSecret: env.DING_APP_SECRET,
    corpId: env.DING_CORP_ID,
    agentId: env.DING_AGENT_ID,
    miniAppId: env.DING_MINIAPP_APP_ID,
    orderPath: env.DING_MINIAPP_ORDER_PATH,
    roleUsers: {
      admin: idSet(env.DING_ADMIN_USER_IDS),
      purchase: idSet(env.DING_PURCHASE_USER_IDS),
      logistics: idSet(env.DING_LOGISTICS_USER_IDS)
    }
  },
  oss: {
    region: env.OSS_REGION,
    bucket: env.OSS_BUCKET,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    endpoint: env.OSS_ENDPOINT,
    customDomain: env.OSS_CUSTOM_DOMAIN.replace(/\/+$/g, ''),
    uploadDir: env.OSS_UPLOAD_DIR.replace(/^\/+|\/+$/g, '') || 'hangji',
    downloadUrlTtl: env.OSS_DOWNLOAD_URL_TTL
  }
};
