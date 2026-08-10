import ExcelJS from 'exceljs';
import { AppError } from '../errors.js';

const headerMatchers = {
  sku: [/^sku$/, /itemno/, /itemnumber/, /货号/, /款号/],
  name: [/^name$/, /productname/, /itemname/, /品名/, /产品名称/],
  image: [/picture/, /image/, /photo/, /图片/, /照片/],
  variant: [/specification/, /^spec$/, /variant/, /规格/, /款式/, /颜色/],
  unitsPerCarton: [/unitspercarton/, /qtypercarton/, /装箱数/, /每箱数量/],
  cartons: [/cartoncount/, /^cartons?$/, /箱数/],
  weight: [/weight/, /重量/],
  volume: [/^cbm$/, /volume/, /体积/],
  quantity: [/^quantity$/, /^qty$/, /数量/],
  unitPrice: [/unit.*price/, /exwprice/, /单价/],
  purchaseCost: [/purchasecost/, /costprice/, /采购成本/],
  amount: [/^amount$/, /^totalprice$/, /总价/, /金额/]
};

const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_\-/$:.（）()]/g, '');

export const cellValue = (cell) => {
  const value = cell?.value;
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return value.result ?? '';
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    if ('text' in value) return value.text || '';
  }
  return value;
};

export const parseNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^0-9.+-]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
};

const detectColumns = (worksheet) => {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 80); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns = {};
    for (let column = 1; column <= row.cellCount; column += 1) {
      const header = normalize(cellValue(row.getCell(column)));
      if (!header) continue;
      for (const [field, matchers] of Object.entries(headerMatchers)) {
        if (!columns[field] && matchers.some((matcher) => matcher.test(header))) columns[field] = column;
      }
    }
    if (columns.name && columns.quantity && columns.unitPrice) return { rowNumber, columns };
  }
  return null;
};

const findLabelValue = (worksheet, lastRow, labels) => {
  for (let rowNumber = 1; rowNumber < lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= row.cellCount; column += 1) {
      const value = normalize(cellValue(row.getCell(column)));
      if (!labels.some((label) => value === normalize(label))) continue;
      for (let next = column + 1; next <= row.cellCount; next += 1) {
        const candidate = cellValue(row.getCell(next));
        if (String(candidate ?? '').trim()) return String(candidate).trim();
      }
    }
  }
  return '';
};

const findQuotationDate = (worksheet, lastRow) => {
  for (let rowNumber = 1; rowNumber < lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= row.cellCount; column += 1) {
      const value = cellValue(row.getCell(column));
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const match = String(value ?? '').match(/(?:date|日期)\s*[:：]?\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})/i);
      if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  return '';
};

const imageMime = (extension) => ({ jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' })[extension] || null;

export const parsePiWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw new AppError(400, 'INVALID_PI_FILE', '无法读取该 Excel 文件，请确认文件为有效的 .xlsx 格式', { reason: error.message });
  }

  let selected;
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > 5000) {
      throw new AppError(422, 'PI_TOO_LARGE', 'PI 工作表不能超过 5000 行');
    }
    const detected = detectColumns(worksheet);
    if (detected) { selected = { worksheet, ...detected }; break; }
  }
  if (!selected) {
    throw new AppError(422, 'PI_HEADER_NOT_FOUND', '没有找到产品表头，需要至少包含名称、数量和单价列');
  }

  const { worksheet, rowNumber: headerRow, columns } = selected;
  const imagesByRow = new Map();
  for (const placement of worksheet.getImages()) {
    const row = Number(placement.range?.tl?.nativeRow) + 1;
    const image = workbook.getImage(placement.imageId);
    const mime = imageMime(String(image?.extension || '').toLowerCase());
    if (!row || !image?.buffer || !mime) continue;
    if (!imagesByRow.has(row)) imagesByRow.set(row, []);
    if (imagesByRow.get(row).length >= 9) continue;
    imagesByRow.get(row).push({
      buffer: Buffer.from(image.buffer),
      mime,
      extension: image.extension === 'jpeg' ? 'jpg' : image.extension
    });
  }

  const products = [];
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const name = String(cellValue(row.getCell(columns.name)) ?? '').trim();
    if (/^(total|合计|总计)$/i.test(name)) break;
    const quantity = parseNumber(cellValue(row.getCell(columns.quantity)));
    const unitPrice = parseNumber(cellValue(row.getCell(columns.unitPrice)));
    if (!name && !quantity && !unitPrice) continue;
    if (!name || quantity <= 0) continue;
    if (products.length >= 100) throw new AppError(422, 'PI_TOO_MANY_PRODUCTS', '单张 PI 最多导入 100 款产品');
    products.push({
      sourceRow: rowNumber,
      sku: columns.sku ? String(cellValue(row.getCell(columns.sku)) ?? '').trim() : '',
      name,
      variant: columns.variant ? String(cellValue(row.getCell(columns.variant)) ?? '').trim() || name : name,
      unitsPerCarton: columns.unitsPerCarton ? Math.max(0, Math.round(parseNumber(cellValue(row.getCell(columns.unitsPerCarton))))) : 0,
      cartons: columns.cartons ? Math.max(0, Math.round(parseNumber(cellValue(row.getCell(columns.cartons))))) : 0,
      weight: columns.weight ? Math.max(0, parseNumber(cellValue(row.getCell(columns.weight)))) : 0,
      volume: columns.volume ? Math.max(0, parseNumber(cellValue(row.getCell(columns.volume)))) : 0,
      quantity: Math.max(1, Math.round(quantity)),
      unitPrice: Math.max(0, unitPrice),
      purchaseCost: columns.purchaseCost ? Math.max(0, parseNumber(cellValue(row.getCell(columns.purchaseCost)))) : 0,
      quotedTotal: columns.amount ? Math.max(0, parseNumber(cellValue(row.getCell(columns.amount)))) : Math.max(0, quantity * unitPrice),
      embeddedImages: imagesByRow.get(rowNumber) || []
    });
  }
  if (!products.length) throw new AppError(422, 'PI_PRODUCTS_NOT_FOUND', '产品表中没有可导入的有效产品行');

  const missingFields = ['sku', 'unitsPerCarton', 'cartons', 'weight', 'volume', 'purchaseCost']
    .filter((field) => !columns[field]);
  return {
    sheetName: worksheet.name,
    customerName: findLabelValue(worksheet, headerRow, ['To', 'To:', '客户', '客户名称']),
    quotationDate: findQuotationDate(worksheet, headerRow),
    currency: 'USD',
    products,
    missingFields
  };
};
