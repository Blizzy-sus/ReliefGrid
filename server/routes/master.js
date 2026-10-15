import { Router } from 'express';
import { HttpError, tx } from '../db.js';
import { hashPassword, ROLES, requireRole } from '../auth.js';
import { audit, int, iso, notFound, num, oneOf, str } from '../services/common.js';
import { assertCampScope, idParam } from './guards.js';

/** Reference data and master records: disasters, camps, warehouses, items, users. */
export function masterRoutes({ db, at }) {
  const r = Router();
  const admin = requireRole(ROLES.ADMIN);
  const list = (sql, ...p) => db.prepare(sql).all(...p).map((x) => ({ ...x }));

  // ---- disasters ----
  r.get('/disasters', (_req, res) => res.json(list(`
    SELECT d.id, d.name, d.type, d.status, d.started_at AS startedAt, d.ended_at AS endedAt,
           (SELECT COUNT(*) FROM camps c WHERE c.disaster_id = d.id) AS camps
    FROM disasters d ORDER BY d.started_at DESC`)));

  r.post('/disasters', admin, (req, res) => {
    const b = req.body || {};
    const id = tx(db, () => {
      const row = db.prepare('INSERT INTO disasters (name, type, status, started_at) VALUES (?, ?, ?, ?)')
        .run(str(b.name, 'name', { max: 120 }), oneOf(b.type, 'type', ['FLOOD', 'CYCLONE', 'EARTHQUAKE', 'LANDSLIDE', 'FIRE', 'OTHER']), 'ACTIVE', iso(at()));
      audit(db, req.user.id, 'DISASTER_CREATED', 'disaster', Number(row.lastInsertRowid), { name: b.name }, at());
      return Number(row.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  r.patch('/disasters/:id', admin, (req, res) => {
    const id = idParam(req.params.id);
    const status = oneOf(req.body?.status, 'status', ['ACTIVE', 'RECOVERY', 'CLOSED']);
    tx(db, () => {
      const info = db.prepare('UPDATE disasters SET status = ?, ended_at = ? WHERE id = ?')
        .run(status, status === 'CLOSED' ? iso(at()) : null, id);
      if (!info.changes) throw notFound('Disaster');
      audit(db, req.user.id, 'DISASTER_STATUS', 'disaster', id, { status }, at());
    });
    res.json({ ok: true });
  });

  // ---- lookups ----
  r.get('/categories', (_req, res) => res.json(list('SELECT id, name FROM supply_categories ORDER BY name')));
  r.get('/urgency-levels', (_req, res) => res.json(list('SELECT level, label, weight, sla_hours AS slaHours FROM urgency_levels ORDER BY level')));

  r.put('/urgency-levels/:level', admin, (req, res) => {
    const level = int(req.params.level, 'level', { min: 1, max: 4 });
    const weight = num(req.body?.weight, 'weight', { min: 0.1, max: 100 });
    const sla = int(req.body?.slaHours, 'slaHours', { min: 1, max: 720 });
    tx(db, () => {
      db.prepare('UPDATE urgency_levels SET weight = ?, sla_hours = ? WHERE level = ?').run(weight, sla, level);
      audit(db, req.user.id, 'URGENCY_LEVEL_CHANGED', 'urgency_level', level, { weight, sla }, at());
    });
    res.json({ ok: true });
  });

  // ---- items ----
  r.get('/items', (_req, res) => res.json(list(`
    SELECT i.id, i.name, i.unit, i.category_id AS categoryId, c.name AS category,
           i.standard_per_person_per_day AS standardPerPersonPerDay, i.perishable, i.active
    FROM supply_items i JOIN supply_categories c ON c.id = i.category_id ORDER BY c.name, i.name`)));

  r.post('/items', admin, (req, res) => {
    const b = req.body || {};
    const id = tx(db, () => {
      const std = b.standardPerPersonPerDay === '' || b.standardPerPersonPerDay == null ? null : num(b.standardPerPersonPerDay, 'standardPerPersonPerDay', { min: 0.0001, max: 1000 });
      const row = db.prepare('INSERT INTO supply_items (category_id, name, unit, standard_per_person_per_day, perishable) VALUES (?, ?, ?, ?, ?)')
        .run(int(b.categoryId, 'categoryId', { min: 1 }), str(b.name, 'name', { max: 80 }), str(b.unit, 'unit', { max: 20 }), std, b.perishable ? 1 : 0);
      audit(db, req.user.id, 'ITEM_CREATED', 'supply_item', Number(row.lastInsertRowid), { name: b.name }, at());
      return Number(row.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  r.patch('/items/:id', admin, (req, res) => {
    const id = idParam(req.params.id);
    const b = req.body || {};
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM supply_items WHERE id = ?').get(id);
      if (!cur) throw notFound('Item');
      const std = 'standardPerPersonPerDay' in b
        ? (b.standardPerPersonPerDay === '' || b.standardPerPersonPerDay == null ? null : num(b.standardPerPersonPerDay, 'standardPerPersonPerDay', { min: 0.0001, max: 1000 }))
        : cur.standard_per_person_per_day;
      db.prepare('UPDATE supply_items SET name = ?, unit = ?, standard_per_person_per_day = ?, active = ? WHERE id = ?')
        .run('name' in b ? str(b.name, 'name', { max: 80 }) : cur.name, 'unit' in b ? str(b.unit, 'unit', { max: 20 }) : cur.unit, std,
          'active' in b ? (b.active ? 1 : 0) : cur.active, id);
      audit(db, req.user.id, 'ITEM_UPDATED', 'supply_item', id, b, at());
    });
    res.json({ ok: true });
  });

  // ---- warehouses ----
  r.get('/warehouses', (_req, res) => res.json(list(`
    SELECT w.id, w.name, w.district, w.latitude, w.longitude, w.status, w.contact_phone AS contactPhone,
           COALESCE(SUM(i.quantity_on_hand), 0) AS onHand, COALESCE(SUM(i.quantity_reserved), 0) AS reserved,
           COUNT(i.item_id) AS itemCount
    FROM warehouses w LEFT JOIN inventory i ON i.warehouse_id = w.id GROUP BY w.id ORDER BY w.name`)));

  r.post('/warehouses', admin, (req, res) => {
    const b = req.body || {};
    const id = tx(db, () => {
      const row = db.prepare('INSERT INTO warehouses (name, district, latitude, longitude, contact_phone) VALUES (?, ?, ?, ?, ?)')
        .run(str(b.name, 'name', { max: 100 }), str(b.district, 'district', { max: 80 }),
          num(b.latitude, 'latitude', { min: -90, max: 90 }), num(b.longitude, 'longitude', { min: -180, max: 180 }),
          str(b.contactPhone, 'contactPhone', { max: 30, optional: true }));
      audit(db, req.user.id, 'WAREHOUSE_CREATED', 'warehouse', Number(row.lastInsertRowid), { name: b.name }, at());
      return Number(row.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  r.patch('/warehouses/:id', admin, (req, res) => {
    const id = idParam(req.params.id);
    const b = req.body || {};
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
      if (!cur) throw notFound('Warehouse');
      db.prepare('UPDATE warehouses SET name = ?, status = ?, contact_phone = ? WHERE id = ?').run(
        'name' in b ? str(b.name, 'name', { max: 100 }) : cur.name,
        'status' in b ? oneOf(b.status, 'status', ['ACTIVE', 'OFFLINE']) : cur.status,
        'contactPhone' in b ? str(b.contactPhone, 'contactPhone', { max: 30, optional: true }) : cur.contact_phone, id);
      audit(db, req.user.id, 'WAREHOUSE_UPDATED', 'warehouse', id, b, at());
    });
    res.json({ ok: true });
  });

  // ---- camps ----
  const CAMP_SELECT = `
    SELECT v.camp_id AS id, v.name, v.district, v.status, v.latitude, v.longitude, v.population, v.vulnerable_count AS vulnerableCount,
           v.capacity, v.disaster_id AS disasterId, d.name AS disasterName, v.open_requests AS openRequests,
           v.max_open_urgency AS maxOpenUrgency, v.active_shipments AS activeShipments, v.people_served_total AS peopleServedTotal,
           c.contact_phone AS contactPhone
    FROM v_camp_overview v JOIN camps c ON c.id = v.camp_id JOIN disasters d ON d.id = v.disaster_id`;

  r.get('/camps', (_req, res) => res.json(list(`${CAMP_SELECT} ORDER BY v.name`)));

  r.get('/camps/:id', (req, res) => {
    const id = idParam(req.params.id);
    const camp = db.prepare(`${CAMP_SELECT} WHERE v.camp_id = ?`).get(id);
    if (!camp) throw notFound('Camp');
    res.json({
      camp: { ...camp },
      requests: list(`
        SELECT r.id, r.urgency, ul.label AS urgencyLabel, r.status, r.created_at AS createdAt,
               p.lines_total AS linesTotal, p.lines_allocated AS linesAllocated, p.lines_delivered AS linesDelivered
        FROM requests r JOIN urgency_levels ul ON ul.level = r.urgency JOIN v_request_progress p ON p.request_id = r.id
        WHERE r.camp_id = ? ORDER BY r.id DESC LIMIT 50`, id),
      stock: list(`
        SELECT cs.item_id AS itemId, i.name AS itemName, i.unit, cs.quantity
        FROM camp_stock cs JOIN supply_items i ON i.id = cs.item_id WHERE cs.camp_id = ? ORDER BY i.name`, id),
      shipments: list(`
        SELECT s.id, s.code, s.status, w.name AS warehouseName, s.eta, s.created_at AS createdAt
        FROM shipments s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.camp_id = ? ORDER BY s.id DESC LIMIT 30`, id),
    });
  });

  r.post('/camps', admin, (req, res) => {
    const b = req.body || {};
    const id = tx(db, () => {
      const population = int(b.population ?? 0, 'population', { min: 0, max: 1_000_000 });
      const vulnerable = int(b.vulnerableCount ?? 0, 'vulnerableCount', { min: 0, max: population });
      const row = db.prepare(`INSERT INTO camps (disaster_id, name, district, latitude, longitude, capacity, population, vulnerable_count, contact_phone, opened_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(int(b.disasterId, 'disasterId', { min: 1 }), str(b.name, 'name', { max: 120 }), str(b.district, 'district', { max: 80 }),
          num(b.latitude, 'latitude', { min: -90, max: 90 }), num(b.longitude, 'longitude', { min: -180, max: 180 }),
          int(b.capacity, 'capacity', { min: 1, max: 1_000_000 }), population, vulnerable,
          str(b.contactPhone, 'contactPhone', { max: 30, optional: true }), iso(at()));
      audit(db, req.user.id, 'CAMP_CREATED', 'camp', Number(row.lastInsertRowid), { name: b.name }, at());
      return Number(row.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  r.patch('/camps/:id', (req, res) => {
    const id = idParam(req.params.id);
    assertCampScope(req.user, id);
    const b = req.body || {};
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM camps WHERE id = ?').get(id);
      if (!cur) throw notFound('Camp');
      const population = 'population' in b ? int(b.population, 'population', { min: 0, max: 1_000_000 }) : cur.population;
      const vulnerable = 'vulnerableCount' in b ? int(b.vulnerableCount, 'vulnerableCount', { min: 0, max: population }) : cur.vulnerable_count;
      if (vulnerable > population) throw new HttpError(400, 'VALIDATION', 'vulnerableCount cannot exceed population.');
      let status = cur.status;
      if ('status' in b) {
        if (req.user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only an administrator can change camp status.');
        status = oneOf(b.status, 'status', ['OPEN', 'FULL', 'CLOSED']);
      }
      db.prepare('UPDATE camps SET population = ?, vulnerable_count = ?, status = ? WHERE id = ?').run(population, vulnerable, status, id);
      audit(db, req.user.id, 'CAMP_UPDATED', 'camp', id, { population, vulnerable, status }, at());
    });
    res.json({ ok: true });
  });

  // ---- users ----
  r.get('/volunteers', requireRole(ROLES.ADMIN, ROLES.WAREHOUSE), (_req, res) =>
    res.json(list("SELECT id, full_name AS fullName, phone FROM users WHERE role = 'volunteer' AND active = 1 ORDER BY full_name")));

  r.get('/users', admin, (_req, res) => res.json(list(`
    SELECT u.id, u.username, u.full_name AS fullName, u.role, u.phone, u.active, u.camp_id AS campId, c.name AS campName,
           u.warehouse_id AS warehouseId, w.name AS warehouseName, u.last_login_at AS lastLoginAt
    FROM users u LEFT JOIN camps c ON c.id = u.camp_id LEFT JOIN warehouses w ON w.id = u.warehouse_id
    ORDER BY u.role, u.full_name`)));

  r.post('/users', admin, (req, res) => {
    const b = req.body || {};
    const password = String(b.password || '');
    if (password.length < 8) throw new HttpError(400, 'VALIDATION', 'Password must be at least 8 characters.');
    const role = oneOf(b.role, 'role', Object.values(ROLES));
    const id = tx(db, () => {
      const row = db.prepare(`INSERT INTO users (username, full_name, phone, password_hash, role, camp_id, warehouse_id, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(str(b.username, 'username', { min: 3, max: 40 }), str(b.fullName, 'fullName', { max: 100 }),
          str(b.phone, 'phone', { max: 30, optional: true }), hashPassword(password), role,
          role === 'camp_coordinator' ? int(b.campId, 'campId', { min: 1 }) : null,
          role === 'warehouse_manager' ? int(b.warehouseId, 'warehouseId', { min: 1 }) : null, iso(at()));
      audit(db, req.user.id, 'USER_CREATED', 'user', Number(row.lastInsertRowid), { username: b.username, role }, at());
      return Number(row.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  r.patch('/users/:id', admin, (req, res) => {
    const id = idParam(req.params.id);
    const b = req.body || {};
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!cur) throw notFound('User');
      if ('active' in b && id === req.user.id && !b.active) throw new HttpError(409, 'SELF_LOCKOUT', 'You cannot deactivate your own account.');
      let hash = cur.password_hash;
      if (b.password !== undefined) {
        if (String(b.password).length < 8) throw new HttpError(400, 'VALIDATION', 'Password must be at least 8 characters.');
        hash = hashPassword(String(b.password));
      }
      db.prepare('UPDATE users SET full_name = ?, phone = ?, active = ?, password_hash = ? WHERE id = ?').run(
        'fullName' in b ? str(b.fullName, 'fullName', { max: 100 }) : cur.full_name,
        'phone' in b ? str(b.phone, 'phone', { max: 30, optional: true }) : cur.phone,
        'active' in b ? (b.active ? 1 : 0) : cur.active, hash, id);
      if (('active' in b && !b.active) || b.password !== undefined) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(db, req.user.id, 'USER_UPDATED', 'user', id, { fields: Object.keys(b).filter((k) => k !== 'password'), passwordReset: b.password !== undefined }, at());
    });
    res.json({ ok: true });
  });

  return r;
}
