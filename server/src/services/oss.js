import { randomUUID } from 'node:crypto';
import path from 'node:path';
import OSS from 'ali-oss';
import { config } from '../config.js';
import { AppError } from '../errors.js';

let client;

const getClient = () => {
  if (client) return client;
  const options = {
    region: config.oss.region,
    bucket: config.oss.bucket,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    authorizationV4: true,
    secure: true
  };
  if (config.oss.customDomain) {
    options.endpoint = config.oss.customDomain;
    options.cname = true;
  } else if (config.oss.endpoint) {
    options.endpoint = config.oss.endpoint;
  }
  if (!options.region || !options.bucket || !options.accessKeyId || !options.accessKeySecret) {
    throw new AppError(503, 'OSS_NOT_CONFIGURED', 'OSS storage is not configured');
  }
  client = new OSS(options);
  return client;
};

const mimeExtension = (mimeType) => ({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif'
})[mimeType] || '';

const safeExtension = (file) => {
  const original = path.extname(file.originalname || '').toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(original) ? original : mimeExtension(file.mimetype);
};

export const getOssDownloadUrl = (objectKey) => {
  if (!objectKey) return null;
  try {
    return getClient().signatureUrl(objectKey, { expires: config.oss.downloadUrlTtl, method: 'GET' });
  } catch (_error) {
    return null;
  }
};

export const uploadImageToOss = async (file, category = 'misc') => {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeCategory = ['product', 'payment', 'logistics', 'expense'].includes(category) ? category : 'misc';
  const objectKey = `${config.oss.uploadDir}/${safeCategory}/${now.getUTCFullYear()}/${month}/${randomUUID()}${safeExtension(file)}`;
  await getClient().put(objectKey, file.buffer, {
    mime: file.mimetype,
    headers: { 'Cache-Control': 'private, max-age=31536000, immutable' }
  });
  return {
    provider: 'oss',
    objectKey,
    url: getOssDownloadUrl(objectKey),
    fileName: file.originalname || `image${safeExtension(file)}`,
    fileSize: file.size,
    fileType: file.mimetype,
    sourceType: 'oss'
  };
};

export const uploadFileToOss = async (file, category = 'expense') => {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const extension = safeExtension(file);
  const safeCategory = category === 'expense' ? 'expense' : 'misc';
  const objectKey = `${config.oss.uploadDir}/${safeCategory}/${now.getUTCFullYear()}/${month}/${randomUUID()}${extension}`;
  await getClient().put(objectKey, file.buffer, {
    mime: file.mimetype || 'application/octet-stream',
    headers: { 'Cache-Control': 'private, max-age=31536000, immutable' }
  });
  return {
    provider: 'oss',
    objectKey,
    url: getOssDownloadUrl(objectKey),
    fileName: file.originalname || `attachment${extension}`,
    fileSize: file.size,
    fileType: file.mimetype || 'application/octet-stream',
    sourceType: 'oss'
  };
};
