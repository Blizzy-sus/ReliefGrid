import { HttpError, tx } from '../db.js';
import { audit, getSettings, int, iso, notFound, str } from './common.js';

/** Recompute a request's status from its lines. Called inside the transaction that changed them. */
export function refreshRequestStatus(db, requestId, at) {
  const req = db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId);
  if (!req || req.status === 'CANCELLED') return req?.status;
  const t = db.prepare(`
    SELECT COUNT(*) AS n,
           SUM(quantity_allocated >= quantity_approved) AS allocated,
           SUM(quantity_delivered >= quantity_approved) AS delivered,
           SUM(quantity_allocated > 0)                  AS touched
    FROM request_items WHERE request_id = ?`).get(requestId);
  let status = 'PENDING';
  if (t.delivered === t.n) status = 'FULFILLED';
  else if (t.allocated === t.n) status = 'ALLOCATED';
  else if (t.touched > 0) status = 'PARTIALLY_ALLOCATED';
  if (status !== req.status) {
    db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(status, iso(at), requestId);
  }
  return status;
}

/** What the planning standard allows a camp to claim, and why. */
export function approvedQuantity({ requested, standard, population, horizonDays }) {
  if (standard == null) return { approved: requested, note: null };
  const cap = Math.max(1, Math.ceil(standard * population * horizonDays));
  if (requested <= cap) return { approved: requested, note: null };
  return {
    approved: cap,
    note: `Capped at the ${horizonDays}-day planning standard: ${standard} per person per day x ${population} people x ${horizonDays} days = ${cap}.`,
  };
}

export function createRequest(db, user, input, at) {
  const campId = int(input.campId, 'campId', { min: 1 });
  const urgency = int(input.urgency, 'urgency', { min: 1, max: 4 });
  const notes = str(input.notes, 'notes', { min: 1, max: 500, optional: true });
  if (input.neededBy && Number.isNaN(Date.parse(input.neededBy))) throw new HttpError(400, 'VALIDATION', 'neededBy is not a valid date.');
  const neededBy = input.neededBy ? new Date(input.neededBy).toISOString() : null;
  if (!Array.isArray(input.items) || input.items.length === 0) throw new HttpError(400, 'VALIDATION', 'A request needs at least one item.');
  if (input.items.length > 40) throw new HttpError(400, 'VALIDATION', 'A request can have at most 40 items.');

  return tx(db, () => {
    const camp = db.prepare('SELECT id, name, status, population FROM camps WHERE id = ?').get(campId);
    if (!camp) throw notFound('Camp');
    if (camp.status === 'CLOSED') throw new HttpError(409, 'CAMP_CLOSED', 'This camp is closed and cannot make requests.');
    const settings = getSettings(db);
    const seen = new Set();
    const lines = input.items.map((it, i) => {
      const itemId = int(it.itemId, `items[${i}].itemId`, { min: 1 });
      const quantity = int(it.quantity, `items[${i}].quantity`, { min: 1, max: 10_000_000 });
      if (seen.has(itemId)) throw new HttpError(400, 'VALIDATION', 'The same item appears twice in the request.');
      seen.add(itemId);
      const item = db.prepare('SELECT id, name, unit, standard_per_person_per_day AS standard, active FROM supply_items WHERE id = ?').get(itemId);
      if (!item || !item.active) throw new HttpError(400, 'VALIDATION', `Item ${itemId} does not exist or is inactive.`);
      const { approved, note } = approvedQuantity({
        requested: quantity, standard: item.standard, population: camp.population, horizonDays: settings.planning_horizon_days,
      });
      return { item, quantity, approved, note };
    });

    const now = iso(at);
    const { lastInsertRowid } = db.prepare(`INSERT INTO requests (camp_id, requested_by, urgency, status, notes, needed_by, created_at, updated_at)
      VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)`).run(campId, user.id, urgency, notes, neededBy, now, now);
    const requestId = Number(lastInsertRowid);
    const ins = db.prepare(`INSERT INTO request_items (request_id, item_id, quantity_requested, quantity_approved, approval_note)
      VALUES (?, ?, ?, ?, ?)`);
    for (const l of lines) ins.run(requestId, l.item.id, l.quantity, l.approved, l.note);
    audit(db, user.id, 'REQUEST_CREATED', 'request', requestId, { campId, urgency, lines: lines.length }, at);
    return requestId;
  });
}

export function cancelRequest(db, user, requestId, at) {
  return tx(db, () => {
    const req = db.prepare('SELECT id, status FROM requests WHERE id = ?').get(requestId);
    if (!req) throw notFound('Request');
    if (req.status === 'CANCELLED') throw new HttpError(409, 'ALREADY_CANCELLED', 'Request is already cancelled.');
    if (req.status === 'FULFILLED') throw new HttpError(409, 'ALREADY_FULFILLED', 'A fulfilled request cannot be cancelled.');
    const active = db.prepare(`SELECT COUNT(*) AS n FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
      JOIN request_items ri ON ri.id = si.request_item_id
      WHERE ri.request_id = ? AND s.status IN ('PLANNED','IN_TRANSIT')`).get(requestId).n;
    if (active > 0) throw new HttpError(409, 'SHIPMENTS_ACTIVE', 'Cancel or complete the planned/in-transit shipments for this request first.');
    db.prepare("UPDATE requests SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(iso(at), requestId);
    audit(db, user.id, 'REQUEST_CANCELLED', 'request', requestId, null, at);
  });
}

/** Coordinators may only raise urgency; admins may set any level. */
export function changeUrgency(db, user, requestId, urgency, at) {
  const level = int(urgency, 'urgency', { min: 1, max: 4 });
  return tx(db, () => {
    const req = db.prepare('SELECT id, urgency, status FROM requests WHERE id = ?').get(requestId);
    if (!req) throw notFound('Request');
    if (['FULFILLED', 'CANCELLED'].includes(req.status)) throw new HttpError(409, 'CLOSED', 'This request is closed.');
    if (user.role !== 'admin' && level < req.urgency) throw new HttpError(403, 'FORBIDDEN', 'Only an administrator can lower urgency.');
    if (level === req.urgency) return;
    db.prepare('UPDATE requests SET urgency = ?, updated_at = ? WHERE id = ?').run(level, iso(at), requestId);
    audit(db, user.id, 'URGENCY_CHANGED', 'request', requestId, { from: req.urgency, to: level }, at);
  });
}

/** Admin override of the approved quantity of a line. */
export function overrideApproval(db, user, requestItemId, approved, note, at) {
  const qty = int(approved, 'approved', { min: 1 });
  return tx(db, () => {
    const ri = db.prepare('SELECT id, request_id, quantity_requested, quantity_allocated FROM request_items WHERE id = ?').get(requestItemId);
    if (!ri) throw notFound('Request line');
    if (qty > ri.quantity_requested) throw new HttpError(400, 'VALIDATION', 'Approved quantity cannot exceed the requested quantity.');
    if (qty < ri.quantity_allocated) throw new HttpError(409, 'ALREADY_ALLOCATED', `Already ${ri.quantity_allocated} allocated; approval cannot go below that.`);
    db.prepare('UPDATE request_items SET quantity_approved = ?, approval_note = ? WHERE id = ?')
      .run(qty, str(note, 'note', { min: 1, max: 300, optional: true }) || 'Approved quantity set by administrator.', requestItemId);
    refreshRequestStatus(db, ri.request_id, at);
    audit(db, user.id, 'APPROVAL_OVERRIDDEN', 'request_item', requestItemId, { approved: qty }, at);
  });
}
