import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../errors.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { parsePiWorkbook } from '../services/pi-import.js';
import { uploadImageToOss } from '../services/oss.js';

const router = Router();
router.use(authenticate, requireRoles('sales', 'admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2, parts: 3 }
});

router.post('/pi', (req, res, next) => {
  upload.single('file')(req, res, async (error) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        return next(new AppError(400, 'INVALID_PI_UPLOAD', error.code === 'LIMIT_FILE_SIZE' ? 'PI 文件不能超过 20 MB' : error.message));
      }
      return next(error);
    }
    if (!req.file) return next(new AppError(400, 'FILE_REQUIRED', '请选择 PI Excel 文件'));
    const originalFileName = String(req.body.fileName || req.file.originalname || 'PI.xlsx').slice(0, 255);
    if (path.extname(originalFileName).toLowerCase() !== '.xlsx' || req.file.buffer.subarray(0, 2).toString('ascii') !== 'PK') {
      return next(new AppError(415, 'UNSUPPORTED_PI_FILE', '目前仅支持 .xlsx 格式的 PI 报价单'));
    }
    try {
      const imported = await parsePiWorkbook(req.file.buffer);
      const warnings = [];
      const products = [];
      for (const product of imported.products) {
        const images = [];
        for (let index = 0; index < product.embeddedImages.length; index += 1) {
          const image = product.embeddedImages[index];
          try {
            images.push(await uploadImageToOss({
              buffer: image.buffer,
              size: image.buffer.length,
              mimetype: image.mime,
              originalname: `pi-row-${product.sourceRow}-${index + 1}.${image.extension}`
            }, 'product'));
          } catch (uploadError) {
            warnings.push(`第 ${product.sourceRow} 行产品图片上传失败：${uploadError.message}`);
          }
        }
        const { embeddedImages, sourceRow, ...fields } = product;
        products.push({ ...fields, images });
      }
      const fieldLabels = {
        sku: '货号', unitsPerCarton: '装箱数', cartons: '箱数', weight: '重量', volume: '体积', purchaseCost: '采购成本'
      };
      if (imported.missingFields.length) {
        warnings.push(`模板未包含${imported.missingFields.map((field) => fieldLabels[field]).join('、')}，已使用空值或 0，请导入后补充`);
      }
      return res.json({
        imported: {
          fileName: originalFileName,
          sheetName: imported.sheetName,
          customerName: imported.customerName,
          quotationDate: imported.quotationDate,
          currency: imported.currency,
          products,
          warnings
        }
      });
    } catch (parseError) {
      return next(parseError);
    }
  });
});

export default router;
