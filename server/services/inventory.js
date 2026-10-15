import { HttpError, tx } from '../db.js';
import { audit, int, iso, notFound, recordMovement, str } from './common.js';

/** Add stock to a warehouse (creates the inventory row on first receipt). */
export function receiveStock(db, user, { warehouseId, itemId, quantity, note = null, type = 'RECEIPT' }, at) {
  const qty = int(quantity, 'quantity', { min: 1, max: 100_000_000 });
  return tx(db, () => {
    const wh = db.prepare('SELECT id FROM warehouses WHERE id = ?').get(warehouseId);
    if (!wh) throw notFound('Warehouse');
    const item = db.prepare('SELECT id, active FROM supply_items WHERE id = ?').get(itemId);
    if (!item || !item.active) throw new HttpError(400, 'VALIDATION', 'Item does not exist or is inactive.');
    const now = iso(at);
    db.prepare(`INSERT INTO inventory (warehouse_id, item_id, quantity_on_hand, quantity_reserved, reorder_level, updated_at)
                VALUES (?, ?, ?, 0, 0, ?)
                ON CONFLICT (warehouse_id, item_id) DO UPDATE SET
                  quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand, updated_at = excluded.updated_at`)
      .run(warehouseId, itemId, qty, now);
    recordMovement(db, {
      warehouseId, itemId, type, deltaOnHand: qty, userId: user.id,
      note: str(note, 'note', { min: 1, max: 300, optional: true }) || 'Stock received',
    }, at);
    audit(db, user.id, 'STOCK_RECEIVED', 'inventory', warehouseId, { itemId, quantity: qty }, at);
  });
}

/** Correct stock after a count (damage, loss, recount).  Cannot drop below what is reserved. */
export function adjustStock(db, user, { warehouseId, itemId, delta, reason }, at) {
  const d = int(delta, 'delta', { min: -100_000_000, max: 100_000_000 });
  if (d === 0) throw new HttpError(400, 'VALIDATION', 'delta must not be zero.');
  const why = str(reason, 'reason', { min: 3, max: 300 });
  return tx(db, () => {
    const row = db.prepare('SELECT quantity_on_hand AS onHand, quantity_reserved AS reserved FROM inventory WHERE warehouse_id = ? AND item_id = ?').get(warehouseId, itemId);
    if (!row) throw notFound('Inventory record');
    const r = db.prepare(`UPDATE inventory SET quantity_on_hand = quantity_on_hand + ?, updated_at = ?
                          WHERE warehouse_id = ? AND item_id = ? AND quantity_on_hand + ? >= quantity_reserved`)
      .run(d, iso(at), warehouseId, itemId, d);
    if (r.changes !== 1) {
      throw new HttpError(409, 'BELOW_RESERVED', `Cannot reduce below the ${row.reserved} units already reserved for planned shipments. Cancel those shipments first.`);
    }
    recordMovement(db, { warehouseId, itemId, type: 'ADJUSTMENT', deltaOnHand: d, userId: user.id, note: why }, at);
    audit(db, user.id, 'STOCK_ADJUSTED', 'inventory', warehouseId, { itemId, delta: d, reason: why }, at);
  });
}

export function setReorderLevel(db, user, { warehouseId, itemId, reorderLevel }, at) {
  const level = int(reorderLevel, 'reorderLevel', { min: 0, max: 100_000_000 });
  return tx(db, () => {
    const r = db.prepare('UPDATE inventory SET reorder_level = ?, updated_at = ? WHERE warehouse_id = ? AND item_id = ?')
      .run(level, iso(at), warehouseId, itemId);
    if (r.changes !== 1) throw notFound('Inventory record');
    audit(db, user.id, 'REORDER_LEVEL_SET', 'inventory', warehouseId, { itemId, level }, at);
  });
}

export function listInventory(db, { warehouseId, itemId } = {}) {
  const where = [];
  const params = [];
  if (warehouseId) { where.push('warehouse_id = ?'); params.push(warehouseId); }
  if (itemId) { where.push('item_id = ?'); params.push(itemId); }
  return db.prepare(`
    SELECT warehouse_id AS warehouseId, warehouse_name AS warehouseName, item_id AS itemId, item_name AS itemName, unit, category,
           quantity_on_hand AS onHand, quantity_reserved AS reserved, quantity_available AS available,
           reorder_level AS reorderLevel, below_reorder AS belowReorder, updated_at AS updatedAt
    FROM v_inventory_available ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY category, item_name, warehouse_name`).all(...params).map((r) => ({ ...r }));
}

export function listMovements(db, { warehouseId, itemId, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (warehouseId) { where.push('m.warehouse_id = ?'); params.push(warehouseId); }
  if (itemId) { where.push('m.item_id = ?'); params.push(itemId); }
  return db.prepare(`
    SELECT m.id, m.warehouse_id AS warehouseId, w.name AS warehouseName, m.item_id AS itemId, i.name AS itemName, i.unit,
           m.movement_type AS type, m.delta_on_hand AS deltaOnHand, m.delta_reserved AS deltaReserved,
           m.reference_type AS refType, m.reference_id AS refId, m.note, m.created_at AS createdAt, u.full_name AS actor
    FROM stock_movements m
    JOIN warehouses w ON w.id = m.warehouse_id
    JOIN supply_items i ON i.id = m.item_id
    LEFT JOIN users u ON u.id = m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.id DESC LIMIT ?`).all(...params, limit).map((r) => ({ ...r }));
}
