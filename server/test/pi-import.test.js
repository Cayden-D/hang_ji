import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseNumber, parsePiWorkbook } from '../src/services/pi-import.js';

test('PI number parser accepts currency-formatted text', () => {
  assert.equal(parseNumber('$1,234.56'), 1234.56);
  assert.equal(parseNumber('-'), 0);
});

test('PI workbook parser finds products and embedded row images', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Quotation');
  sheet.addRow(['Quotation']);
  sheet.addRow(['To:', 'Lili', null, null, null, null, 'Date: 2026/8/10']);
  sheet.addRow([]);
  sheet.addRow(['Name', 'Item Picture', 'SPECIFICATION', 'CBM', 'Quantity', 'Unit EXW Price/$', 'AMOUNT']);
  sheet.addRow(['Pumpkin pendant', '', 'Orange / 10 cm', '-', 20, '$0.66', 13.2]);
  sheet.addRow(['Total', '', '', '', '', '', 13.2]);
  const imageId = workbook.addImage({
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    extension: 'png'
  });
  sheet.addImage(imageId, { tl: { col: 1, row: 4 }, ext: { width: 20, height: 20 } });

  const parsed = await parsePiWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(parsed.customerName, 'Lili');
  assert.equal(parsed.quotationDate, '2026-08-10');
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].name, 'Pumpkin pendant');
  assert.equal(parsed.products[0].variant, 'Orange / 10 cm');
  assert.equal(parsed.products[0].quantity, 20);
  assert.equal(parsed.products[0].unitPrice, 0.66);
  assert.equal(parsed.products[0].embeddedImages.length, 1);
});

