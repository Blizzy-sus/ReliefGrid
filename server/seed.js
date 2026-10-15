/**
 * Demo data: a fictional multi-district flood response ("Cauvery Delta Floods 2026").
 * All organisations, people and places below are invented for demonstration.
 *
 * The seed does not write history by hand. It replays three days of operations through the
 * same services the API uses (requests -> allocation -> dispatch -> delivery -> distribution),
 * with an injected clock, so stock ledgers, audit trails and counters are genuinely consistent.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb, migrate, DEFAULT_DB_PATH } from './db.js';
import { hashPassword } from './auth.js';
import { receiveStock } from './services/inventory.js';
import { createRequest } from './services/requests.js';
import { commitAllocation } from './services/allocation.js';
import { assignVolunteer, deliverShipment, dispatchShipment, listShipments } from './services/shipments.js';
import { recordDistribution } from './services/distribution.js';
import { audit } from './services/common.js';

import { DEMO_PASSWORD } from './demo.js';
export { DEMO_PASSWORD };

const HOUR = 3_600_000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WAREHOUSES = [
  ['Thanjavur Central Relief Depot', 'Thanjavur', 10.787, 79.139, '+91 90000 10001'],
  ['Nagapattinam Port Warehouse', 'Nagapattinam', 10.766, 79.842, '+91 90000 10002'],
  ['Tiruvarur District Store', 'Tiruvarur', 10.772, 79.636, '+91 90000 10003'],
  ['Chidambaram Forward Hub', 'Cuddalore', 11.400, 79.693, '+91 90000 10004'],
];

// name, district, lat, lon, capacity, population, vulnerable
const CAMPS = [
  ['Kodiyakarai Fishermen Shelter', 'Nagapattinam', 10.296, 79.857, 600, 540, 190],
  ['Vedaranyam Temple Mandapam', 'Nagapattinam', 10.372, 79.851, 400, 310, 95],
  ['Thalaignayar Cyclone Shelter', 'Nagapattinam', 10.667, 79.810, 1200, 1150, 340],
  ['Poompuhar Community Hall', 'Mayiladuthurai', 11.147, 79.855, 500, 470, 140],
  ['Tharangambadi Town Hall', 'Mayiladuthurai', 11.026, 79.855, 300, 270, 60],
  ['Sirkazhi Road Marriage Hall', 'Mayiladuthurai', 11.236, 79.735, 450, 380, 120],
  ['Mayiladuthurai Polytechnic Camp', 'Mayiladuthurai', 11.103, 79.652, 800, 700, 150],
  ['Nagoor Indoor Stadium', 'Nagapattinam', 10.822, 79.836, 1000, 950, 260],
  ['Marudhur Govt. Higher Secondary School', 'Thanjavur', 10.740, 79.300, 900, 820, 230],
  ['Kollidam Community Hall', 'Mayiladuthurai', 11.170, 79.800, 500, 460, 150],
  ['Anaikarai Panchayat Union School', 'Thanjavur', 10.920, 79.350, 700, 640, 175],
  ['Kuthalam Youth Hostel', 'Mayiladuthurai', 11.010, 79.550, 300, 230, 45],
];

// key, category, name, unit, standard per person per day, perishable
const ITEMS = [
  ['rice', 'Food', 'Rice', 'kg', 0.5, 0],
  ['dal', 'Food', 'Lentils (dal)', 'kg', 0.1, 0],
  ['meals', 'Food', 'Ready-to-eat meal packs', 'pack', null, 1],
  ['infant', 'Food', 'Infant nutrition packs', 'pack', null, 0],
  ['water', 'Water', 'Packaged drinking water', 'L', 5, 0],
  ['purif', 'Water', 'Water purification tablets', 'strip', null, 0],
  ['ors', 'Medical', 'ORS sachets', 'sachet', 0.2, 0],
  ['firstaid', 'Medical', 'First-aid kits', 'kit', null, 0],
  ['insulin', 'Medical', 'Insulin vials', 'vial', null, 1],
  ['paracetamol', 'Medical', 'Paracetamol strips', 'strip', null, 0],
  ['tarp', 'Shelter', 'Tarpaulin sheets', 'sheet', null, 0],
  ['blanket', 'Shelter', 'Blankets', 'piece', null, 0],
  ['mat', 'Shelter', 'Sleeping mats', 'piece', null, 0],
  ['net', 'Shelter', 'Mosquito nets', 'piece', null, 0],
  ['soap', 'Hygiene', 'Soap bars', 'bar', 0.1, 0],
  ['napkin', 'Hygiene', 'Sanitary napkin packs', 'pack', null, 0],
  ['clothes', 'Clothing', 'Dry clothing sets', 'set', null, 0],
  ['lantern', 'Utilities', 'Solar lanterns', 'piece', null, 0],
];

// Opening stock per warehouse (same order as WAREHOUSES) and reorder level (network-wide, applied per warehouse).
const OPENING_STOCK = {
  rice: [6000, 4000, 3000, 1000], dal: [900, 600, 400, 200], meals: [3500, 2500, 2000, 800], infant: [600, 300, 250, 100],
  water: [30000, 20000, 12000, 8000], purif: [900, 500, 400, 200], ors: [900, 500, 400, 200], firstaid: [60, 40, 30, 20],
  insulin: [20, 10, 8, 4], paracetamol: [800, 500, 400, 300], tarp: [350, 250, 200, 100], blanket: [1600, 1000, 800, 400],
  mat: [900, 600, 500, 200], net: [500, 300, 250, 100], soap: [1200, 800, 600, 300], napkin: [500, 300, 250, 100],
  clothes: [1400, 900, 700, 300], lantern: [160, 100, 70, 30],
};
const REORDER = { water: 3000, rice: 800, insulin: 3, firstaid: 8, tarp: 40, ors: 80, meals: 300, lantern: 15 };

const VOLUNTEERS = [
  ['vol_asha', 'Asha Raghavan', '+91 90000 30001'],
  ['vol_ravi', 'Ravi Kumaran', '+91 90000 30002'],
  ['vol_meena', 'Meena Sundar', '+91 90000 30003'],
  ['vol_karthik', 'Karthik Pandian', '+91 90000 30004'],
  ['vol_fatima', 'Fatima Begum', '+91 90000 30005'],
];

const WM_NAMES = ['Gopal Venkatesh', 'Latha Murugan', 'Senthil Arasu', 'Deepa Narayanan'];
const WM_USERNAMES = ['wm_thanjavur', 'wm_nagapattinam', 'wm_tiruvarur', 'wm_chidambaram'];
const COORD_NAMES = ['Anand Selvam', 'Bhuvana Chandran', 'Chitra Devi', 'Dinesh Babu', 'Eswari Natarajan', 'Farook Ahmed',
  'Geetha Lakshmi', 'Harish Vel', 'Indira Ramesh', 'Jegan Mohan', 'Kavitha Raj', 'Lokesh Tamil'];
const COORD_USERNAMES = ['coord_kodiyakarai', 'coord_vedaranyam', 'coord_thalaignayar', 'coord_poompuhar', 'coord_tharangambadi',
  'coord_sirkazhi', 'coord_mayiladuthurai', 'coord_nagoor', 'coord_marudhur', 'coord_kollidam', 'coord_anaikarai', 'coord_kuthalam'];

const nice = (n) => Math.max(1, n >= 200 ? Math.round(n / 10) * 10 : n >= 40 ? Math.round(n / 5) * 5 : Math.round(n));

export function seedDatabase(db, { now = new Date(), log = () => {} } = {}) {
  const T = (hoursAgo) => new Date(now.getTime() - hoursAgo * HOUR);
  const rng = mulberry32(20260715);
  const between = (lo, hi) => lo + (hi - lo) * rng();
  const hash = hashPassword(DEMO_PASSWORD);

  // ---------------------------------------------------------------- people & places
  const ids = { warehouse: [], camp: [], item: {}, coord: [], wm: [], vol: [] };
  db.exec('BEGIN');
  try {
    const stamp = T(80).toISOString();
    const disaster = Number(db.prepare("INSERT INTO disasters (name, type, status, started_at) VALUES ('Cauvery Delta Floods 2026', 'FLOOD', 'ACTIVE', ?)").run(T(76).toISOString()).lastInsertRowid);
    const oldDisaster = Number(db.prepare("INSERT INTO disasters (name, type, status, started_at, ended_at) VALUES ('Coastal Surge 2025', 'CYCLONE', 'CLOSED', '2025-11-02T04:00:00.000Z', '2025-11-20T10:00:00.000Z')").run().lastInsertRowid);
    db.prepare("INSERT INTO camps (disaster_id, name, district, latitude, longitude, capacity, population, vulnerable_count, status, opened_at) VALUES (?, 'Pazhaverkadu Relief Camp (closed)', 'Tiruvallur', 13.331, 80.316, 400, 0, 0, 'CLOSED', '2025-11-02T08:00:00.000Z')").run(oldDisaster);

    for (const [name, district, lat, lon, phone] of WAREHOUSES.map(([n, d, a, b, p]) => [n, d, a, b, p])) {
      ids.warehouse.push(Number(db.prepare('INSERT INTO warehouses (name, district, latitude, longitude, contact_phone) VALUES (?, ?, ?, ?, ?)').run(name, district, lat, lon, phone).lastInsertRowid));
    }
    for (const [name, district, lat, lon, capacity, pop, vul] of CAMPS) {
      ids.camp.push(Number(db.prepare(`INSERT INTO camps (disaster_id, name, district, latitude, longitude, capacity, population, vulnerable_count, contact_phone, opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(disaster, name, district, lat, lon, capacity, pop, vul, '+91 90000 2' + String(ids.camp.length + 1).padStart(4, '0'), T(72).toISOString()).lastInsertRowid));
    }
    const cat = new Map(db.prepare('SELECT id, name FROM supply_categories').all().map((c) => [c.name, c.id]));
    for (const [key, category, name, unit, std, perishable] of ITEMS) {
      ids.item[key] = Number(db.prepare('INSERT INTO supply_items (category_id, name, unit, standard_per_person_per_day, perishable) VALUES (?, ?, ?, ?, ?)')
        .run(cat.get(category), name, unit, std, perishable).lastInsertRowid);
    }
    const addUser = (username, fullName, role, phone, campId = null, warehouseId = null) => Number(db.prepare(
      `INSERT INTO users (username, full_name, phone, password_hash, role, camp_id, warehouse_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(username, fullName, phone, hash, role, campId, warehouseId, stamp).lastInsertRowid);
    ids.admin = addUser('admin', 'Priya Subramanian (Control Room)', 'admin', '+91 90000 00001');
    WM_USERNAMES.forEach((u, i) => ids.wm.push(addUser(u, WM_NAMES[i], 'warehouse_manager', `+91 90000 4000${i + 1}`, null, ids.warehouse[i])));
    COORD_USERNAMES.forEach((u, i) => ids.coord.push(addUser(u, COORD_NAMES[i], 'camp_coordinator', `+91 90000 5${String(i + 1).padStart(4, '0')}`, ids.camp[i])));
    VOLUNTEERS.forEach(([u, n, p]) => ids.vol.push(addUser(u, n, 'volunteer', p)));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const admin = { id: ids.admin, role: 'admin' };
  const wm = (i) => ({ id: ids.wm[i], role: 'warehouse_manager', warehouseId: ids.warehouse[i] });
  const coord = (i) => ({ id: ids.coord[i], role: 'camp_coordinator', campId: ids.camp[i] });
  const wmFor = (warehouseId) => wm(ids.warehouse.indexOf(warehouseId));

  // ---------------------------------------------------------------- opening stock (T-72h)
  ITEMS.forEach(([key]) => ids.warehouse.forEach((wid, w) => {
    const qty = OPENING_STOCK[key][w];
    receiveStock(db, wm(w), { warehouseId: wid, itemId: ids.item[key], quantity: qty, note: 'Opening stock from state reserve', type: 'OPENING' }, T(72));
  }));
  for (const [key, level] of Object.entries(REORDER)) {
    ids.warehouse.forEach((wid) => db.prepare('UPDATE inventory SET reorder_level = ? WHERE warehouse_id = ? AND item_id = ?').run(level, wid, ids.item[key]));
  }
  log('opening stock loaded');

  // ---------------------------------------------------------------- request helpers
  const lines = (spec) => Object.entries(spec).filter(([, q]) => q > 0).map(([key, q]) => ({ itemId: ids.item[key], quantity: nice(q) }));
  const request = (campIdx, urgency, hoursAgo, spec, notes) => createRequest(db, coord(campIdx),
    { campId: ids.camp[campIdx], urgency, notes, items: lines(spec) }, T(hoursAgo));

  // ---------------------------------------------------------------- wave 1: initial needs (T-50h .. T-46h)
  const wave1Urgency = [4, 3, 4, 3, 2, 2, 3, 3, 4, 2, 3, 1];
  CAMPS.forEach(([, , , , , pop, vul], i) => {
    const vulShare = vul / pop;
    request(i, wave1Urgency[i], 50 - i * 0.35, {
      water: pop * 15 * between(0.9, 1.3),
      rice: pop * 1.5 * between(0.8, 1.2),
      dal: pop * 0.3 * between(0.9, 1.3),
      meals: pop * between(0.8, 1.3),
      ors: pop * 0.6 * between(0.8, 1.2),
      blanket: pop * between(0.3, 0.6),
      tarp: pop / 5 * between(0.7, 1.2),
      soap: pop * 0.3,
      infant: vulShare > 0.25 ? vul * 0.35 : 0,
      purif: [0, 1, 2, 7].includes(i) ? pop / 8 : 0,
    }, 'Initial needs assessment after evacuation');
  });
  log('wave 1 requests created');

  // ---------------------------------------------------------------- allocation run 1 + logistics
  const run1 = commitAllocation(db, admin, { note: 'First full allocation after assessments' }, T(44));
  runLogistics(run1.shipmentIds, { dispatchHoursAgo: 42, deliverMinHours: 3, partial: 3 });
  log(`run 1: ${run1.shipmentIds.length} shipments`);

  // distributions from what arrived (T-30h .. T-12h)
  distributeFromStock(30, 0.55);

  // ---------------------------------------------------------------- wave 2: medical & shelter top-ups (T-30h .. T-27h)
  request(2, 4, 30, { insulin: 40, firstaid: 12, paracetamol: 120, net: 120 }, 'Diabetic patients without insulin; fever cases rising');
  request(7, 3, 29, { insulin: 30, firstaid: 10, tarp: 120, net: 150 }, 'Roof damage in stadium north block');
  request(8, 4, 28, { insulin: 25, ors: 250, tarp: 100, paracetamol: 100 }, 'Water-borne illness cases reported');
  request(0, 3, 27.5, { tarp: 90, lantern: 60, mat: 150 }, 'Coastal wind damage; no power');
  request(10, 2, 27, { mat: 200, blanket: 150, clothes: 250 }, 'Newly arrived families');
  // replenishment arrives (T-26h)
  receiveStock(db, wm(0), { warehouseId: ids.warehouse[0], itemId: ids.item.water, quantity: 12000, note: 'State tanker delivery' }, T(26));
  receiveStock(db, wm(1), { warehouseId: ids.warehouse[1], itemId: ids.item.tarp, quantity: 120, note: 'NGO donation: tarpaulins' }, T(26));
  receiveStock(db, wm(0), { warehouseId: ids.warehouse[0], itemId: ids.item.insulin, quantity: 12, note: 'Cold-chain delivery from district hospital' }, T(26));

  const run2 = commitAllocation(db, admin, { note: 'Second allocation: medical and shelter priority' }, T(24));
  runLogistics(run2.shipmentIds, { dispatchHoursAgo: 22, deliverMinHours: 4, partial: 1, leavePlanned: 2, leaveInTransit: 1 });
  log(`run 2: ${run2.shipmentIds.length} shipments`);
  distributeFromStock(10, 0.4);

  // ---------------------------------------------------------------- wave 3: current open demand (T-20h .. T-1h)
  // campIdx, urgency, hoursAgo, items
  const wave3 = [
    [2, 4, 3, { water: 1150 * 5, rice: 1150 * 0.5, meals: 700, ors: 400, insulin: 45, tarp: 90 }, 'Water supply contaminated; new arrivals overnight'],
    [8, 4, 6, { water: 820 * 5, ors: 300, meals: 420, blanket: 200, tarp: 80 }, 'Diarrhoea outbreak, urgent water and ORS'],
    [0, 4, 5, { water: 540 * 5, meals: 350, tarp: 120, lantern: 60 }, 'Cut off by flooded road; helicopter drop requested'],
    [7, 3, 12, { water: 950 * 5, rice: 480, meals: 500, insulin: 30, tarp: 70 }, 'Overcrowded; population up 10% since morning'],
    [3, 3, 14, { water: 470 * 5, meals: 300, tarp: 80, mat: 150 }, ''],
    [10, 2, 19, { water: 640 * 5, rice: 320, blanket: 150, tarp: 60 }, ''],
    [6, 2, 18, { water: 700 * 5, meals: 380, lantern: 40, napkin: 120 }, ''],
    [5, 2, 10, { water: 380 * 5, ors: 180, tarp: 50, soap: 120 }, ''],
    [1, 3, 8, { water: 310 * 5, meals: 200, tarp: 70, lantern: 40 }, 'Temple compound flooding'],
    [4, 1, 16, { water: 270 * 5, rice: 135, mat: 90, clothes: 120 }, ''],
    [11, 1, 2, { water: 230 * 5, rice: 115, soap: 60 }, ''],
    [9, 2, 1.5, { water: 460 * 5, meals: 250, tarp: 60, napkin: 90 }, ''],
  ];
  for (const [i, urgency, hoursAgo, spec, note] of wave3) request(i, urgency, hoursAgo, spec, note || null);
  // A partial resupply lands 5 hours ago: enough for roughly a third of the open water, ORS, tarpaulin and insulin demand.
  const resupply = [
    [0, 'water', 11000, 'State tanker convoy'], [1, 'water', 8000, 'Port tanker delivery'], [2, 'water', 2000, 'District tanker'],
    [0, 'ors', 600, 'Health department consignment'], [1, 'ors', 400, 'Red Cross consignment'],
    [0, 'tarp', 180, 'NGO donation: tarpaulins'], [1, 'tarp', 200, 'Port stockpile release'],
    [0, 'insulin', 18, 'Cold-chain delivery from medical college'], [1, 'insulin', 12, 'Cold-chain delivery from district hospital'],
  ];
  for (const [w, key, qty, note] of resupply) receiveStock(db, wm(w), { warehouseId: ids.warehouse[w], itemId: ids.item[key], quantity: qty, note }, T(5));
  log('wave 3 requests created (left open for the live demo)');

  audit(db, ids.admin, 'SEED_COMPLETE', 'system', null, { note: 'Demo scenario loaded' }, now);
  return { ids, runs: [run1.runId, run2.runId] };

  // ---------------------------------------------------------------- local helpers (hoisted)
  function runLogistics(shipmentIds, { dispatchHoursAgo, deliverMinHours, partial = 0, leavePlanned = 0, leaveInTransit = 0 }) {
    // The most urgent shipments leave first, as a control room would dispatch them.
    const topUrgency = db.prepare(`SELECT MAX(r.urgency) AS u FROM shipment_items si JOIN request_items ri ON ri.id = si.request_item_id
                                   JOIN requests r ON r.id = ri.request_id WHERE si.shipment_id = ?`);
    const all = listShipments(db, {}).filter((s) => shipmentIds.includes(s.id))
      .map((s) => ({ ...s, urgency: topUrgency.get(s.id).u }))
      .sort((a, b) => b.urgency - a.urgency || a.id - b.id);
    const planned = new Set(all.slice(all.length - leavePlanned).map((s) => s.id));
    const moving = all.filter((s) => !planned.has(s.id));
    const transit = new Set((leaveInTransit ? moving.slice(-leaveInTransit) : []).map((s) => s.id));
    let partials = partial;
    all.forEach((s, k) => {
      if (planned.has(s.id)) return;
      const wmUser = wmFor(s.warehouseId);
      const when = T(dispatchHoursAgo - k * 0.2);
      assignVolunteer(db, wmUser, s.id, ids.vol[k % ids.vol.length], when);
      dispatchShipment(db, wmUser, s.id, { vehicle: `TN-${String(10 + (k % 9)).padStart(2, '0')}-${['AB', 'CD', 'EF'][k % 3]}-${1000 + k * 37}` }, new Date(when.getTime() + 20 * 60_000));
      if (transit.has(s.id)) return;
      const arrive = new Date(when.getTime() + (deliverMinHours + s.distanceKm / 30 + between(0, 1.5)) * HOUR);
      const detail = ids.vol[k % ids.vol.length];
      let received;
      const full = db.prepare('SELECT id, quantity FROM shipment_items WHERE shipment_id = ?').all(s.id);
      if (partials > 0 && full.length > 1) {
        partials -= 1;
        received = [{ shipmentItemId: full[0].id, quantity: Math.floor(full[0].quantity * 0.93) }];
      }
      deliverShipment(db, { id: detail, role: 'volunteer' }, s.id, { received, note: received ? 'Some units damaged by water in transit' : undefined }, arrive);
    });
  }

  function distributeFromStock(startHoursAgo, fraction) {
    const rows = db.prepare(`SELECT cs.camp_id, cs.item_id, cs.quantity, c.population FROM camp_stock cs JOIN camps c ON c.id = cs.camp_id
                             WHERE cs.quantity > 0 ORDER BY cs.camp_id, cs.item_id`).all();
    rows.forEach((r, k) => {
      const camp = ids.camp.indexOf(r.camp_id);
      const qty = Math.floor(r.quantity * fraction * between(0.8, 1.1));
      if (qty < 1) return;
      const people = Math.min(r.population, Math.max(1, Math.round(r.population * between(0.7, 0.98))));
      recordDistribution(db, coord(camp), { campId: r.camp_id, itemId: r.item_id, quantity: Math.min(qty, r.quantity), peopleServed: people, note: 'Morning distribution' },
        T(startHoursAgo - (k % 12) * 0.5));
    });
  }
}

// ------------------------------------------------------------------ CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DEFAULT_DB_PATH + suffix, { force: true });
  const db = openDb();
  migrate(db);
  const t0 = Date.now();
  seedDatabase(db, { log: (m) => console.log(`  - ${m}`) });
  const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(`Seeded ${DEFAULT_DB_PATH} in ${Date.now() - t0} ms`);
  console.log(`  ${n('camps')} camps, ${n('warehouses')} warehouses, ${n('supply_items')} items, ${n('users')} users`);
  console.log(`  ${n('requests')} requests, ${n('allocation_runs')} allocation runs, ${n('shipments')} shipments, ${n('distributions')} distributions`);
  console.log(`  Demo password for every account: ${DEMO_PASSWORD}`);
  db.close();
}
