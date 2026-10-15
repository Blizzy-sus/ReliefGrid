import { openDb, migrate } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

export const PASSWORD = 'Test#Passw0rd';
const HASH = hashPassword(PASSWORD);
export const HOUR = 3_600_000;

export function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

/**
 * A small deterministic world used by most tests.
 *   warehouses: A (near the camps), B (far)
 *   camps:      c1 (large, 30% vulnerable), c2 (medium), c3 (small)
 *   items:      water (standard 5 L/person/day), rice (standard 0.5), tarp (no standard)
 */
export function smallWorld(db, { now = new Date('2026-07-15T12:00:00Z') } = {}) {
  const at = now.toISOString();
  const run = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const w = {};
  w.disaster = run("INSERT INTO disasters (name, type, started_at) VALUES ('Test Flood', 'FLOOD', ?)", at);
  w.whA = run("INSERT INTO warehouses (name, district, latitude, longitude) VALUES ('Depot A', 'North', 10.80, 79.60)");
  w.whB = run("INSERT INTO warehouses (name, district, latitude, longitude) VALUES ('Depot B', 'South', 11.60, 79.80)");
  const camp = (name, lat, lon, pop, vul) => run(
    `INSERT INTO camps (disaster_id, name, district, latitude, longitude, capacity, population, vulnerable_count, opened_at)
     VALUES (?, ?, 'North', ?, ?, 2000, ?, ?, ?)`, w.disaster, name, lat, lon, pop, vul, at);
  w.c1 = camp('Camp One', 10.85, 79.65, 1000, 300);
  w.c2 = camp('Camp Two', 10.90, 79.70, 500, 50);
  w.c3 = camp('Camp Three', 10.95, 79.72, 200, 0);
  const cat = db.prepare("SELECT id FROM supply_categories WHERE name = 'Water'").get().id;
  const item = (name, unit, std) => run('INSERT INTO supply_items (category_id, name, unit, standard_per_person_per_day) VALUES (?, ?, ?, ?)', cat, name, unit, std);
  w.water = item('Water', 'L', 5);
  w.rice = item('Rice', 'kg', 0.5);
  w.tarp = item('Tarpaulin', 'sheet', null);
  const user = (username, role, campId = null, warehouseId = null) => run(
    'INSERT INTO users (username, full_name, password_hash, role, camp_id, warehouse_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    username, username, HASH, role, campId, warehouseId, at);
  w.admin = user('admin', 'admin');
  w.wmA = user('wm_a', 'warehouse_manager', null, w.whA);
  w.wmB = user('wm_b', 'warehouse_manager', null, w.whB);
  w.coord1 = user('coord1', 'camp_coordinator', w.c1);
  w.coord2 = user('coord2', 'camp_coordinator', w.c2);
  w.coord3 = user('coord3', 'camp_coordinator', w.c3);
  w.vol = user('vol', 'volunteer');
  w.users = {
    admin: { id: w.admin, role: 'admin' },
    wmA: { id: w.wmA, role: 'warehouse_manager', warehouseId: w.whA },
    wmB: { id: w.wmB, role: 'warehouse_manager', warehouseId: w.whB },
    coord1: { id: w.coord1, role: 'camp_coordinator', campId: w.c1 },
    coord2: { id: w.coord2, role: 'camp_coordinator', campId: w.c2 },
    coord3: { id: w.coord3, role: 'camp_coordinator', campId: w.c3 },
    vol: { id: w.vol, role: 'volunteer' },
  };
  return w;
}

export function stock(db, warehouseId, itemId, qty, at = '2026-07-15T12:00:00Z') {
  db.prepare('INSERT INTO inventory (warehouse_id, item_id, quantity_on_hand, quantity_reserved, updated_at) VALUES (?, ?, ?, 0, ?)')
    .run(warehouseId, itemId, qty, at);
  if (qty > 0) {
    db.prepare(`INSERT INTO stock_movements (warehouse_id, item_id, movement_type, delta_on_hand, created_at) VALUES (?, ?, 'OPENING', ?, ?)`)
      .run(warehouseId, itemId, qty, at);
  }
}

/** Start the HTTP app on an ephemeral port and return a tiny client. */
export async function startServer(db, opts = {}) {
  const app = createApp(db, { quiet: true, serveStatic: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = (token) => {
    const call = async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
      return { status: res.status, body: json };
    };
    return {
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      patch: (u, b = {}) => call('PATCH', u, b),
      put: (u, b = {}) => call('PUT', u, b),
    };
  };
  const login = async (username, password = PASSWORD) => {
    const res = await client().post('/api/auth/login', { username, password });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(res.body)}`);
    return client(res.body.token);
  };
  return { base, server, client, login, close: () => new Promise((r) => server.close(r)) };
}

export const row = (db, sql, ...p) => ({ ...db.prepare(sql).get(...p) });
export const rows = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
