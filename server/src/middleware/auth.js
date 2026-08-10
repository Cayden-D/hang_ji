import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { AppError, forbidden } from '../errors.js';

export const signSession = (user) => jwt.sign(
  { sub: user.id, dingUserId: user.dingUserId, role: user.role, name: user.name },
  config.jwt.secret,
  { expiresIn: config.jwt.expiresIn, issuer: 'hangji-api', audience: 'hangji-miniapp' }
);

export const authenticate = async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Missing session token'));
  try {
    const claims = jwt.verify(token, config.jwt.secret, { issuer: 'hangji-api', audience: 'hangji-miniapp' });
    const rows = await query('SELECT id, ding_user_id, name, role, is_active FROM users WHERE id = ? LIMIT 1', [claims.sub]);
    const user = rows[0];
    if (!user || !user.is_active) return next(new AppError(401, 'USER_UNAVAILABLE', 'User no longer exists or is disabled'));
    req.user = { ...claims, sub: user.id, dingUserId: user.ding_user_id, name: user.name, role: user.role };
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, 'INVALID_SESSION', 'Session token is invalid or expired'));
  }
};

export const requireRoles = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(forbidden('Your role cannot perform this action'));
  return next();
};
