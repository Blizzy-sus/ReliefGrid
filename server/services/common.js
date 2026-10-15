import { HttpError } from '../db.js';

/** ISO timestamp for "now", or for an injected clock (used by seeding and tests). */
export const iso = (at) => (at instanceof Date ? at : at ? new Date(at) : new Date()).toISOString();

export function audit(db, userId, action, entityType, entityId, details, at) {
  db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId ?? null, action, entityType, entityId ?? null, details == null ? null : JSON.stringify(details), iso(at));
}

/** Insert one ledger row; the caller has already changed `inventory` in the same transaction. */
export function recordMovement(db, { warehouseId, itemId, type, deltaOnHand = 0, deltaReserved = 0, refType = null, refId = null, userId = null, note = null }, at) {
  db.prepare(`INSERT INTO stock_movements
      (warehouse_id, item_id, movement_type, delta_on_hand, delta_reserved, reference_type, reference_id, user_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(warehouseId, itemId, type, deltaOnHand, deltaReserved, refType, refId, userId, note, iso(at));
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM allocation_settings').all()) out[r.key] = r.value;
  return out;
}

// ---- tiny validation helpers -------------------------------------------------
export function int(value, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new HttpError(400, 'VALIDATION', `${name} is required.`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, 'VALIDATION', `${name} must be a whole number${Number.isFinite(min) ? ` between ${min} and ${max}` : ''}.`);
  }
  return n;
}

export function num(value, name, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, 'VALIDATION', `${name} must be a number between ${min} and ${max}.`);
  }
  return n;
}

export function str(value, name, { min = 1, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new HttpError(400, 'VALIDATION', `${name} is required.`);
  }
  const s = String(value).trim();
  if (s.length < min || s.length > max) throw new HttpError(400, 'VALIDATION', `${name} must be ${min}-${max} characters.`);
  return s;
}

export function oneOf(value, name, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, 'VALIDATION', `${name} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function notFound(what) {
  return new HttpError(404, 'NOT_FOUND', `${what} not found.`);
}
