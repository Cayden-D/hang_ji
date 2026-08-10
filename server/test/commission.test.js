import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderPerformance } from '../src/domain/commission.js';

test('calculates profit and commission using converted order amounts', () => {
  const result = calculateOrderPerformance({
    totalAmount: 12000,
    purchaseTotal: 7000,
    freight: 800,
    receivedCny: null,
    exchangeRate: 7.2,
    commissionRatePercent: 3
  });
  assert.equal(result.profitOriginal, 4200);
  assert.equal(result.revenueCny, 86400);
  assert.equal(result.productCostCny, 50400);
  assert.equal(result.freightCny, 5760);
  assert.equal(result.profitCny, 30240);
  assert.equal(result.commissionCny, 907.2);
});

test('uses actual received CNY instead of an estimated converted order amount', () => {
  const result = calculateOrderPerformance({
    totalAmount: 10000,
    purchaseTotal: 6000,
    freight: 500,
    receivedCny: 71000,
    exchangeRate: 7,
    commissionRatePercent: 2.5
  });
  assert.equal(result.convertedOrderAmountCny, 70000);
  assert.equal(result.revenueCny, 71000);
  assert.equal(result.profitCny, 25500);
  assert.equal(result.commissionCny, 637.5);
});

test('keeps original-currency profit but does not invent CNY amounts without a rate', () => {
  const result = calculateOrderPerformance({
    totalAmount: 1000,
    purchaseTotal: 400,
    freight: 100,
    receivedCny: null,
    exchangeRate: null,
    commissionRatePercent: 5
  });
  assert.equal(result.profitOriginal, 500);
  assert.equal(result.profitCny, null);
  assert.equal(result.commissionCny, null);
});
