import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';
import { seedDatabase } from '../server/seed.js';
import { loadQueries } from '../scripts/run-queries.js';

const NOW = new Date('2026-07-15T12:00:00Z');
const db = freshDb();
seedDatabase(db, { now: NOW });
const queries = loadQueries();

test('db/queries.sql contains the documented showcase queries', () => {
  assert.equal(queries.length, 17);
  assert.deepEqual(queries.map((q) => q.name).slice(0, 3), ['q01_shortage_by_item', 'q02_camps_ranked_by_unmet_need', 'q03_requests_past_sla']);
  for (const q of queries) assert.ok(q.description.length > 10 && q.sql.length > 20, `${q.name} lacks a description or SQL`);
});

const MAY_BE_EMPTY = new Set(['q13_items_low_everywhere']); // a legitimate "none right now" answer
for (const q of queries) {
  test(`query ${q.name} runs on the demo data${MAY_BE_EMPTY.has(q.name) ? '' : ' and returns rows'}`, () => {
    const rows = db.prepare(q.sql).all();
    if (!MAY_BE_EMPTY.has(q.name)) assert.ok(rows.length > 0, `${q.name} returned no rows`);
  });
}

test('q15 reports a consistent database', () => {
  const q = queries.find((x) => x.name === 'q15_integrity_report');
  assert.ok(db.prepare(q.sql).all().every((r) => r.problems === 0));
});

test('q10 ledger replay ends at the inventory balance', () => {
  const q = queries.find((x) => x.name === 'q10_ledger_running_balance');
  const rows = db.prepare(q.sql).all();
  const last = rows[rows.length - 1];
  const inv = db.prepare(`SELECT quantity_on_hand AS oh, quantity_reserved AS r FROM inventory
    WHERE warehouse_id = (SELECT MIN(id) FROM warehouses) AND item_id = (SELECT id FROM supply_items WHERE name = 'Packaged drinking water')`).get();
  assert.equal(last.running_on_hand, inv.oh);
  assert.equal(last.running_reserved, inv.r);
});

test('q06 shows higher urgency receiving higher coverage in scarce runs', () => {
  const q = queries.find((x) => x.name === 'q06_fairness_by_urgency_per_run');
  const rows = db.prepare(q.sql).all();
  const run = rows[0].run_id;
  const byUrgency = Object.fromEntries(rows.filter((r) => r.run_id === run).map((r) => [r.urgency, r.avg_cumulative_coverage]));
  if (byUrgency.Critical != null && byUrgency.Low != null) assert.ok(byUrgency.Critical >= byUrgency.Low);
});
