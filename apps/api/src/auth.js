import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';
export { hashPassword, verifyPassword } from './password.js';

const SESSION_COOKIE = 'deposit_studio_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return index < 0 ? [value, ''] : [value.slice(0,index), decodeURIComponent(value.slice(index+1))];
  }));
}

export async function currentUser(req) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await db.execute({
    sql:`SELECT u.id, u.login_id loginId, u.display_name displayName, u.role, u.avatar_path avatar, u.must_change_password mustChangePassword
         FROM web_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1 LIMIT 1`,
    args:[tokenHash(token)]
  });
  return result.rows[0] || null;
}

export async function createSession(res, userId, req) {
  const token = randomBytes(32).toString('base64url');
  await db.execute({
    sql:`INSERT INTO web_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))`,
    args:[randomBytes(16).toString('hex'), userId, tokenHash(token)]
  });
  const secure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  const cookiePolicy = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${cookiePolicy}; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

export async function destroySession(req, res) {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) await db.execute({ sql:'DELETE FROM web_sessions WHERE token_hash = ?', args:[tokenHash(token)] });
  const secure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  const cookiePolicy = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; ${cookiePolicy}; Max-Age=0`);
}

export async function requireAuth(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error:'로그인이 필요합니다.' });
  req.user = user;
  next();
}

export function requireManager(req, res, next) {
  if (!['super','admin'].includes(req.user?.role)) return res.status(403).json({ error:'관리자 권한이 필요합니다.' });
  next();
}

export function requireSuper(req, res, next) {
  if (req.user?.role !== 'super') return res.status(403).json({ error:'최고 관리자 권한이 필요합니다.' });
  next();
}
