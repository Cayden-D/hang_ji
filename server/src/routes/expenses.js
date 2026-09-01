import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { authenticate, requireDingAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getOssDownloadUrl } from '../services/oss.js';
import { sendWorkNotification } from '../services/dingtalk.js';

const router = Router();
router.use(authenticate);

const attachmentSchema = z.object({
  objectKey: z.string().trim().min(1).max(1024),
  fileName: z.string().trim().min(1).max(512),
  fileSize: z.coerce.number().int().nonnegative().optional().nullable(),
  fileType: z.string().trim().max(64).optional().nullable()
});
export const createExpenseSchema = z.object({
  category: z.enum(['travel', 'transport', 'meals', 'office', 'freight', 'client', 'other']),
  amount: z.coerce.number().positive().max(9999999999999999),
  currency: z.enum(['CNY', 'USD', 'EUR']).default('CNY'),
  incurredOn: z.iso.date(),
  description: z.string().trim().min(2).max(1000),
  attachments: z.array(attachmentSchema).max(9).default([])
});
export const expenseDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(1000).default('')
}).refine((value) => value.status !== 'rejected' || value.comment.length > 0, {
  message: '驳回时必须填写原因', path: ['comment']
});

const generateExpenseNo = () => {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: '2-digit', month: '2-digit', day: '2-digit'
  }).format(new Date()).replaceAll('-', '');
  return `BX-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
};

const toDateOnly = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
};

const mapRow = (row, attachments = []) => ({
  id: row.id,
  expenseNo: row.expense_no,
  applicantUserId: row.applicant_user_id,
  applicantName: row.applicant_name,
  applicantAvatarUrl: row.applicant_avatar_url,
  category: row.category,
  amount: Number(row.amount),
  currency: row.currency,
  incurredOn: toDateOnly(row.incurred_on),
  description: row.description,
  status: row.status,
  reviewerUserId: row.reviewer_user_id,
  reviewerName: row.reviewer_name,
  reviewComment: row.review_comment || '',
  reviewedAt: row.reviewed_at,
  createdAt: row.created_at,
  attachments
});

const loadExpenses = async (where = '', params = []) => {
  const rows = await query(
    `SELECT e.*, applicant.name AS applicant_name, applicant.avatar_url AS applicant_avatar_url,
      reviewer.name AS reviewer_name
     FROM expenses e
     JOIN users applicant ON applicant.id = e.applicant_user_id
     LEFT JOIN users reviewer ON reviewer.id = e.reviewer_user_id
     ${where} ORDER BY FIELD(e.status, 'pending', 'rejected', 'approved'), e.created_at DESC`, params
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const files = await query(
    `SELECT * FROM expense_attachments WHERE expense_id IN (${placeholders}) ORDER BY created_at, id`, ids
  );
  const grouped = new Map();
  for (const file of files) {
    if (!grouped.has(file.expense_id)) grouped.set(file.expense_id, []);
    grouped.get(file.expense_id).push({
      id: file.id,
      fileName: file.file_name,
      fileSize: file.file_size,
      fileType: file.file_type,
      objectKey: file.object_key,
      url: getOssDownloadUrl(file.object_key)
    });
  }
  return rows.map((row) => mapRow(row, grouped.get(row.id) || []));
};

router.get('/', async (req, res) => {
  const items = req.user.isDingAdmin
    ? await loadExpenses()
    : await loadExpenses('WHERE e.applicant_user_id = ?', [req.user.sub]);
  res.json({ items, scope: req.user.isDingAdmin ? 'all' : 'mine' });
});

router.post('/', validate(createExpenseSchema), async (req, res) => {
  const id = randomUUID();
  const expenseNo = generateExpenseNo();
  await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO expenses
        (id, expense_no, applicant_user_id, category, amount, currency, incurred_on, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, expenseNo, req.user.sub, req.body.category, req.body.amount, req.body.currency,
        req.body.incurredOn, req.body.description]
    );
    for (const attachment of req.body.attachments) {
      await connection.execute(
        `INSERT INTO expense_attachments
          (id, expense_id, file_name, file_size, file_type, storage_provider, object_key, uploaded_by)
         VALUES (?, ?, ?, ?, ?, 'oss', ?, ?)`,
        [randomUUID(), id, attachment.fileName, attachment.fileSize ?? null,
          attachment.fileType ?? null, attachment.objectKey, req.user.sub]
      );
    }
  });
  const admins = await query('SELECT ding_user_id FROM users WHERE is_ding_admin = TRUE AND is_active = TRUE');
  await sendWorkNotification({
    userIds: admins.map((item) => item.ding_user_id),
    title: `待审批报销 ${expenseNo}`,
    markdown: `### 新的费用报销申请\n- 申请人：${req.user.name}\n- 金额：${req.body.currency} ${req.body.amount.toFixed(2)}\n- 事由：${req.body.description}`,
    orderId: id
  });
  const items = await loadExpenses('WHERE e.id = ?', [id]);
  res.status(201).json({ expense: items[0] });
});

router.patch('/:id/decision', requireDingAdmin, validate(expenseDecisionSchema), async (req, res) => {
  const rows = await query(
    `SELECT e.id, e.expense_no, e.status, e.applicant_user_id, u.ding_user_id
     FROM expenses e JOIN users u ON u.id = e.applicant_user_id WHERE e.id = ? LIMIT 1`,
    [req.params.id]
  );
  if (!rows[0]) throw notFound('Expense application not found');
  if (rows[0].status !== 'pending') throw conflict('This expense application has already been reviewed');
  const result = await query(
    `UPDATE expenses SET status = ?, reviewer_user_id = ?, review_comment = ?, reviewed_at = NOW(3)
     WHERE id = ? AND status = 'pending'`,
    [req.body.status, req.user.sub, req.body.comment || null, req.params.id]
  );
  if (!result.affectedRows) throw conflict('This expense application has already been reviewed');
  const approved = req.body.status === 'approved';
  await sendWorkNotification({
    userIds: [rows[0].ding_user_id],
    title: `报销申请${approved ? '已通过' : '已驳回'} ${rows[0].expense_no}`,
    markdown: `### 报销审批结果\n- 结果：${approved ? '已通过' : '已驳回'}\n- 审批人：${req.user.name}${req.body.comment ? `\n- 意见：${req.body.comment}` : ''}`,
    orderId: req.params.id
  });
  const items = await loadExpenses('WHERE e.id = ?', [req.params.id]);
  res.json({ expense: items[0] });
});

export default router;
