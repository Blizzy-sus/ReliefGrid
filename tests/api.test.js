import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, smallWorld, stock, startServer, row, rows, PASSWORD } from './helpers.js';
import { checkIntegrity } from '../server/services/reports.js';

let db; let w; let srv; let admin; let wmA; let wmB; let coord1; let coord2; let vol;

// Every test gets a fresh database and server so tests are independent.
async function setup({ stockA = 4000, stockB = 4000 } = {}) {
  db = freshDb();
  w = smallWorld(db);
  stock(db, w.whA, w.water, stockA);
  stock(db, w.whB, w.water, stockB);
  stock(db, w.whA, w.tarp, 100);
  srv = await startServer(db);
  admin = await srv.login('admin');
  wmA = await srv.login('wm_a');
  wmB = await srv.login('wm_b');
  coord1 = await srv.login('coord1');
  coord2 = await srv.login('coord2');
  vol = await srv.login('vol');
}
const teardown = async () => { await srv.close(); db.close(); };
const request = (client, camp, urgency, items, extra = {}) => client.post('/api/requests', { campId: camp, urgency, items, ...extra });

test('authentication: login, bad password, missing token, logout, deactivation', async () => {
  await setup();
  try {
    const anon = srv.client();
    assert.equal((await anon.get('/api/dashboard')).status, 401);
    assert.equal((await anon.post('/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
    assert.equal((await anon.post('/api/auth/login', { username: 'nobody', password: 'x' })).status, 401);
    const ok = await anon.post('/api/auth/login', { username: 'ADMIN', password: PASSWORD }); // case-insensitive username
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token.length > 30);
    assert.equal(ok.body.user.role, 'admin');
    assert.equal(JSON.stringify(ok.body).includes('password_hash'), false);
    const authed = srv.client(ok.body.token);
    assert.equal((await authed.get('/api/auth/me')).body.username, 'admin');
    assert.equal((await authed.post('/api/auth/logout')).status, 200);
    assert.equal((await authed.get('/api/auth/me')).status, 401);
    // tokens are stored hashed, never in clear
    assert.equal(row(db, 'SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?', ok.body.token).n, 0);
    // deactivated users lose access immediately
    await admin.patch(`/api/users/${w.coord1}`, { active: false });
    assert.equal((await coord1.get('/api/auth/me')).status, 401);
    assert.equal((await srv.client().post('/api/auth/login', { username: 'coord1', password: PASSWORD })).status, 401);
    assert.ok(row(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'LOGIN_FAILED'").n >= 3);
  } finally { await teardown(); }
});

test('authentication: repeated failures are rate limited', async () => {
  await setup();
  try {
    const anon = srv.client();
    for (let i = 0; i < 8; i++) await anon.post('/api/auth/login', { username: 'admin', password: 'nope' });
    assert.equal((await anon.post('/api/auth/login', { username: 'admin', password: PASSWORD })).status, 429);
  } finally { await teardown(); }
});

test('role-based access control', async () => {
  await setup();
  try {
    const items = [{ itemId: w.tarp, quantity: 10 }];
    assert.equal((await request(vol, w.c1, 2, items)).status, 403); // volunteers cannot request
    assert.equal((await request(coord1, w.c2, 2, items)).status, 403); // coordinators only for their own camp
    assert.equal((await request(wmA, w.c1, 2, items)).status, 403);
    const created = await request(coord1, w.c1, 2, items);
    assert.equal(created.status, 201);
    // only admins allocate
    for (const c of [coord1, wmA, vol]) {
      assert.equal((await c.post('/api/allocation/preview')).status, 403);
      assert.equal((await c.post('/api/allocation/run')).status, 403);
    }
    assert.equal((await admin.post('/api/allocation/preview')).status, 200);
    // admin-only master data and audit
    assert.equal((await coord1.post('/api/items', { categoryId: 1, name: 'X', unit: 'u' })).status, 403);
    assert.equal((await wmA.get('/api/users')).status, 403);
    assert.equal((await coord1.get('/api/audit')).status, 403);
    assert.equal((await admin.get('/api/audit')).status, 200);
    // stock: warehouse managers only touch their own warehouse
    assert.equal((await wmA.post('/api/inventory/receive', { warehouseId: w.whB, itemId: w.tarp, quantity: 5 })).status, 403);
    assert.equal((await wmA.post('/api/inventory/receive', { warehouseId: w.whA, itemId: w.tarp, quantity: 5 })).status, 201);
    assert.equal((await coord1.post('/api/inventory/receive', { warehouseId: w.whA, itemId: w.tarp, quantity: 5 })).status, 403);
    // camp data: coordinators edit only their own camp, and cannot change its status
    assert.equal((await coord1.patch(`/api/camps/${w.c1}`, { population: 1100 })).status, 200);
    assert.equal((await coord1.patch(`/api/camps/${w.c2}`, { population: 1 })).status, 403);
    assert.equal((await coord1.patch(`/api/camps/${w.c1}`, { status: 'CLOSED' })).status, 403);
    // cancelling someone else's request
    assert.equal((await coord2.post(`/api/requests/${created.body.id}/cancel`)).status, 403);
    assert.equal((await coord1.post(`/api/requests/${created.body.id}/cancel`)).status, 200);
  } finally { await teardown(); }
});

test('request validation and standard-based approval', async () => {
  await setup();
  try {
    assert.equal((await request(coord1, w.c1, 9, [{ itemId: w.tarp, quantity: 1 }])).status, 400);
    assert.equal((await request(coord1, w.c1, 2, [])).status, 400);
    assert.equal((await request(coord1, w.c1, 2, [{ itemId: w.tarp, quantity: -5 }])).status, 400);
    assert.equal((await request(coord1, w.c1, 2, [{ itemId: w.tarp, quantity: 1.5 }])).status, 400);
    assert.equal((await request(coord1, w.c1, 2, [{ itemId: w.tarp, quantity: 1 }, { itemId: w.tarp, quantity: 2 }])).status, 400);
    assert.equal((await request(coord1, w.c1, 2, [{ itemId: 9999, quantity: 1 }])).status, 400);
    // 1000 people x 5 L x 3 days = 15,000 L is the planning cap
    const r = await request(coord1, w.c1, 4, [{ itemId: w.water, quantity: 40000 }, { itemId: w.tarp, quantity: 300 }]);
    assert.equal(r.status, 201);
    const detail = (await coord1.get(`/api/requests/${r.body.id}`)).body;
    const water = detail.items.find((i) => i.itemName === 'Water');
    assert.equal(water.requested, 40000);
    assert.equal(water.approved, 15000);
    assert.match(water.approvalNote, /planning standard/);
    assert.equal(detail.items.find((i) => i.itemName === 'Tarpaulin').approved, 300); // no standard: approved as asked
    // admin can override upwards (never above the request) and the change is audited
    const ri = water.id;
    assert.equal((await admin.post(`/api/request-items/${ri}/approval`, { approved: 50000 })).status, 400);
    assert.equal((await admin.post(`/api/request-items/${ri}/approval`, { approved: 20000, note: 'Hospital wing' })).status, 200);
    assert.equal(row(db, 'SELECT quantity_approved AS a FROM request_items WHERE id = ?', ri).a, 20000);
    assert.equal(row(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'APPROVAL_OVERRIDDEN'").n, 1);
    // closed camps cannot request
    await admin.patch(`/api/camps/${w.c3}`, { status: 'CLOSED' });
    const coord3 = await srv.login('coord3');
    assert.equal((await request(coord3, w.c3, 1, [{ itemId: w.tarp, quantity: 1 }])).status, 409);
  } finally { await teardown(); }
});

test('preview changes nothing; run is atomic, explainable and reserves stock', async () => {
  await setup({ stockA: 3000, stockB: 1000 });
  try {
    await request(coord1, w.c1, 4, [{ itemId: w.water, quantity: 15000 }]);
    await request(coord2, w.c2, 2, [{ itemId: w.water, quantity: 7500 }]);
    const before = row(db, 'SELECT (SELECT COUNT(*) FROM allocation_runs) AS runs, (SELECT COUNT(*) FROM shipments) AS ships, (SELECT SUM(quantity_reserved) FROM inventory) AS reserved');
    const preview = (await admin.post('/api/allocation/preview')).body;
    assert.equal(preview.totals.scarceItems, 1);
    assert.equal(preview.totals.unitsAllocated, 4000); // everything there is
    const after = row(db, 'SELECT (SELECT COUNT(*) FROM allocation_runs) AS runs, (SELECT COUNT(*) FROM shipments) AS ships, (SELECT SUM(quantity_reserved) FROM inventory) AS reserved');
    assert.deepEqual(after, before);

    const run = await admin.post('/api/allocation/run', { note: 'test' });
    assert.equal(run.status, 201);
    const d1 = run.body.decisions.find((d) => d.campId === w.c1);
    const d2 = run.body.decisions.find((d) => d.campId === w.c2);
    assert.ok(d1.allocated > d2.allocated, 'critical, vulnerable camp gets more');
    assert.equal(d1.allocated + d2.allocated, 4000);
    assert.ok(d1.coverage > d2.coverage);
    assert.match(d1.explanation, /Critical/);
    // history is queryable and reproduces the decisions
    const hist = (await admin.get(`/api/allocation/runs/${run.body.runId}`)).body;
    assert.equal(hist.decisions.length, 2);
    assert.equal(hist.params.urgencyLevels.length, 4);
    assert.equal(hist.shipments.length, run.body.shipmentIds.length);
    // reservations in place, nothing physically moved yet
    const inv = row(db, 'SELECT SUM(quantity_on_hand) AS oh, SUM(quantity_reserved) AS r FROM inventory WHERE item_id = ?', w.water);
    assert.deepEqual(inv, { oh: 4000, r: 4000 });
    assert.equal(checkIntegrity(db).ok, true);
    // request statuses reflect partial coverage
    assert.equal((await admin.get(`/api/requests/${d1.requestId}`)).body.status, 'PARTIALLY_ALLOCATED');
  } finally { await teardown(); }
});

test('over-allocation is impossible: a second run only sees what is left', async () => {
  await setup({ stockA: 1000, stockB: 0 });
  try {
    await request(coord1, w.c1, 3, [{ itemId: w.water, quantity: 5000 }]);
    const r1 = await admin.post('/api/allocation/run');
    assert.equal(r1.body.totals.unitsAllocated, 1000);
    await request(coord2, w.c2, 3, [{ itemId: w.water, quantity: 2000 }]);
    const r2 = await admin.post('/api/allocation/run');
    assert.equal(r2.status, 201);
    assert.equal(r2.body.totals.unitsAllocated, 0); // all stock is already reserved
    assert.equal(row(db, 'SELECT quantity_reserved AS r, quantity_on_hand AS oh FROM inventory WHERE warehouse_id = ? AND item_id = ?', w.whA, w.water).r, 1000);
    assert.equal(checkIntegrity(db).ok, true);
    // and the database itself refuses to over-reserve even if the application tried
    assert.throws(() => db.prepare('UPDATE inventory SET quantity_reserved = quantity_reserved + 1 WHERE warehouse_id = ? AND item_id = ?').run(w.whA, w.water), /CHECK constraint/);
  } finally { await teardown(); }
});

test('concurrent allocation runs never double-book stock', async () => {
  await setup({ stockA: 2500, stockB: 2500 });
  try {
    await request(coord1, w.c1, 4, [{ itemId: w.water, quantity: 15000 }]);
    await request(coord2, w.c2, 3, [{ itemId: w.water, quantity: 7500 }]);
    const results = await Promise.all(Array.from({ length: 8 }, () => admin.post('/api/allocation/run')));
    assert.ok(results.every((r) => r.status === 201 || r.status === 409));
    const inv = row(db, 'SELECT SUM(quantity_on_hand) AS oh, SUM(quantity_reserved) AS r FROM inventory WHERE item_id = ?', w.water);
    assert.equal(inv.oh, 5000);
    assert.equal(inv.r, 5000); // all of it, exactly once
    const allocated = row(db, 'SELECT SUM(quantity_allocated) AS a FROM request_items').a;
    assert.equal(allocated, 5000);
    assert.equal(checkIntegrity(db).ok, true);
  } finally { await teardown(); }
});

test('a failure part-way through a run rolls everything back', async () => {
  await setup({ stockA: 3000, stockB: 1000 });
  try {
    await request(coord1, w.c1, 4, [{ itemId: w.water, quantity: 15000 }, { itemId: w.tarp, quantity: 50 }]);
    db.exec("CREATE TRIGGER t_fail BEFORE INSERT ON audit_log WHEN NEW.action = 'ALLOCATION_RUN' BEGIN SELECT RAISE(ABORT, 'simulated crash at the last step'); END;");
    const res = await admin.post('/api/allocation/run');
    assert.ok(res.status >= 400);
    assert.deepEqual(row(db, 'SELECT (SELECT COUNT(*) FROM allocation_runs) a, (SELECT COUNT(*) FROM shipments) s, (SELECT COUNT(*) FROM allocation_decisions) d, (SELECT SUM(quantity_reserved) FROM inventory) r, (SELECT SUM(quantity_allocated) FROM request_items) q'),
      { a: 0, s: 0, d: 0, r: 0, q: 0 });
    assert.equal(row(db, "SELECT COUNT(*) AS n FROM stock_movements WHERE movement_type = 'RESERVE'").n, 0);
    db.exec('DROP TRIGGER t_fail');
    assert.equal((await admin.post('/api/allocation/run')).status, 201); // and it works once the fault is gone
    assert.equal(checkIntegrity(db).ok, true);
  } finally { await teardown(); }
});

test('full lifecycle: request -> allocation -> dispatch -> partial delivery -> re-allocation -> distribution', async () => {
  await setup({ stockA: 20000, stockB: 0 });
  try {
    const rq = await request(coord1, w.c1, 3, [{ itemId: w.water, quantity: 10000 }, { itemId: w.tarp, quantity: 40 }]);
    const run = (await admin.post('/api/allocation/run')).body;
    assert.equal(run.shipmentIds.length, 1);
    const sid = run.shipmentIds[0];
    let ship = (await admin.get(`/api/shipments/${sid}`)).body;
    assert.equal(ship.status, 'PLANNED');
    assert.equal(ship.items.length, 2);

    // cannot deliver before dispatch; wrong warehouse cannot dispatch
    assert.equal((await admin.post(`/api/shipments/${sid}/deliver`)).status, 409);
    assert.equal((await wmB.post(`/api/shipments/${sid}/dispatch`)).status, 403);
    assert.equal((await wmA.post(`/api/shipments/${sid}/assign`, { volunteerId: w.coord1 })).status, 400); // not a volunteer
    assert.equal((await wmA.post(`/api/shipments/${sid}/assign`, { volunteerId: w.vol })).status, 200);
    assert.equal((await wmA.post(`/api/shipments/${sid}/dispatch`, { vehicle: 'TN-01-AB-1234' })).status, 200);
    assert.equal((await wmA.post(`/api/shipments/${sid}/dispatch`)).status, 409); // not twice

    const afterDispatch = row(db, 'SELECT quantity_on_hand AS oh, quantity_reserved AS r FROM inventory WHERE warehouse_id = ? AND item_id = ?', w.whA, w.water);
    assert.deepEqual(afterDispatch, { oh: 10000, r: 0 });
    assert.equal(checkIntegrity(db).ok, true);

    // only the assigned volunteer, the receiving camp or an admin may confirm
    assert.equal((await coord2.post(`/api/shipments/${sid}/deliver`)).status, 403);
    ship = (await vol.get(`/api/shipments/${sid}`)).body;
    const waterLine = ship.items.find((i) => i.itemName === 'Water');
    const received = [{ shipmentItemId: waterLine.id, quantity: 9000 }]; // 1000 L spoiled in transit
    const del = await vol.post(`/api/shipments/${sid}/deliver`, { received, note: 'Two pallets soaked' });
    assert.equal(del.status, 200);
    assert.equal(del.body.shortfall, 1000);
    assert.equal(row(db, 'SELECT quantity FROM camp_stock WHERE camp_id = ? AND item_id = ?', w.c1, w.water).quantity, 9000);
    const line = row(db, 'SELECT quantity_allocated AS a, quantity_delivered AS d FROM request_items WHERE item_id = ?', w.water);
    assert.deepEqual(line, { a: 9000, d: 9000 }); // shortfall released for re-allocation
    assert.equal((await admin.get(`/api/requests/${rq.body.id}`)).body.status, 'PARTIALLY_ALLOCATED');
    assert.equal(checkIntegrity(db).ok, true);

    // the next run covers exactly the shortfall
    const run2 = (await admin.post('/api/allocation/run')).body;
    assert.equal(run2.totals.unitsAllocated, 1000);
    const ship2 = run2.shipmentIds[0];
    await wmA.post(`/api/shipments/${ship2}/dispatch`);
    assert.equal((await coord1.post(`/api/shipments/${ship2}/deliver`)).status, 200); // camp coordinator confirms, full receipt by default
    assert.equal((await admin.get(`/api/requests/${rq.body.id}`)).body.status, 'FULFILLED');
    assert.equal(row(db, 'SELECT quantity FROM camp_stock WHERE camp_id = ? AND item_id = ?', w.c1, w.water).quantity, 10000);

    // distribution: cannot hand out more than the camp holds
    assert.equal((await coord1.post('/api/distributions', { campId: w.c1, itemId: w.water, quantity: 10001, peopleServed: 900 })).status, 409);
    assert.equal((await coord1.post('/api/distributions', { campId: w.c1, itemId: w.water, quantity: 4000, peopleServed: 900 })).status, 201);
    assert.equal((await coord1.post('/api/distributions', { campId: w.c1, itemId: w.water, quantity: 4000, peopleServed: 5000 })).status, 400); // more people than the camp holds
    assert.equal((await coord2.post('/api/distributions', { campId: w.c1, itemId: w.water, quantity: 1, peopleServed: 1 })).status, 403);
    assert.equal(row(db, 'SELECT quantity FROM camp_stock WHERE camp_id = ? AND item_id = ?', w.c1, w.water).quantity, 6000);

    // the shipment timeline was written by a trigger
    const timeline = (await admin.get(`/api/shipments/${sid}`)).body.events.map((e) => e.status);
    assert.deepEqual(timeline, ['PLANNED', 'IN_TRANSIT', 'DELIVERED']);
    assert.equal(checkIntegrity(db).ok, true);
  } finally { await teardown(); }
});

test('cancelling a planned shipment releases its reservation and re-queues the demand', async () => {
  await setup({ stockA: 1000, stockB: 0 });
  try {
    const rq = await request(coord1, w.c1, 3, [{ itemId: w.water, quantity: 800 }]);
    const run = (await admin.post('/api/allocation/run')).body;
    const sid = run.shipmentIds[0];
    assert.equal(row(db, 'SELECT quantity_reserved AS r FROM inventory WHERE item_id = ? AND warehouse_id = ?', w.water, w.whA).r, 800);
    assert.equal((await wmB.post(`/api/shipments/${sid}/cancel`)).status, 403);
    assert.equal((await wmA.post(`/api/shipments/${sid}/cancel`, { note: 'Road washed out' })).status, 200);
    assert.equal(row(db, 'SELECT quantity_reserved AS r FROM inventory WHERE item_id = ? AND warehouse_id = ?', w.water, w.whA).r, 0);
    assert.equal(row(db, 'SELECT quantity_allocated AS a FROM request_items WHERE item_id = ?', w.water).a, 0);
    assert.equal((await admin.get(`/api/requests/${rq.body.id}`)).body.status, 'PENDING');
    assert.equal((await wmA.post(`/api/shipments/${sid}/cancel`)).status, 409); // already cancelled
    assert.equal((await wmA.post(`/api/shipments/${sid}/dispatch`)).status, 409);
    assert.equal(checkIntegrity(db).ok, true);
    // a request with active shipments cannot be cancelled; once re-planned it can be after the shipment is cancelled
    const run2 = (await admin.post('/api/allocation/run')).body;
    assert.equal((await coord1.post(`/api/requests/${rq.body.id}/cancel`)).status, 409);
    await wmA.post(`/api/shipments/${run2.shipmentIds[0]}/cancel`);
    assert.equal((await coord1.post(`/api/requests/${rq.body.id}/cancel`)).status, 200);
  } finally { await teardown(); }
});

test('inventory: receipts, adjustments and the reserved-stock floor', async () => {
  await setup({ stockA: 500, stockB: 0 });
  try {
    await request(coord1, w.c1, 3, [{ itemId: w.water, quantity: 400 }]);
    await admin.post('/api/allocation/run'); // reserves 400
    assert.equal((await wmA.post('/api/inventory/adjust', { warehouseId: w.whA, itemId: w.water, delta: -200, reason: 'Recount' })).status, 409); // would drop below reserved
    assert.equal((await wmA.post('/api/inventory/adjust', { warehouseId: w.whA, itemId: w.water, delta: -100, reason: 'Leaking containers' })).status, 200);
    assert.equal((await wmA.post('/api/inventory/adjust', { warehouseId: w.whA, itemId: w.water, delta: 0, reason: 'nothing' })).status, 400);
    assert.equal((await wmA.post('/api/inventory/adjust', { warehouseId: w.whA, itemId: w.water, delta: -1 })).status, 400); // a reason is required
    assert.equal((await wmA.post('/api/inventory/receive', { warehouseId: w.whA, itemId: w.water, quantity: 1000, note: 'Tanker' })).status, 201);
    assert.equal((await wmA.post('/api/inventory/receive', { warehouseId: w.whA, itemId: w.water, quantity: -5 })).status, 400);
    const inv = (await wmA.get(`/api/inventory?warehouseId=${w.whA}`)).body.find((i) => i.itemName === 'Water');
    assert.equal(inv.onHand, 1400);
    assert.equal(inv.reserved, 400);
    assert.equal(inv.available, 1000);
    const moves = (await wmA.get(`/api/inventory/movements?warehouseId=${w.whA}&itemId=${w.water}`)).body;
    assert.deepEqual(moves.map((m) => m.type).reverse(), ['OPENING', 'RESERVE', 'ADJUSTMENT', 'RECEIPT']);
    assert.equal(checkIntegrity(db).ok, true);
  } finally { await teardown(); }
});

test('dashboard, alerts, analytics and integrity endpoints respond with consistent data', async () => {
  await setup({ stockA: 1000, stockB: 0 });
  try {
    await request(coord1, w.c1, 4, [{ itemId: w.water, quantity: 15000 }]);
    const dash = (await vol.get('/api/dashboard')).body;
    assert.equal(dash.requests.open, 1);
    assert.equal(dash.requests.openCritical, 1);
    const water = dash.supplyDemand.find((s) => s.itemName === 'Water');
    assert.equal(water.openDemand, 15000);
    assert.equal(water.shortage, 15000 - 1000);
    const alerts = (await vol.get('/api/alerts')).body;
    assert.ok(alerts.some((a) => a.type === 'SHORTAGE' && /Water/.test(a.title)));
    assert.equal((await vol.get('/api/analytics')).status, 200);
    assert.equal((await vol.get('/api/integrity')).status, 403);
    assert.equal((await admin.get('/api/integrity')).body.ok, true);
  } finally { await teardown(); }
});

test('input hardening: malformed JSON, unknown routes, oversized ids', async () => {
  await setup();
  try {
    const raw = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
    assert.equal(raw.status, 400);
    assert.equal((await admin.get('/api/nope')).status, 404);
    assert.equal((await admin.get('/api/requests/abc')).status, 400);
    assert.equal((await admin.get('/api/requests/999999')).status, 404);
    assert.equal((await admin.get("/api/requests?status=x'%3B--")).status, 400);
    const injection = await admin.post('/api/auth/login', { username: "admin' OR '1'='1", password: 'x' });
    assert.equal(injection.status, 401);
    assert.equal(row(db, 'SELECT COUNT(*) AS n FROM users').n, 7);
  } finally { await teardown(); }
});
