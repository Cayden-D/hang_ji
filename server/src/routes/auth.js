import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { AppError } from '../errors.js';
import { authenticate, signSession } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getUserByAuthCode, resolveInitialRole } from '../services/dingtalk.js';

const router = Router();
const loginSchema = z.object({ code: z.string().trim().min(4).max(512) });

const mapUser = (row) => ({
  id: row.id,
  dingUserId: row.ding_user_id,
  unionId: row.union_id,
  name: row.name,
  avatarUrl: row.avatar_url,
  mobile: row.mobile,
  email: row.email,
  orgEmail: row.org_email,
  title: row.title,
  jobNumber: row.job_number,
  workPlace: row.work_place,
  dingRoles: (() => {
    try { return JSON.parse(row.ding_roles_json || '[]'); } catch { return []; }
  })(),
  isDingAdmin: Boolean(row.is_ding_admin),
  isBoss: Boolean(row.is_boss),
  isSenior: Boolean(row.is_senior),
  isLeader: Boolean(row.is_leader),
  managerUserId: row.manager_user_id,
  role: row.role,
  commissionRatePercent: Number(row.commission_rate_percent || 0),
  isActive: Boolean(row.is_active)
});

router.post('/dingtalk', validate(loginSchema), async (req, res) => {
  const profile = await getUserByAuthCode(req.body.code);
  const initialRole = profile.isDingAdmin ? 'admin' : resolveInitialRole(profile.dingUserId);
  await query(
    `INSERT INTO users
      (id, ding_user_id, union_id, name, avatar_url, mobile, email, org_email, title, job_number, work_place,
       ding_roles_json, is_ding_admin, is_boss, is_senior, is_leader, manager_user_id, role, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE
      union_id = VALUES(union_id), name = VALUES(name), avatar_url = VALUES(avatar_url),
      mobile = VALUES(mobile), email = VALUES(email), org_email = VALUES(org_email), title = VALUES(title),
      job_number = VALUES(job_number), work_place = VALUES(work_place), ding_roles_json = VALUES(ding_roles_json),
      is_ding_admin = VALUES(is_ding_admin), is_boss = VALUES(is_boss), is_senior = VALUES(is_senior),
      is_leader = VALUES(is_leader), manager_user_id = VALUES(manager_user_id),
      role = IF(VALUES(is_ding_admin) = TRUE, 'admin', role), last_login_at = NOW(3)`,
    [randomUUID(), profile.dingUserId, profile.unionId, profile.name, profile.avatarUrl, profile.mobile,
      profile.email, profile.orgEmail, profile.title, profile.jobNumber, profile.workPlace,
      JSON.stringify(profile.dingRoles), profile.isDingAdmin, profile.isBoss, profile.isSenior,
      profile.isLeader, profile.managerUserId, initialRole]
  );
  const rows = await query('SELECT * FROM users WHERE ding_user_id = ? LIMIT 1', [profile.dingUserId]);
  const user = mapUser(rows[0]);
  if (!user.isActive) throw new AppError(403, 'USER_DISABLED', 'This account has been disabled');
  res.json({ token: signSession(user), user });
});

router.get('/me', authenticate, async (req, res) => {
  const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.sub]);
  if (!rows[0] || !rows[0].is_active) throw new AppError(401, 'USER_UNAVAILABLE', 'User no longer exists or is disabled');
  res.json({ user: mapUser(rows[0]) });
});

export default router;
