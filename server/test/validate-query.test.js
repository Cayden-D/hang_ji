import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/middleware/validate.js';
import { listOrdersSchema } from '../src/schemas/orders.js';

test('query validation works with the read-only Express 5 req.query getter', () => {
  const req = {};
  Object.defineProperty(req, 'query', {
    configurable: true,
    get: () => ({ page: '2', pageSize: '50' })
  });
  let nextError;
  validate(listOrdersSchema, 'query')(req, {}, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.deepEqual(req.validatedQuery, { page: 2, pageSize: 50 });
  assert.deepEqual(req.query, { page: '2', pageSize: '50' });
});
