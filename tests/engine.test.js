import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, fairShare, priorityScore } from '../server/allocation/engine.js';
import { approvedQuantity } from '../server/services/requests.js';
import { haversineKm, roadDistanceKm } from '../server/allocation/geo.js';

const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const line = (id, approved, score, prior = 0) => ({ id, approved, prior, score });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent reference solver: bisection on the fair level, exact (real-valued) shares. */
function referenceShares(entries, supply) {
  const give = (e, l) => Math.min(e.approved - e.prior, Math.max(0, e.approved * l * e.score - e.prior));
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (entries.reduce((s, e) => s + give(e, mid), 0) < supply) lo = mid; else hi = mid;
  }
  return new Map(entries.map((e) => [e.id, give(e, hi)]));
}

test('abundance: every line receives its full remaining need', () => {
  const { shares, scarce, level } = fairShare([line('a', 100, 5), line('b', 40, 1, 10)], 1000);
  assert.equal(scarce, false);
  assert.equal(level, null);
  assert.equal(shares.get('a'), 100);
  assert.equal(shares.get('b'), 30);
});

test('equal priority: proportional split of what exists', () => {
  const { shares } = fairShare([line('a', 100, 1), line('b', 100, 1)], 100);
  assert.deepEqual([shares.get('a'), shares.get('b')], [50, 50]);
});

test('priority skew: coverage is proportional to priority, summing exactly to supply', () => {
  const { shares } = fairShare([line('hi', 100, 6), line('lo', 100, 1)], 100);
  assert.equal(shares.get('hi'), 86); // 6/7 of 100, remainder goes to the larger fraction
  assert.equal(shares.get('lo'), 14);
});

test('capping: a small high-priority line is fully served and the surplus is redistributed', () => {
  const { shares } = fairShare([line('small', 10, 10), line('big', 1000, 1)], 500);
  assert.equal(shares.get('small'), 10);
  assert.equal(shares.get('big'), 490);
});

test('deficit awareness: a line that already holds more than the fair level waits', () => {
  const { shares, level } = fairShare([line('served', 100, 1, 80), line('fresh', 100, 1, 0)], 50);
  assert.equal(shares.get('served'), 0);
  assert.equal(shares.get('fresh'), 50);
  assert.ok(Math.abs(level - 0.5) < 1e-9);
});

test('deficit awareness: lines are levelled up to the same cumulative coverage', () => {
  const { shares } = fairShare([line('a', 100, 1, 40), line('b', 100, 1, 0)], 100);
  // fair level L: (100L - 40) + 100L = 100  =>  L = 0.7  =>  a gets 30, b gets 70
  assert.equal(shares.get('a'), 30);
  assert.equal(shares.get('b'), 70);
});

test('no stock: nothing allocated, flagged scarce', () => {
  const r = fairShare([line('a', 10, 1)], 0);
  assert.equal(r.scarce, true);
  assert.equal(r.shares.get('a'), 0);
});

test('property: 600 random scenarios satisfy the allocation invariants and match an exact solver', () => {
  const rand = rng(7);
  for (let n = 0; n < 600; n++) {
    const count = 1 + Math.floor(rand() * 12);
    const entries = Array.from({ length: count }, (_, i) => {
      const approved = 1 + Math.floor(rand() * 2000);
      return { id: `l${i}`, approved, prior: rand() < 0.3 ? Math.floor(rand() * approved) : 0, score: 1 + rand() * 11 };
    });
    const totalNeed = entries.reduce((s, e) => s + e.approved - e.prior, 0);
    const supply = Math.floor(rand() * totalNeed * 1.2);
    const { shares } = fairShare(entries, supply);

    // 1. never more than needed, never negative, integers
    for (const e of entries) {
      const x = shares.get(e.id);
      assert.ok(Number.isInteger(x) && x >= 0 && x <= e.approved - e.prior, `bounds violated in case ${n}`);
    }
    // 2. uses everything available (up to total need)
    assert.equal(sum(shares), Math.min(supply, totalNeed), `supply not fully used in case ${n}`);
    // 3. within one unit of the exact real-valued solution
    if (supply < totalNeed) {
      const exact = referenceShares(entries, supply);
      for (const e of entries) {
        assert.ok(Math.abs(shares.get(e.id) - exact.get(e.id)) < 1 + 1e-6, `case ${n}: ${e.id} got ${shares.get(e.id)}, exact ${exact.get(e.id)}`);
      }
    }
  }
});

test('property: cumulative coverage never decreases with priority among lines that receive stock', () => {
  const rand = rng(99);
  for (let n = 0; n < 200; n++) {
    const entries = Array.from({ length: 8 }, (_, i) => ({ id: i, approved: 500 + Math.floor(rand() * 1500), prior: 0, score: 1 + rand() * 8 }));
    const total = entries.reduce((s, e) => s + e.approved, 0);
    const { shares } = fairShare(entries, Math.floor(total * (0.1 + rand() * 0.7)));
    const sorted = [...entries].sort((a, b) => a.score - b.score);
    for (let i = 1; i < sorted.length; i++) {
      const lo = shares.get(sorted[i - 1].id) / sorted[i - 1].approved;
      const hi = shares.get(sorted[i].id) / sorted[i].approved;
      assert.ok(hi >= lo - 1.5 / sorted[i].approved, `priority inversion in case ${n}`);
    }
  }
});

test('determinism: input order does not change the result', () => {
  const rand = rng(5);
  const entries = Array.from({ length: 15 }, (_, i) => ({ id: i, approved: 50 + Math.floor(rand() * 400), prior: 0, score: 1 + Math.floor(rand() * 5) }));
  const a = fairShare(entries, 1200).shares;
  const b = fairShare([...entries].reverse(), 1200).shares;
  for (const e of entries) assert.equal(a.get(e.id), b.get(e.id));
});

test('priority score: urgency x vulnerability x aging, with aging capped', () => {
  const base = { urgencyWeight: 4, population: 1000, vulnerableCount: 250, createdAt: '2026-07-15T00:00:00Z' };
  const fresh = priorityScore({ ...base, now: '2026-07-15T00:00:00Z' });
  assert.equal(fresh.score, 4 * 1.25 * 1);
  const day = priorityScore({ ...base, now: '2026-07-16T00:00:00Z' });
  assert.ok(Math.abs(day.agingFactor - 1.25) < 1e-9);
  const week = priorityScore({ ...base, now: '2026-07-22T00:00:00Z' });
  assert.equal(week.agingFactor, 1.5); // capped at 1 + max bonus
  assert.equal(priorityScore({ ...base, population: 0, vulnerableCount: 0, now: base.createdAt }).vulnerabilityFactor, 1);
});

test('standard-based approval caps over-requests and explains why', () => {
  const capped = approvedQuantity({ requested: 20000, standard: 5, population: 500, horizonDays: 3 });
  assert.equal(capped.approved, 7500);
  assert.match(capped.note, /planning standard/);
  assert.deepEqual(approvedQuantity({ requested: 7000, standard: 5, population: 500, horizonDays: 3 }), { approved: 7000, note: null });
  assert.deepEqual(approvedQuantity({ requested: 123, standard: null, population: 500, horizonDays: 3 }), { approved: 123, note: null });
  assert.ok(approvedQuantity({ requested: 5, standard: 0.001, population: 1, horizonDays: 1 }).approved >= 1);
});

test('geo: haversine and road distance', () => {
  assert.ok(Math.abs(haversineKm(0, 0, 0, 1) - 111.19) < 0.1);
  assert.equal(haversineKm(10, 79, 10, 79), 0);
  assert.equal(roadDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }, 1.5), Math.round(111.19 * 1.5 * 10) / 10);
});

// -------------------------------------------------------------------- allocate()
const world = () => ({
  camps: new Map([[1, { name: 'Near camp', latitude: 10.0, longitude: 79.0 }], [2, { name: 'Far camp', latitude: 11.0, longitude: 79.0 }]]),
  warehouses: new Map([[1, { name: 'Depot N', latitude: 10.05, longitude: 79.0 }], [2, { name: 'Depot S', latitude: 10.95, longitude: 79.0 }]]),
  items: new Map([[1, { name: 'Water', unit: 'L' }]]),
});
const req = (id, campId, approved, extra = {}) => ({
  requestItemId: id, requestId: id, campId, itemId: 1, approved, prior: 0, urgencyLabel: 'High', urgencyWeight: 3,
  population: 100, vulnerableCount: 0, createdAt: '2026-07-15T12:00:00Z', ...extra,
});

test('allocate: serves each camp from its nearest warehouse and splits across warehouses when needed', () => {
  const w = world();
  const out = allocate({
    ...w, now: '2026-07-15T12:00:00Z',
    requests: [req(1, 1, 150), req(2, 2, 150)],
    stock: [{ warehouseId: 1, itemId: 1, available: 100 }, { warehouseId: 2, itemId: 1, available: 300 }],
  });
  const near = out.decisions.find((d) => d.campId === 1);
  const far = out.decisions.find((d) => d.campId === 2);
  assert.equal(near.allocated, 150);
  assert.equal(far.allocated, 150);
  assert.equal(near.sources[0].warehouseId, 1);
  assert.equal(near.sources[0].quantity, 100);
  assert.equal(near.sources[1].warehouseId, 2);
  assert.equal(near.sources[1].quantity, 50);
  assert.equal(far.sources.reduce((s, x) => s + x.quantity, 0), 150);
  const perWarehouse = new Map();
  for (const d of out.decisions) for (const s of d.sources) perWarehouse.set(s.warehouseId, (perWarehouse.get(s.warehouseId) || 0) + s.quantity);
  assert.ok(perWarehouse.get(1) <= 100 && perWarehouse.get(2) <= 300);
});

test('allocate: scarcity favours higher urgency and explains the decision', () => {
  const w = world();
  const out = allocate({
    ...w, now: '2026-07-15T12:00:00Z',
    requests: [req(1, 1, 100, { urgencyLabel: 'Critical', urgencyWeight: 6 }), req(2, 2, 100, { urgencyLabel: 'Low', urgencyWeight: 1 })],
    stock: [{ warehouseId: 1, itemId: 1, available: 100 }],
  });
  const crit = out.decisions.find((d) => d.campId === 1);
  const low = out.decisions.find((d) => d.campId === 2);
  assert.equal(crit.allocated, 86);
  assert.equal(low.allocated, 14);
  assert.match(crit.explanation, /Critical/);
  assert.match(crit.explanation, /scarce/);
  assert.equal(out.items[0].scarce, true);
});

test('allocate: no stock gives a clear explanation and no sources', () => {
  const w = world();
  const out = allocate({ ...w, requests: [req(1, 1, 100)], stock: [], now: '2026-07-15T12:00:00Z' });
  assert.equal(out.decisions[0].allocated, 0);
  assert.deepEqual(out.decisions[0].sources, []);
  assert.match(out.decisions[0].explanation, /no Water is available/);
});

test('allocate: aging lifts a long-waiting low-priority request above a fresh equal one', () => {
  const w = world();
  const old = req(1, 1, 100, { urgencyWeight: 2, createdAt: '2026-07-13T12:00:00Z' });
  const fresh = req(2, 2, 100, { urgencyWeight: 2, createdAt: '2026-07-15T12:00:00Z' });
  const out = allocate({ ...w, requests: [old, fresh], stock: [{ warehouseId: 1, itemId: 1, available: 100 }], now: '2026-07-15T12:00:00Z' });
  assert.ok(out.decisions.find((d) => d.campId === 1).allocated > out.decisions.find((d) => d.campId === 2).allocated);
});

test('allocate: lines with nothing left to allocate are skipped', () => {
  const w = world();
  const out = allocate({ ...w, requests: [req(1, 1, 100, { prior: 100 })], stock: [{ warehouseId: 1, itemId: 1, available: 100 }], now: '2026-07-15T12:00:00Z' });
  assert.equal(out.decisions.length, 0);
});
