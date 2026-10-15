import { HttpError, tx } from '../db.js';
import { audit, getSettings, int, iso, notFound, recordMovement, str } from './common.js';
import { refreshRequestStatus } from './requests.js';

const SHIPMENT_SELECT = `
  SELECT s.id, s.code, s.run_id AS runId, s.status, s.warehouse_id AS warehouseId, w.name AS warehouseName,
         s.camp_id AS campId, c.name AS campName, s.volunteer_id AS volunteerId, v.full_name AS volunteerName,
         s.distance_km AS distanceKm, s.vehicle, s.created_at AS createdAt, s.dispatched_at AS dispatchedAt,
         s.eta, s.delivered_at AS deliveredAt, s.last_note AS lastNote,
         (SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) AS lineCount,
         (SELECT COALESCE(SUM(si.quantity), 0) FROM shipment_items si WHERE si.shipment_id = s.id) AS unitCount
  FROM shipments s
  JOIN warehouses w ON w.id = s.warehouse_id
  JOIN camps c ON c.id = s.camp_id
  LEFT JOIN users v ON v.id = s.volunteer_id`;

export function listShipments(db, { status, campId, warehouseId, volunteerId, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (campId) { where.push('s.camp_id = ?'); params.push(campId); }
  if (warehouseId) { where.push('s.warehouse_id = ?'); params.push(warehouseId); }
  if (volunteerId) { where.push('s.volunteer_id = ?'); params.push(volunteerId); }
  const sql = `${SHIPMENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit).map((r) => ({ ...r }));
}

export function getShipment(db, id) {
  const s = db.prepare(`${SHIPMENT_SELECT} WHERE s.id = ?`).get(id);
  if (!s) return null;
  const items = db.prepare(`
    SELECT si.id, si.item_id AS itemId, i.name AS itemName, i.unit, si.quantity, si.quantity_received AS quantityReceived,
           si.request_item_id AS requestItemId, ri.request_id AS requestId
    FROM shipment_items si JOIN supply_items i ON i.id = si.item_id JOIN request_items ri ON ri.id = si.request_item_id
    WHERE si.shipment_id = ? ORDER BY i.name`).all(id).map((r) => ({ ...r }));
  const events = db.prepare(`
    SELECT e.id, e.status, e.note, e.created_at AS createdAt, u.full_name AS actor
    FROM shipment_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.shipment_id = ? ORDER BY e.id`).all(id).map((r) => ({ ...r }));
  return { ...s, items, events };
}

function lockShipment(db, id) {
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!s) throw notFound('Shipment');
  return s;
}

function requireStatus(s, ...allowed) {
  if (!allowed.includes(s.status)) {
    throw new HttpError(409, 'INVALID_STATE', `Shipment ${s.code} is ${s.status}; this action needs ${allowed.join(' or ')}.`);
  }
}

export function assignVolunteer(db, user, id, volunteerId, at) {
  return tx(db, () => {
    const s = lockShipment(db, id);
    requireStatus(s, 'PLANNED', 'IN_TRANSIT');
    const vol = db.prepare("SELECT id, full_name, role, active FROM users WHERE id = ?").get(volunteerId);
    if (!vol || vol.role !== 'volunteer' || !vol.active) throw new HttpError(400, 'VALIDATION', 'Selected user is not an active volunteer.');
    db.prepare('UPDATE shipments SET volunteer_id = ? WHERE id = ?').run(volunteerId, id);
    audit(db, user.id, 'SHIPMENT_ASSIGNED', 'shipment', id, { volunteerId }, at);
  });
}

export function dispatchShipment(db, user, id, { vehicle = null, note = null } = {}, at) {
  const vehicleText = str(vehicle, 'vehicle', { min: 1, max: 60, optional: true });
  return tx(db, () => {
    const s = lockShipment(db, id);
    requireStatus(s, 'PLANNED');
    const now = iso(at);
    const items = db.prepare('SELECT id, item_id, quantity FROM shipment_items WHERE shipment_id = ?').all(id);
    const take = db.prepare(`UPDATE inventory
      SET quantity_on_hand = quantity_on_hand - ?, quantity_reserved = quantity_reserved - ?, updated_at = ?
      WHERE warehouse_id = ? AND item_id = ? AND quantity_reserved >= ? AND quantity_on_hand >= ?`);
    for (const it of items) {
      const r = take.run(it.quantity, it.quantity, now, s.warehouse_id, it.item_id, it.quantity, it.quantity);
      if (r.changes !== 1) throw new HttpError(409, 'RESERVATION_MISSING', `Reserved stock for ${s.code} is no longer available.`);
      recordMovement(db, {
        warehouseId: s.warehouse_id, itemId: it.item_id, type: 'DISPATCH', deltaOnHand: -it.quantity, deltaReserved: -it.quantity,
        refType: 'shipment', refId: id, userId: user.id, note: `Dispatched on ${s.code}`,
      }, at);
    }
    const { travel_speed_kmh: speed } = getSettings(db);
    const eta = new Date(new Date(now).getTime() + (s.distance_km / (speed || 30)) * 3_600_000).toISOString();
    db.prepare(`UPDATE shipments SET status = 'IN_TRANSIT', dispatched_at = ?, eta = ?, vehicle = COALESCE(?, vehicle),
                status_changed_at = ?, last_actor_id = ?, last_note = ? WHERE id = ?`)
      .run(now, eta, vehicleText, now, user.id, str(note, 'note', { min: 1, max: 300, optional: true }) || 'Dispatched from warehouse', id);
    audit(db, user.id, 'SHIPMENT_DISPATCHED', 'shipment', id, { units: items.reduce((a, b) => a + b.quantity, 0) }, at);
  });
}

/**
 * Confirm receipt at the camp.  `received` is optional: [{ shipmentItemId, quantity }].
 * Lines not mentioned are assumed fully received.  Anything short is released back to the
 * request line (allocated is reduced) so the next allocation run can cover it again.
 */
export function deliverShipment(db, user, id, { received = [], note = null } = {}, at) {
  if (!Array.isArray(received)) throw new HttpError(400, 'VALIDATION', 'received must be a list.');
  return tx(db, () => {
    const s = lockShipment(db, id);
    requireStatus(s, 'IN_TRANSIT');
    const now = iso(at);
    const items = db.prepare('SELECT id, request_item_id, item_id, quantity FROM shipment_items WHERE shipment_id = ?').all(id);
    const byId = new Map(items.map((i) => [i.id, i]));
    const override = new Map();
    for (const r of received) {
      const sid = int(r.shipmentItemId, 'shipmentItemId', { min: 1 });
      if (!byId.has(sid)) throw new HttpError(400, 'VALIDATION', `Line ${sid} does not belong to this shipment.`);
      override.set(sid, int(r.quantity, 'quantity', { min: 0, max: byId.get(sid).quantity }));
    }
    let shortfall = 0;
    const touched = new Set();
    for (const it of items) {
      const got = override.has(it.id) ? override.get(it.id) : it.quantity;
      shortfall += it.quantity - got;
      db.prepare('UPDATE shipment_items SET quantity_received = ? WHERE id = ?').run(got, it.id);
      if (got > 0) {
        db.prepare(`INSERT INTO camp_stock (camp_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT (camp_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`)
          .run(s.camp_id, it.item_id, got, now);
      }
      db.prepare(`UPDATE request_items SET quantity_delivered = quantity_delivered + ?, quantity_allocated = quantity_allocated - ?
                  WHERE id = ?`).run(got, it.quantity - got, it.request_item_id);
      touched.add(db.prepare('SELECT request_id FROM request_items WHERE id = ?').get(it.request_item_id).request_id);
    }
    db.prepare(`UPDATE shipments SET status = 'DELIVERED', delivered_at = ?, status_changed_at = ?, last_actor_id = ?, last_note = ? WHERE id = ?`)
      .run(now, now, user.id, str(note, 'note', { min: 1, max: 300, optional: true }) || (shortfall ? `Delivered with ${shortfall} units short or damaged` : 'Delivered in full'), id);
    for (const rid of touched) refreshRequestStatus(db, rid, at);
    audit(db, user.id, 'SHIPMENT_DELIVERED', 'shipment', id, { shortfall }, at);
    return { shortfall };
  });
}

export function cancelShipment(db, user, id, { note = null } = {}, at) {
  return tx(db, () => {
    const s = lockShipment(db, id);
    requireStatus(s, 'PLANNED');
    const now = iso(at);
    const items = db.prepare('SELECT id, request_item_id, item_id, quantity FROM shipment_items WHERE shipment_id = ?').all(id);
    const touched = new Set();
    for (const it of items) {
      const r = db.prepare(`UPDATE inventory SET quantity_reserved = quantity_reserved - ?, updated_at = ?
        WHERE warehouse_id = ? AND item_id = ? AND quantity_reserved >= ?`).run(it.quantity, now, s.warehouse_id, it.item_id, it.quantity);
      if (r.changes !== 1) throw new HttpError(409, 'RESERVATION_MISSING', `Reservation for ${s.code} is inconsistent.`);
      recordMovement(db, {
        warehouseId: s.warehouse_id, itemId: it.item_id, type: 'RELEASE', deltaReserved: -it.quantity,
        refType: 'shipment', refId: id, userId: user.id, note: `Released: ${s.code} cancelled`,
      }, at);
      db.prepare('UPDATE request_items SET quantity_allocated = quantity_allocated - ? WHERE id = ?').run(it.quantity, it.request_item_id);
      touched.add(db.prepare('SELECT request_id FROM request_items WHERE id = ?').get(it.request_item_id).request_id);
    }
    db.prepare(`UPDATE shipments SET status = 'CANCELLED', status_changed_at = ?, last_actor_id = ?, last_note = ? WHERE id = ?`)
      .run(now, user.id, str(note, 'note', { min: 1, max: 300, optional: true }) || 'Cancelled before dispatch', id);
    for (const rid of touched) refreshRequestStatus(db, rid, at);
    audit(db, user.id, 'SHIPMENT_CANCELLED', 'shipment', id, null, at);
  });
}
