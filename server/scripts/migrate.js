import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await fs.readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'hangji',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hangji',
  multipleStatements: true,
  charset: 'utf8mb4'
});

try {
  await connection.query(sql);
  // 兼容已经完成首次部署的数据库；MySQL 5.7 不支持 ADD COLUMN IF NOT EXISTS，
  // 因此先读取 information_schema，再逐列补充。
  const [existingRows] = await connection.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
    [process.env.DB_NAME || 'hangji']
  );
  const existing = new Set(existingRows.map((row) => row.COLUMN_NAME));
  const profileColumns = {
    email: 'VARCHAR(255) NULL',
    org_email: 'VARCHAR(255) NULL',
    title: 'VARCHAR(128) NULL',
    job_number: 'VARCHAR(128) NULL',
    work_place: 'VARCHAR(255) NULL',
    department_name: 'VARCHAR(255) NULL',
    ding_roles_json: 'TEXT NULL',
    is_ding_admin: 'BOOLEAN NOT NULL DEFAULT FALSE',
    is_boss: 'BOOLEAN NOT NULL DEFAULT FALSE',
    is_senior: 'BOOLEAN NOT NULL DEFAULT FALSE',
    is_leader: 'BOOLEAN NOT NULL DEFAULT FALSE',
    manager_user_id: 'VARCHAR(128) NULL',
    commission_rate_percent: 'DECIMAL(6,3) NOT NULL DEFAULT 0'
  };
  for (const [name, definition] of Object.entries(profileColumns)) {
    if (!existing.has(name)) await connection.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }

  const [productRows] = await connection.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'sku'`,
    [process.env.DB_NAME || 'hangji']
  );
  if (productRows[0]?.IS_NULLABLE === 'NO') {
    // 空货号写为 NULL，使同一订单内多个未填写货号的产品不会触发唯一索引冲突。
    await connection.query('ALTER TABLE products MODIFY sku VARCHAR(128) NULL');
  }

  const [orderRows] = await connection.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders'`,
    [process.env.DB_NAME || 'hangji']
  );
  const orderColumns = new Set(orderRows.map((row) => row.COLUMN_NAME));
  // 旧版“到账人民币(received_cny)”更名为“实收美金(received_usd)”，已有数据直接迁移保留。
  if (orderColumns.has('received_cny') && !orderColumns.has('received_usd')) {
    await connection.query('ALTER TABLE orders CHANGE received_cny received_usd DECIMAL(18,2) NULL');
    orderColumns.delete('received_cny');
    orderColumns.add('received_usd');
  }
  const financeColumns = {
    received_usd: 'DECIMAL(18,2) NULL',
    exchange_rate: 'DECIMAL(12,6) NULL',
    commission_rate_percent: 'DECIMAL(6,3) NULL',
    is_completed: 'BOOLEAN NOT NULL DEFAULT FALSE',
    completed_at: 'DATETIME(3) NULL'
  };
  for (const [name, definition] of Object.entries(financeColumns)) {
    if (!orderColumns.has(name)) await connection.query(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
  }

  const [attachmentRows] = await connection.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attachments'`,
    [process.env.DB_NAME || 'hangji']
  );
  const attachmentColumns = new Set(attachmentRows.map((row) => row.COLUMN_NAME));
  // 历史钉盘列仅为读取旧数据保留，并改为可空；所有新附件只写 OSS 字段。
  const legacyColumnsRequireChange = attachmentRows.some(
    (row) => ['space_id', 'file_id'].includes(row.COLUMN_NAME) && row.IS_NULLABLE === 'NO'
  );
  if (legacyColumnsRequireChange) {
    await connection.query('ALTER TABLE attachments MODIFY space_id VARCHAR(128) NULL, MODIFY file_id VARCHAR(255) NULL');
  }
  if (!attachmentColumns.has('storage_provider')) {
    await connection.query('ALTER TABLE attachments ADD COLUMN storage_provider VARCHAR(32) NULL AFTER source_type');
  }
  if (!attachmentColumns.has('object_key')) {
    await connection.query('ALTER TABLE attachments ADD COLUMN object_key VARCHAR(1024) NULL AFTER storage_provider');
    // 128 字符前缀兼容较旧的 MySQL/MariaDB utf8mb4 索引长度限制。
    await connection.query('CREATE INDEX idx_attachments_object_key ON attachments (storage_provider, object_key(128))');
  }

  const [expenseRows] = await connection.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'expenses'`,
    [process.env.DB_NAME || 'hangji']
  );
  const expenseColumns = new Set(expenseRows.map((row) => row.COLUMN_NAME));
  if (expenseColumns.size && !expenseColumns.has('is_reimbursed')) {
    await connection.query('ALTER TABLE expenses ADD COLUMN is_reimbursed BOOLEAN NOT NULL DEFAULT FALSE AFTER description');
  }
  if (expenseColumns.size) {
    await connection.query('ALTER TABLE expense_attachments MODIFY file_type VARCHAR(128) NULL');
  }
  console.info('Database schema is ready.');
} finally {
  await connection.end();
}
