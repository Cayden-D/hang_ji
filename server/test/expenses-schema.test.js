import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpenseSchema, expenseDecisionSchema } from '../src/routes/expenses.js';

test('expense application accepts receipts and coerces the amount', () => {
  const result = createExpenseSchema.safeParse({
    category: 'travel',
    amount: '128.50',
    currency: 'CNY',
    incurredOn: '2026-09-01',
    description: '上海客户拜访交通费',
    attachments: [{ objectKey: 'hangji/expense/a.jpg', fileName: '发票.jpg', fileSize: 1234, fileType: 'image/jpeg' }]
  });
  assert.equal(result.success, true);
  assert.equal(result.data.amount, 128.5);
  assert.equal(result.data.isReimbursed, false);
});

test('expense rejection requires a review comment', () => {
  assert.equal(expenseDecisionSchema.safeParse({ status: 'rejected', comment: '' }).success, false);
  assert.equal(expenseDecisionSchema.safeParse({ status: 'rejected', comment: '凭证金额不一致' }).success, true);
  assert.equal(expenseDecisionSchema.safeParse({ status: 'approved' }).success, true);
});
