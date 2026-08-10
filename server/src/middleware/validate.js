import { AppError } from '../errors.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(new AppError(422, 'VALIDATION_ERROR', 'Request data is invalid', result.error.flatten()));
  }
  // Express 5 将 req.query 实现为只读 getter，不能再通过 req.query = ... 覆盖。
  // 查询参数的 Zod 转换结果单独保存，body 仍可原位替换。
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  return next();
};
