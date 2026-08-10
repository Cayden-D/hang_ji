import test from 'node:test';
import assert from 'node:assert/strict';
import { adminReplaceOrderSchema, adminUpdateShipmentSchema, createOrderSchema, shipmentSchema } from '../src/schemas/orders.js';

const validOrder = {
  customerName: 'NORDHAUS GmbH',
  deadline: '2026-08-18',
  paymentMethod: 'T/T',
  products: [{
    sku: 'BLK-07-WH', name: '云朵绒毯', variant: '奶油白', unitsPerCarton: 20,
    cartons: 10, weight: 120, volume: 1.2, quantity: 200, unitPrice: 15.2,
    purchaseCost: 1900,
    images: [{ provider: 'oss', objectKey: 'hangji/product/2026/08/file-1.jpg', fileName: 'blanket.jpg', fileType: 'image/jpeg', sourceType: 'oss' }]
  }]
};

test('order accepts multiple products and OSS metadata', () => {
  const result = createOrderSchema.safeParse({
    ...validOrder,
    products: [validOrder.products[0], { ...validOrder.products[0], sku: 'BLK-07-GY', variant: '雾灰色' }]
  });
  assert.equal(result.success, true);
  assert.equal(result.data.products.length, 2);
  assert.equal(result.data.products[0].images[0].objectKey, 'hangji/product/2026/08/file-1.jpg');
});

test('order accepts trust assurance full payment and an empty SKU', () => {
  const parsed = createOrderSchema.parse({
    ...validOrder,
    paymentMethod: '信保全款',
    products: [{ ...validOrder.products[0], sku: '' }]
  });
  assert.equal(parsed.paymentMethod, '信保全款');
  assert.equal(parsed.products[0].sku, '');
});

test('shipment rejects arrival before shipment', () => {
  const result = shipmentSchema.safeParse({
    logisticsCompany: 'DHL', trackingNo: '123', shippedOn: '2026-08-20', estimatedArrivalOn: '2026-08-19'
  });
  assert.equal(result.success, false);
});

test('admin order replacement accepts existing and new products', () => {
  const result = adminReplaceOrderSchema.safeParse({
    customerName: 'Nordhavn Living', customerContact: '', shippingAddress: '', destination: '丹麦',
    deadline: '2026-08-20', paymentMethod: 'T/T', currency: 'USD', freight: 120,
    note: 'admin correction', ownerUserId: '7c5d8985-2ae1-4d3a-b797-e34982e43d2f',
    products: [{
      id: '3a9d7165-6089-4692-a1ab-a62139981600', sku: 'BLK-07-WH', name: '云朵绒毯', variant: '奶油白',
      unitsPerCarton: 20, cartons: 10, weight: 120, volume: 1.2, quantity: 200,
      unitPrice: 15.2, purchaseCost: 1900, purchaseStatus: 'completed'
    }, {
      sku: 'BLK-07-GY', name: '云朵绒毯', variant: '雾灰色', unitsPerCarton: 20, cartons: 5,
      weight: 60, volume: 0.6, quantity: 100, unitPrice: 15.2, purchaseCost: 950, purchaseStatus: 'pending'
    }]
  });
  assert.equal(result.success, true);
  assert.equal(result.data.products.length, 2);
});

test('admin shipment replacement rejects reversed dates', () => {
  const result = adminUpdateShipmentSchema.safeParse({
    logisticsCompany: 'DHL', trackingNo: 'DHL-1', shippedOn: '2026-08-20', estimatedArrivalOn: '2026-08-19'
  });
  assert.equal(result.success, false);
});
