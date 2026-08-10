import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewOrder, derivePurchaseStatus } from '../src/domain/order-state.js';

test('purchase status reflects line completion', () => {
  assert.equal(derivePurchaseStatus(0, 3), 'pending_purchase');
  assert.equal(derivePurchaseStatus(1, 3), 'purchasing');
  assert.equal(derivePurchaseStatus(3, 3), 'purchased');
});

test('sales only sees owned orders', () => {
  assert.equal(canViewOrder({ role: 'sales', sub: 'u1' }, { owner_user_id: 'u1', status: 'pending_purchase' }), true);
  assert.equal(canViewOrder({ role: 'sales', sub: 'u1' }, { owner_user_id: 'u2', status: 'pending_purchase' }), false);
});

test('logistics only sees purchased or shipped orders', () => {
  assert.equal(canViewOrder({ role: 'logistics', sub: 'u1' }, { owner_user_id: 'u2', status: 'purchasing' }), false);
  assert.equal(canViewOrder({ role: 'logistics', sub: 'u1' }, { owner_user_id: 'u2', status: 'purchased' }), true);
});
