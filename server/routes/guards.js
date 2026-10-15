import { HttpError } from '../db.js';

export const forbid = (msg = 'You do not have permission to do this.') => new HttpError(403, 'FORBIDDEN', msg);

export function assertCampScope(user, campId) {
  if (user.role === 'admin') return;
  if (user.role === 'camp_coordinator' && user.campId === campId) return;
  throw forbid('You can only manage your own camp.');
}

export function assertWarehouseScope(user, warehouseId) {
  if (user.role === 'admin') return;
  if (user.role === 'warehouse_manager' && user.warehouseId === warehouseId) return;
  throw forbid('You can only manage your own warehouse.');
}

/** Parse a positive integer route/query parameter. */
export function idParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'VALIDATION', `${name} must be a positive integer.`);
  return n;
}

export const optId = (value, name) => (value === undefined || value === '' ? null : idParam(value, name));
