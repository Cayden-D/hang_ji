import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listRootDepartmentUsers } from '../services/dingtalk.js';

const router = Router();
router.use(authenticate, requireRoles('admin'));

const syncRootDepartment = async () => {
  const profiles = await listRootDepartmentUsers();
  await withTransaction(async (connection) => {
    for (const profile of profiles) {
      await connection.execute(
        `INSERT INTO users
          (id, ding_user_id, union_id, name, avatar_url, mobile, email, org_email, title, job_number,
           work_place, ding_roles_json, is_ding_admin, is_boss, is_senior, is_leader, manager_user_id, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          union_id = VALUES(union_id), name = VALUES(name), avatar_url = VALUES(avatar_url),
          mobile = VALUES(mobile), email = VALUES(email), org_email = VALUES(org_email), title = VALUES(title),
          job_number = VALUES(job_number), work_place = VALUES(work_place), ding_roles_json = VALUES(ding_roles_json),
          is_ding_admin = VALUES(is_ding_admin), is_boss = VALUES(is_boss), is_senior = VALUES(is_senior),
          is_leader = VALUES(is_leader), manager_user_id = VALUES(manager_user_id),
          role = IF(VALUES(is_ding_admin) = TRUE, 'admin', role)`,
        [randomUUID(), profile.dingUserId, profile.unionId, profile.name, profile.avatarUrl, profile.mobile,
          profile.email, profile.orgEmail, profile.title, profile.jobNumber, profile.workPlace,
          JSON.stringify(profile.dingRoles), profile.isDingAdmin, profile.isBoss, profile.isSenior,
          profile.isLeader, profile.managerUserId, profile.isDingAdmin ? 'admin' : 'sales']
      );
    }
  });
  return profiles.length;
};

router.get('/', async (_req, res) => {
  let sync = { ok: true, departmentId: 1, count: 0 };
  try {
    sync.count = await syncRootDepartment();
  } catch (error) {
    logger.warn({ err: error }, 'Unable to sync DingTalk root department users');
    sync = {
      ok: false,
      departmentId: 1,
      count: 0,
      error: error.message || 'DingTalk department synchronization failed'
    };
  }
  const rows = await query(
    `SELECT id, ding_user_id, union_id, name, avatar_url, mobile, email, title, job_number,
      role, is_ding_admin, is_active, last_login_at, created_at
     FROM users ORDER BY is_ding_admin DESC, name ASC`
  );
  res.json({ items: rows, sync });
});

router.patch('/:id/role', validate(z.object({ role: z.enum(['sales', 'purchase', 'logistics', 'admin']) })), async (req, res) => {
  const rows = await query('SELECT id, is_ding_admin FROM users WHERE id = ? LIMIT 1', [req.params.id]);
  if (!rows[0]) throw notFound('User not found');
  if (rows[0].is_ding_admin && req.body.role !== 'admin') {
    throw conflict('DingTalk administrators must keep the system administrator role');
  }
  if (req.params.id === req.user.sub && req.body.role !== 'admin') {
    throw conflict('You cannot remove your own administrator role');
  }
  const result = await query('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id]);
  res.json({ id: req.params.id, role: req.body.role });
});

router.patch('/:id/active', validate(z.object({ isActive: z.boolean() })), async (req, res) => {
  if (req.params.id === req.user.sub && !req.body.isActive) {
    throw conflict('You cannot disable your own account');
  }
  const result = await query('UPDATE users SET is_active = ? WHERE id = ?', [req.body.isActive, req.params.id]);
  if (!result.affectedRows) throw notFound('User not found');
  res.json({ id: req.params.id, isActive: req.body.isActive });
});

export default router;
