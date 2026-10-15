import { HttpError, tx } from '../db.js';
import { audit, int, iso, notFound, str } from './common.js';

/** Record aid handed out to people at a camp; stock held at the camp can never go negative. */
export function recordDistribution(db, user, { campId, itemId, quantity, peopleServed, note = null }, at) {
  const qty = int(quantity, 'quantity', { min: 1, max: 100_000_000 });
  const people = int(peopleServed, 'peopleServed', { min: 1, max: 1_000_000 });
  return tx(db, () => {
    const camp = db.prepare('SELECT id, population FROM camps WHERE id = ?').get(campId);
    if (!camp) throw notFound('Camp');
    if (people > camp.population) throw new HttpError(400, 'VALIDATION', `peopleServed cannot exceed the camp population (${camp.population}).`);
    const now = iso(at);
    const have = db.prepare('SELECT quantity FROM camp_stock WHERE camp_id = ? AND item_id = ?').get(campId, itemId)?.quantity ?? 0;
    if (have < qty) throw new HttpError(409, 'INSUFFICIENT_CAMP_STOCK', `The camp holds only ${have} units of this item.`);
    // The insert fires trg_distribution_stock_guard (stock before the decrement); the conditional
    // UPDATE below is the second guard, and camp_stock's CHECK (quantity >= 0) the third.
    const ins = db.prepare(`INSERT INTO distributions (camp_id, item_id, quantity, people_served, distributed_by, note, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(campId, itemId, qty, people, user.id, str(note, 'note', { min: 1, max: 300, optional: true }), now);
    const r = db.prepare(`UPDATE camp_stock SET quantity = quantity - ?, updated_at = ?
                          WHERE camp_id = ? AND item_id = ? AND quantity >= ?`).run(qty, now, campId, itemId, qty);
    if (r.changes !== 1) throw new HttpError(409, 'INSUFFICIENT_CAMP_STOCK', 'Camp stock changed during the transaction.');
    const id = Number(ins.lastInsertRowid);
    audit(db, user.id, 'DISTRIBUTION_RECORDED', 'distribution', id, { campId, itemId, quantity: qty, people }, at);
    return id;
  });
}

export function listDistributions(db, { campId, limit = 200 } = {}) {
  return db.prepare(`
    SELECT d.id, d.camp_id AS campId, c.name AS campName, d.item_id AS itemId, i.name AS itemName, i.unit,
           d.quantity, d.people_served AS peopleServed, d.note, d.created_at AS createdAt, u.full_name AS recordedBy
    FROM distributions d
    JOIN camps c ON c.id = d.camp_id
    JOIN supply_items i ON i.id = d.item_id
    JOIN users u ON u.id = d.distributed_by
    ${campId ? 'WHERE d.camp_id = ?' : ''}
    ORDER BY d.id DESC LIMIT ?`).all(...(campId ? [campId, limit] : [limit])).map((r) => ({ ...r }));
}

export function listCampStock(db, campId) {
  return db.prepare(`
    SELECT cs.camp_id AS campId, cs.item_id AS itemId, i.name AS itemName, i.unit, cat.name AS category, cs.quantity, cs.updated_at AS updatedAt
    FROM camp_stock cs JOIN supply_items i ON i.id = cs.item_id JOIN supply_categories cat ON cat.id = i.category_id
    WHERE cs.camp_id = ? ORDER BY cat.name, i.name`).all(campId).map((r) => ({ ...r }));
}
