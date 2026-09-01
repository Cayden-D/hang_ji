import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { uploadFileToOss, uploadImageToOss } from '../services/oss.js';

const router = Router();
router.use(authenticate);

const detectImageMime = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand.startsWith('hei') || brand.startsWith('mif1')) return 'image/heic';
  }
  return null;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 6 }
});

const expenseFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5, parts: 6 }
});

const allowedExpenseExtensions = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.pdf', '.doc', '.docx',
  '.xls', '.xlsx', '.csv', '.txt', '.zip'
]);

router.post('/image', (req, res, next) => {
  upload.single('file')(req, res, async (error) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        return next(new AppError(400, 'INVALID_UPLOAD', error.code === 'LIMIT_FILE_SIZE' ? 'Image must not exceed 10 MB' : error.message));
      }
      return next(error);
    }
    if (!req.file) return next(new AppError(400, 'FILE_REQUIRED', 'Image file is required'));
    const detectedMime = detectImageMime(req.file.buffer);
    if (!detectedMime) return next(new AppError(415, 'UNSUPPORTED_IMAGE', 'Only JPG, PNG, WebP, GIF and HEIC images are supported'));
    req.file.mimetype = detectedMime;
    try {
      const attachment = await uploadImageToOss(req.file, req.body.category);
      return res.status(201).json({ attachment });
    } catch (uploadError) {
      return next(uploadError);
    }
  });
});

router.post('/file', (req, res, next) => {
  expenseFileUpload.single('file')(req, res, async (error) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        return next(new AppError(400, 'INVALID_UPLOAD', error.code === 'LIMIT_FILE_SIZE' ? 'File must not exceed 25 MB' : error.message));
      }
      return next(error);
    }
    if (!req.file) return next(new AppError(400, 'FILE_REQUIRED', 'File is required'));
    const originalName = String(req.body.originalName || req.file.originalname || '');
    const extension = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
    if (!allowedExpenseExtensions.has(extension)) {
      return next(new AppError(415, 'UNSUPPORTED_FILE', 'Only images, PDF, Office, CSV, TXT and ZIP files are supported'));
    }
    req.file.originalname = originalName;
    try {
      const attachment = await uploadFileToOss(req.file, 'expense');
      return res.status(201).json({ attachment });
    } catch (uploadError) {
      return next(uploadError);
    }
  });
});

export default router;
