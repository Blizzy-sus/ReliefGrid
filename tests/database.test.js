import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, migrate, tx } from '../server/db.js';
import { freshDb, smallWorld, stock, row, rows } from './helpers.js';
import { createRequest } from '../server/services/requests.js';
import { commitAllocation } from '../server/services/allocation.js';
import { checkIntegrity } from '../server/services/reports.js';

const T0 = new Date('2026-07-15T12:00:00Z');
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(String(e.message)), `expected error matching ${re}`);

test('migrations are idempotent and record checksums', () => {
  const db = openDb(':memory:');
  const first = migrate(db);
  assert.deepEqual(first, ['001_core_schema.sql', '002_views.sql', '003_triggers.sql', '004_reference_data.sql']);
  assert.deepEqual(migrate(db), []);
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM schema_migrations').n, 4);
  db.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '002_views.sql'").run();
  throwsMsg(() => migrate(db), /modified after being applied/);
});

test('foreign keys are enforced on every connection', () => {
  const db = freshDb();
  assert.equal(row(db, 'PRAGMA foreign_keys').foreign_keys, 1);
  throwsMsg(() => db.prepare("INSERT INTO requests (camp_id, requested_by, urgency, created_at, updated_at) VALUES (99, 99, 1, 'x', 'x')").run(), /FOREIGN KEY/);
});

test('CHECK constraints reject impossible stock and quantities', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.water, 100);
  throwsMsg(() => db.prepare('UPDATE inventory SET quantity_reserved = 101 WHERE warehouse_id = ?').run(w.whA), /CHECK constraint/);
  throwsMsg(() => db.prepare('UPDATE inventory SET quantity_on_hand = -1 WHERE warehouse_id = ?').run(w.whA), /CHECK constraint/);
  throwsMsg(() => db.prepare("UPDATE camps SET vulnerable_count = population + 1 WHERE id = ?").run(w.c1), /CHECK constraint/);
  throwsMsg(() => db.prepare("UPDATE camps SET latitude = 120 WHERE id = ?").run(w.c1), /CHECK constraint/);
  const id = createRequest(db, w.users.coord1, { campId: w.c1, urgency: 2, items: [{ itemId: w.tarp, quantity: 10 }] }, T0);
  const ri = row(db, 'SELECT id FROM request_items WHERE request_id = ?', id).id;
  throwsMsg(() => db.prepare('UPDATE request_items SET quantity_approved = 11 WHERE id = ?').run(ri), /CHECK constraint/);
  throwsMsg(() => db.prepare('UPDATE request_items SET quantity_allocated = 11 WHERE id = ?').run(ri), /CHECK constraint/);
  throwsMsg(() => db.prepare('UPDATE request_items SET quantity_delivered = 1 WHERE id = ?').run(ri), /CHECK constraint/);
  throwsMsg(() => db.prepare('UPDATE requests SET urgency = 9 WHERE id = ?').run(id), /FOREIGN KEY|CHECK/);
  throwsMsg(() => db.prepare("UPDATE requests SET status = 'DONE' WHERE id = ?").run(id), /CHECK constraint/);
});

test('user scope must match role', () => {
  const db = freshDb();
  const w = smallWorld(db);
  const ins = (role, camp, wh) => db.prepare("INSERT INTO users (username, full_name, password_hash, role, camp_id, warehouse_id, created_at) VALUES (?, 'x', 'x', ?, ?, ?, 'x')")
    .run(`u${Math.random()}`, role, camp, wh);
  throwsMsg(() => ins('camp_coordinator', null, null), /CHECK constraint/);
  throwsMsg(() => ins('warehouse_manager', w.c1, null), /CHECK constraint/);
  throwsMsg(() => ins('admin', w.c1, null), /CHECK constraint/);
  ins('volunteer', null, null);
});

test('usernames are unique case-insensitively', () => {
  const db = freshDb();
  smallWorld(db);
  throwsMsg(() => db.prepare("INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES ('ADMIN', 'x', 'x', 'admin', 'x')").run(), /UNIQUE/);
});

test('history tables are append-only', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.water, 100);
  throwsMsg(() => db.prepare('UPDATE stock_movements SET delta_on_hand = 1').run(), /append-only/);
  throwsMsg(() => db.prepare('DELETE FROM stock_movements').run(), /append-only/);
  db.prepare("INSERT INTO audit_log (action, entity_type, created_at) VALUES ('X', 'y', 'z')").run();
  throwsMsg(() => db.prepare("UPDATE audit_log SET action = 'Y'").run(), /append-only/);
  throwsMsg(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);

  createRequest(db, w.users.coord1, { campId: w.c1, urgency: 3, items: [{ itemId: w.water, quantity: 500 }] }, T0);
  stock(db, w.whB, w.water, 10);
  commitAllocation(db, w.users.admin, {}, T0);
  for (const t of ['allocation_runs', 'allocation_decisions', 'allocation_lines']) {
    throwsMsg(() => db.prepare(`UPDATE ${t} SET id = id`).run(), /immutable/);
    throwsMsg(() => db.prepare(`DELETE FROM ${t}`).run(), /immutable/);
  }
});

test('shipment state machine and automatic event log', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.tarp, 50);
  createRequest(db, w.users.coord1, { campId: w.c1, urgency: 3, items: [{ itemId: w.tarp, quantity: 20 }] }, T0);
  const { shipmentIds } = commitAllocation(db, w.users.admin, {}, T0);
  const id = shipmentIds[0];
  assert.equal(rows(db, 'SELECT status FROM shipment_events WHERE shipment_id = ?', id).length, 1); // PLANNED logged by trigger
  throwsMsg(() => db.prepare("UPDATE shipments SET status = 'DELIVERED' WHERE id = ?").run(id), /invalid shipment status transition/);
  db.prepare("UPDATE shipments SET status = 'IN_TRANSIT', status_changed_at = 'now', last_note = 'go' WHERE id = ?").run(id);
  const events = rows(db, 'SELECT status, note FROM shipment_events WHERE shipment_id = ? ORDER BY id', id);
  assert.deepEqual(events.map((e) => e.status), ['PLANNED', 'IN_TRANSIT']);
  assert.equal(events[1].note, 'go');
  throwsMsg(() => db.prepare("UPDATE shipments SET status = 'CANCELLED' WHERE id = ?").run(id), /invalid shipment status transition/);
  throwsMsg(() => db.prepare('UPDATE shipment_items SET quantity = 99 WHERE shipment_id = ?').run(id), /immutable/);
  throwsMsg(() => db.prepare('DELETE FROM shipment_events').run(), /append-only/);
});

test('receipts can only be recorded while a shipment is in transit', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.tarp, 50);
  createRequest(db, w.users.coord1, { campId: w.c1, urgency: 3, items: [{ itemId: w.tarp, quantity: 20 }] }, T0);
  const { shipmentIds } = commitAllocation(db, w.users.admin, {}, T0);
  throwsMsg(() => db.prepare('UPDATE shipment_items SET quantity_received = 5 WHERE shipment_id = ?').run(shipmentIds[0]), /in-transit/);
});

test('business rules in triggers: closed camps, distribution guard, inventory delete guard', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.water, 10);
  db.prepare("UPDATE camps SET status = 'CLOSED' WHERE id = ?").run(w.c3);
  throwsMsg(() => db.prepare("INSERT INTO requests (camp_id, requested_by, urgency, created_at, updated_at) VALUES (?, ?, 1, 'x', 'x')").run(w.c3, w.coord3), /closed camp/);
  throwsMsg(() => db.prepare('DELETE FROM inventory WHERE warehouse_id = ?').run(w.whA), /still holds stock/);
  db.prepare("INSERT INTO camp_stock (camp_id, item_id, quantity, updated_at) VALUES (?, ?, 5, 'x')").run(w.c1, w.water);
  throwsMsg(() => db.prepare("INSERT INTO distributions (camp_id, item_id, quantity, people_served, distributed_by, created_at) VALUES (?, ?, 6, 1, ?, 'x')").run(w.c1, w.water, w.coord1), /exceeds stock/);
});

test('views: supply versus demand and the allocator work queue', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.tarp, 40);
  stock(db, w.whB, w.tarp, 10);
  createRequest(db, w.users.coord1, { campId: w.c1, urgency: 3, items: [{ itemId: w.tarp, quantity: 100 }] }, T0);
  createRequest(db, w.users.coord2, { campId: w.c2, urgency: 2, items: [{ itemId: w.tarp, quantity: 50 }] }, T0);
  const v = row(db, 'SELECT * FROM v_item_supply_demand WHERE item_id = ?', w.tarp);
  assert.equal(v.available, 50);
  assert.equal(v.open_demand, 150);
  assert.equal(v.shortage, 100);
  assert.ok(Math.abs(v.coverage - 0.3333) < 1e-4);
  assert.equal(rows(db, 'SELECT * FROM v_open_demand').length, 2);
});

test('reconciliation views detect tampering', () => {
  const db = freshDb();
  const w = smallWorld(db);
  stock(db, w.whA, w.tarp, 40);
  createRequest(db, w.users.coord1, { campId: w.c1, urgency: 3, items: [{ itemId: w.tarp, quantity: 10 }] }, T0);
  commitAllocation(db, w.users.admin, {}, T0);
  assert.equal(checkIntegrity(db).ok, true);
  db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand + 5').run(); // bypasses the ledger
  const bad = checkIntegrity(db);
  assert.equal(bad.ok, false);
  assert.equal(bad.problems[0].check, 'v_ledger_mismatch');
  db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand - 5').run();
  db.prepare('UPDATE request_items SET quantity_allocated = 0').run();
  assert.equal(checkIntegrity(db).problems[0].check, 'v_allocation_mismatch');
});

test('indexes: partial and composite indexes are used by the hot queries', () => {
  const db = freshDb();
  const plan = (sql) => rows(db, `EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail).join(' | ');
  assert.match(plan('SELECT id FROM request_items WHERE quantity_allocated < quantity_approved AND item_id = 3'), /idx_request_items_open/);
  assert.match(plan("SELECT id FROM requests WHERE status = 'PENDING' AND urgency = 4"), /idx_requests_status_urgency/);
  assert.match(plan('SELECT * FROM stock_movements WHERE warehouse_id = 1 AND item_id = 2 ORDER BY created_at'), /idx_movements_wh_item/);
  assert.match(plan("SELECT * FROM shipments WHERE camp_id = 1 AND status = 'PLANNED'"), /idx_shipments_camp/);
});

test('tx(): commits on success, rolls back everything on failure, supports nesting', () => {
  const db = freshDb();
  smallWorld(db);
  const count = () => row(db, 'SELECT COUNT(*) AS n FROM audit_log').n;
  tx(db, () => { db.prepare("INSERT INTO audit_log (action, entity_type, created_at) VALUES ('A','x','t')").run(); });
  assert.equal(count(), 1);
  assert.throws(() => tx(db, () => {
    db.prepare("INSERT INTO audit_log (action, entity_type, created_at) VALUES ('B','x','t')").run();
    throw new Error('boom');
  }), /boom/);
  assert.equal(count(), 1);
  tx(db, () => { tx(db, () => db.prepare("INSERT INTO audit_log (action, entity_type, created_at) VALUES ('C','x','t')").run()); });
  assert.equal(count(), 2);
});

test('isolation: a second connection cannot start a write transaction while one is open, then sees the committed state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-iso-'));
  const file = path.join(dir, 't.db');
  const a = openDb(file);
  migrate(a);
  const w = smallWorld(a);
  stock(a, w.whA, w.tarp, 10);
  const b = openDb(file, { busyTimeoutMs: 50 });
  try {
    a.exec('BEGIN IMMEDIATE');
    a.prepare('UPDATE inventory SET quantity_reserved = 10 WHERE warehouse_id = ?').run(w.whA);
    throwsMsg(() => b.exec('BEGIN IMMEDIATE'), /locked|busy/i); // writer is excluded
    assert.equal(row(b, 'SELECT quantity_reserved AS r FROM inventory').r, 0); // readers see only committed data
    a.exec('COMMIT');
    b.exec('BEGIN IMMEDIATE');
    assert.equal(row(b, 'SELECT quantity_reserved AS r FROM inventory').r, 10); // and now the committed value
    throwsMsg(() => b.prepare('UPDATE inventory SET quantity_reserved = 11').run(), /CHECK constraint/); // cannot over-reserve
    b.exec('ROLLBACK');
  } finally {
    a.close();
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
