import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startServer, row, rows } from './helpers.js';
import { seedDatabase, DEMO_PASSWORD } from '../server/seed.js';
import { previewAllocation, commitAllocation } from '../server/services/allocation.js';
import { checkIntegrity } from '../server/services/reports.js';

const NOW = new Date('2026-07-15T12:00:00Z');
let db; let srv;

before(async () => {
  db = freshDb();
  seedDatabase(db, { now: NOW });
  srv = await startServer(db, { clock: () => NOW });
});
after(async () => { await srv.close(); db.close(); });

test('the demo seed is internally consistent and shaped like a real incident', () => {
  assert.equal(checkIntegrity(db).ok, true);
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM camps WHERE status <> \'CLOSED\'').n, 12);
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM warehouses').n, 4);
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM allocation_runs').n, 2);
  const byStatus = Object.fromEntries(rows(db, 'SELECT status, COUNT(*) AS n FROM shipments GROUP BY status').map((r) => [r.status, r.n]));
  assert.ok(byStatus.DELIVERED > 20 && byStatus.IN_TRANSIT >= 1 && byStatus.PLANNED >= 1, JSON.stringify(byStatus));
  assert.ok(row(db, 'SELECT COUNT(*) AS n FROM distributions').n > 50);
  assert.ok(row(db, 'SELECT COUNT(*) AS n FROM shipment_items WHERE quantity_received < quantity').n >= 1, 'partial deliveries were seeded');
  assert.ok(row(db, "SELECT COUNT(*) AS n FROM requests WHERE status = 'PENDING'").n >= 10, 'open demand left for the live demo');
});

test('live scenario: scarce items are rationed by priority, abundant items are met in full', () => {
  const plan = previewAllocation(db, {}, NOW);
  const scarce = plan.items.filter((i) => i.scarce).map((i) => i.itemName);
  assert.ok(scarce.includes('Packaged drinking water') && scarce.includes('Insulin vials') && scarce.includes('Tarpaulin sheets'), scarce.join(', '));
  assert.ok(plan.items.some((i) => !i.scarce), 'some items are plentiful');

  for (const item of plan.items) {
    const ds = plan.decisions.filter((d) => d.itemId === item.itemId);
    const allocated = ds.reduce((s, d) => s + d.allocated, 0);
    assert.ok(allocated <= item.supply, `${item.itemName}: allocated ${allocated} > supply ${item.supply}`);
    assert.equal(allocated, Math.min(item.supply, item.demand), `${item.itemName}: stock not fully used`);
    for (const d of ds) {
      assert.ok(d.allocated <= d.need && d.allocated >= 0);
      assert.ok(d.explanation.length > 20);
      if (!item.scarce) assert.equal(d.allocated, d.need);
    }
    if (item.scarce) {
      // among lines starting from zero, coverage follows priority
      const fresh = ds.filter((d) => d.prior === 0 && d.approved >= 400).sort((a, b) => a.score - b.score);
      for (let i = 1; i < fresh.length; i++) {
        assert.ok(fresh[i].coverage >= fresh[i - 1].coverage - 0.01, `${item.itemName}: ${fresh[i].campName} (score ${fresh[i].score}) is covered less than ${fresh[i - 1].campName}`);
      }
    }
  }
});

test('live scenario: critical requests are covered better than low-urgency ones for water', () => {
  const plan = previewAllocation(db, {}, NOW);
  const water = plan.decisions.filter((d) => d.itemName === 'Packaged drinking water' && d.prior === 0);
  const avg = (label) => {
    const xs = water.filter((d) => d.urgencyLabel === label);
    return xs.reduce((s, d) => s + d.cumulativeCoverage, 0) / xs.length;
  };
  assert.ok(avg('Critical') > avg('High'), 'critical > high');
  assert.ok(avg('High') > avg('Moderate'), 'high > moderate');
  assert.ok(avg('Moderate') > avg('Low'), 'moderate > low');
  assert.ok(water.every((d) => d.allocated > 0), 'nobody is starved of water outright');
});

test('live scenario: committing the run via the API reserves every unit of scarce stock exactly once', async () => {
  const admin = await srv.login('admin', DEMO_PASSWORD);
  const preview = (await admin.post('/api/allocation/preview')).body;
  const res = await admin.post('/api/allocation/run', { note: 'integration test' });
  assert.equal(res.status, 201);
  assert.equal(res.body.totals.unitsAllocated, preview.totals.unitsAllocated);
  assert.equal(checkIntegrity(db).ok, true);
  const water = row(db, "SELECT SUM(quantity_on_hand) AS oh, SUM(quantity_reserved) AS r FROM inventory WHERE item_id = (SELECT id FROM supply_items WHERE name = 'Packaged drinking water')");
  assert.equal(water.r, water.oh);
  // every planned shipment has stock behind it
  assert.equal(rows(db, 'SELECT * FROM v_reservation_mismatch').length, 0);
  // a second run has nothing left for the scarce items
  const again = await admin.post('/api/allocation/run');
  const scarceAllocated = again.body.decisions.filter((d) => d.scarce).reduce((s, d) => s + d.allocated, 0);
  assert.equal(scarceAllocated, 0);
  assert.equal(checkIntegrity(db).ok, true);
});

test('role journeys on the demo data', async () => {
  const coordinator = await srv.login('coord_marudhur', DEMO_PASSWORD);
  const me = (await coordinator.get('/api/auth/me')).body;
  assert.equal(me.role, 'camp_coordinator');
  const mine = (await coordinator.get(`/api/requests?campId=${me.campId}`)).body;
  assert.ok(mine.length >= 2);
  const detail = (await coordinator.get(`/api/requests/${mine[0].id}`)).body;
  assert.ok(detail.items.length > 0);
  const volunteer = await srv.login('vol_asha', DEMO_PASSWORD);
  assert.equal((await volunteer.get('/api/shipments?mine=1')).status, 200);
  const manager = await srv.login('wm_thanjavur', DEMO_PASSWORD);
  const inv = (await manager.get(`/api/inventory?warehouseId=${(await manager.get('/api/auth/me')).body.warehouseId}`)).body;
  assert.ok(inv.length >= 10);
  assert.equal((await manager.post('/api/allocation/run')).status, 403);
});
