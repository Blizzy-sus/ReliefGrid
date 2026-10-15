import crypto from 'node:crypto';
import { HttpError } from './db.js';
import { audit, iso } from './services/common.js';

const SESSION_HOURS = 12;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Dummy hash so a login for an unknown user costs the same as a real one.
const DUMMY_HASH = hashPassword('not-a-real-password');

export function login(db, username, password, at) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  const ok = verifyPassword(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.active) {
    audit(db, user?.id, 'LOGIN_FAILED', 'user', user?.id, { username: String(username || '').slice(0, 60) }, at);
    throw new HttpError(401, 'BAD_CREDENTIALS', 'Incorrect username or password.');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date(iso(at));
  const expires = new Date(now.getTime() + SESSION_HOURS * 3_600_000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), user.id, now.toISOString(), expires.toISOString());
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), user.id);
  audit(db, user.id, 'LOGIN', 'user', user.id, null, at);
  return { token, expiresAt: expires.toISOString(), user: publicUser(user) };
}

export function logout(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function publicUser(u) {
  return {
    id: u.id, username: u.username, fullName: u.full_name, role: u.role,
    campId: u.camp_id ?? null, warehouseId: u.warehouse_id ?? null, phone: u.phone ?? null,
  };
}

/** Express middleware: attaches req.user or rejects with 401. */
export function authenticate(db, clock = () => undefined) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.'));
    const row = db.prepare(`
      SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).get(sha256(m[1]));
    if (!row || !row.active || row.session_expires < iso(clock())) {
      return next(new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.'));
    }
    req.user = publicUser(row);
    req.token = m[1];
    next();
  };
}

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  WAREHOUSE: 'warehouse_manager',
  CAMP: 'camp_coordinator',
  VOLUNTEER: 'volunteer',
});

/** Role gate. */
export const requireRole = (...roles) => (req, _res, next) => (
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'FORBIDDEN', 'Your role does not permit this action.'))
);

/** Simple in-memory limiter against password guessing: 8 failures per 10 minutes per key. */
export function createLoginLimiter({ max = 8, windowMs = 10 * 60_000 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      hits.set(key, list);
      if (list.length >= max) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-ins. Try again in a few minutes.');
    },
    fail(key) { hits.set(key, [...(hits.get(key) || []), Date.now()]); },
    reset(key) { hits.delete(key); },
  };
}
