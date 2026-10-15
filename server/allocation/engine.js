/**
 * ReliefGrid allocation engine - pure functions, no database access.
 *
 * Method: priority-weighted max-min fairness on cumulative coverage
 * -----------------------------------------------------------------
 * Every open request line gets a priority score
 *
 *     score = urgency_weight x vulnerability_factor x aging_factor
 *
 * and a "coverage" = (units already allocated + units allocated now) / approved units.
 * Each supply item is rationed independently (stock of rice says nothing about tarpaulins).
 * For one item with available stock S and lines i = 1..n (approved A_i, already allocated P_i,
 * remaining need d_i = A_i - P_i):
 *
 *   1. If S >= sum(d_i) nobody is short: everyone receives their remaining need.
 *   2. Otherwise find the single number lambda ("fair level") such that giving each line
 *
 *          x_i = clamp(A_i * lambda * score_i - P_i, 0, d_i)
 *
 *      uses exactly S units.  In words: every line is brought up to a cumulative coverage of
 *      min(100%, lambda x score_i).  Coverage is therefore proportional to priority, capped at
 *      100%, and lines that already hold more than their fair level (because an earlier run
 *      served them) receive nothing until the others catch up.  Because x_i is a monotone
 *      piecewise-linear function of lambda, lambda is solved exactly by walking the breakpoints.
 *   3. Fractional units are resolved with the largest-remainder method, so the integer
 *      allocation sums exactly to S and nobody receives more than they need.
 *
 * With nothing allocated before (P_i = 0) this is "coverage proportional to priority".
 *
 * Properties (covered by tests): never allocates more than is available or needed, uses all
 * stock when scarce, is deterministic, gives higher-priority lines at least the coverage of
 * lower-priority lines, and never starves a line that is below the fair level.
 *
 * Source warehouses are assigned afterwards: lines are served in priority order, each from the
 * nearest warehouses that still have stock.
 */
import { roadDistanceKm } from './geo.js';

export const DEFAULT_SETTINGS = Object.freeze({
  vulnerability_weight: 1.0,
  aging_window_hours: 48,
  aging_max_bonus: 0.5,
  road_detour_factor: 1.35,
});

const EPS = 1e-6;
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n) => Number(n).toLocaleString('en-US');
const byIdThenNumeric = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/** Priority score and its three explainable components. */
export function priorityScore({ urgencyWeight, population, vulnerableCount, createdAt, now }, settings = DEFAULT_SETTINGS) {
  const share = population > 0 ? Math.min(1, vulnerableCount / population) : 0;
  const vulnerabilityFactor = 1 + settings.vulnerability_weight * share;
  const hoursWaiting = Math.max(0, (new Date(now).getTime() - new Date(createdAt).getTime()) / 3_600_000);
  const agingFactor = 1 + settings.aging_max_bonus * Math.min(1, hoursWaiting / settings.aging_window_hours);
  return {
    score: urgencyWeight * vulnerabilityFactor * agingFactor,
    vulnerabilityFactor,
    agingFactor,
    hoursWaiting,
    vulnerableShare: share,
  };
}

/**
 * Ration `supply` units among entries [{ id, approved, prior, score }].
 * Returns { shares: Map(id -> integer units), level, scarce } where `level` is lambda
 * (null when nobody is short).  Pure and deterministic.
 */
export function fairShare(entries, supply) {
  const shares = new Map(entries.map((e) => [e.id, 0]));
  const live = entries.filter((e) => e.approved - e.prior > 0).map((e) => ({ ...e, need: e.approved - e.prior }));
  const totalNeed = live.reduce((s, e) => s + e.need, 0);
  if (totalNeed <= 0) return { shares, level: null, scarce: false };
  if (supply <= 0) return { shares, level: 0, scarce: true };
  if (supply >= totalNeed) {
    for (const e of live) shares.set(e.id, e.need);
    return { shares, level: null, scarce: false };
  }

  const give = (e, lambda) => Math.min(e.need, Math.max(0, e.approved * lambda * e.score - e.prior));
  const total = (lambda) => live.reduce((s, e) => s + give(e, lambda), 0);

  // total(lambda) is piecewise linear with breakpoints where a line starts receiving or is capped.
  const breakpoints = [...new Set(live.flatMap((e) => [e.prior / (e.approved * e.score), 1 / e.score]))].sort((a, b) => a - b);
  let prevL = 0;
  let prevT = 0;
  let level = breakpoints[breakpoints.length - 1];
  for (const b of breakpoints) {
    if (b <= prevL) continue;
    const t = total(b);
    if (t >= supply) {
      level = prevL + ((supply - prevT) * (b - prevL)) / (t - prevT);
      break;
    }
    prevL = b;
    prevT = t;
  }

  // Largest-remainder rounding.
  let used = 0;
  const parts = live.map((e) => {
    const x = give(e, level);
    const base = Math.min(e.need, Math.floor(x + EPS));
    used += base;
    return { e, base, frac: x - base };
  });
  let leftover = supply - used;
  for (const p of [...parts].sort((a, b) => a.frac - b.frac)) { // numerical guard: never exceed supply
    if (leftover >= 0) break;
    if (p.base > 0) { p.base -= 1; leftover += 1; }
  }
  const ranked = (list) => list.sort((a, b) => b.frac - a.frac || b.e.score - a.e.score || byIdThenNumeric(a.e.id, b.e.id));
  for (const p of ranked(parts.filter((q) => q.base < q.e.need && q.frac > EPS))) {
    if (leftover <= 0) break;
    p.base += 1;
    leftover -= 1;
  }
  for (const p of ranked(parts.filter((q) => q.base < q.e.need))) { // fallback; practically unreachable
    if (leftover <= 0) break;
    p.base += 1;
    leftover -= 1;
  }
  for (const p of parts) shares.set(p.e.id, p.base);
  return { shares, level, scarce: true };
}

/**
 * Allocate stock to request lines.
 *
 * requests: [{ requestItemId, requestId, campId, itemId, approved, prior, urgencyLabel, urgencyWeight,
 *              population, vulnerableCount, createdAt }]      (remaining need = approved - prior)
 * stock:    [{ warehouseId, itemId, available }]
 * camps:    Map campId -> { name, latitude, longitude }
 * warehouses: Map warehouseId -> { name, latitude, longitude }
 * items:    Map itemId -> { name, unit }
 */
export function allocate({ requests, stock, camps, warehouses, items, settings = DEFAULT_SETTINGS, now = new Date() }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const byItem = new Map();
  for (const r of requests) {
    if (r.approved - r.prior <= 0) continue;
    if (!byItem.has(r.itemId)) byItem.set(r.itemId, []);
    byItem.get(r.itemId).push(r);
  }

  const stockByItem = new Map();
  for (const s of stock) {
    if (s.available <= 0) continue;
    if (!stockByItem.has(s.itemId)) stockByItem.set(s.itemId, []);
    stockByItem.get(s.itemId).push({ ...s });
  }

  const decisions = [];
  const itemSummaries = [];

  for (const [itemId, lines] of [...byItem.entries()].sort((a, b) => a[0] - b[0])) {
    const item = items.get(itemId) || { name: `item ${itemId}`, unit: 'units' };
    const pools = stockByItem.get(itemId) || [];
    const supply = pools.reduce((s, p) => s + p.available, 0);
    const demand = lines.reduce((s, l) => s + (l.approved - l.prior), 0);

    const scored = lines.map((l) => ({ line: l, ...priorityScore({ ...l, now }, cfg) }));
    const { shares, level, scarce } = fairShare(
      scored.map((s) => ({ id: s.line.requestItemId, approved: s.line.approved, prior: s.line.prior, score: s.score })), supply);

    // Serve in priority order, nearest warehouse first.
    const ordered = [...scored].sort((a, b) => b.score - a.score || a.line.requestItemId - b.line.requestItemId);
    const decisionByLine = new Map();
    for (const s of ordered) {
      const l = s.line;
      const need = l.approved - l.prior;
      const allocated = shares.get(l.requestItemId) || 0;
      const camp = camps.get(l.campId);
      const sources = [];
      let toTake = allocated;
      const ranked = pools
        .map((p) => ({ p, km: roadDistanceKm(warehouses.get(p.warehouseId), camp, cfg.road_detour_factor) }))
        .sort((a, b) => a.km - b.km || a.p.warehouseId - b.p.warehouseId);
      for (const { p, km } of ranked) {
        if (toTake <= 0) break;
        const take = Math.min(toTake, p.available);
        if (take <= 0) continue;
        p.available -= take;
        toTake -= take;
        sources.push({ warehouseId: p.warehouseId, quantity: take, distanceKm: km });
      }
      if (toTake > 0) throw new Error(`Allocation invariant violated for item ${itemId}: sources exhausted`);

      const targetCoverage = scarce ? Math.min(1, (level ?? 0) * s.score) : 1;
      decisionByLine.set(l.requestItemId, {
        requestItemId: l.requestItemId,
        requestId: l.requestId,
        campId: l.campId,
        itemId,
        approved: l.approved,
        prior: l.prior,
        need,
        itemSupply: supply,
        itemDemand: demand,
        urgencyLabel: l.urgencyLabel,
        urgencyWeight: l.urgencyWeight,
        vulnerabilityFactor: round(s.vulnerabilityFactor),
        agingFactor: round(s.agingFactor),
        hoursWaiting: round(s.hoursWaiting, 1),
        vulnerableShare: s.vulnerableShare,
        score: round(s.score),
        allocated,
        coverage: round(allocated / need),
        cumulativeCoverage: round((l.prior + allocated) / l.approved),
        targetCoverage: round(targetCoverage),
        scarce,
        sources,
        explanation: explain({ item, l, s, supply, demand, allocated, need, scarce, targetCoverage }),
      });
    }
    for (const l of lines) decisions.push(decisionByLine.get(l.requestItemId));

    itemSummaries.push({
      itemId,
      itemName: item.name,
      unit: item.unit,
      supply,
      demand,
      scarce,
      fairLevel: level == null ? null : round(level),
      allocated: [...shares.values()].reduce((a, b) => a + b, 0),
      lines: lines.length,
    });
  }

  return { decisions, items: itemSummaries };
}

function explain({ item, l, s, supply, demand, allocated, need, scarce, targetCoverage }) {
  const unit = item.unit;
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (supply === 0) {
    return `${l.urgencyLabel} request, but no ${item.name} is available in any active warehouse (open demand: ${fmt(demand)} ${unit}). Nothing could be allocated; it stays queued for the next run.`;
  }
  if (!scarce) {
    return `${item.name} is sufficiently stocked (${fmt(supply)} ${unit} available for ${fmt(demand)} ${unit} of open demand), so the remaining need of ${fmt(allocated)} ${unit} is allocated in full.`;
  }
  const head = `Priority ${round(s.score, 2)} = urgency ${round(l.urgencyWeight, 2)} (${l.urgencyLabel}) `
    + `× vulnerability ${round(s.vulnerabilityFactor, 2)} (${pct(s.vulnerableShare)} at-risk) `
    + `× waiting ${round(s.agingFactor, 2)} (${round(s.hoursWaiting, 0)}h). `;
  const stockLine = `${item.name} is scarce: ${fmt(supply)} ${unit} available for ${fmt(demand)} ${unit} of open demand (${pct(supply / demand)}). `
    + `Every line is brought up to a coverage proportional to its priority (capped at 100%); this line's fair coverage is ${pct(targetCoverage)}. `;
  const heldBefore = l.prior > 0 ? `It already holds ${fmt(l.prior)} of ${fmt(l.approved)} ${unit} (${pct(l.prior / l.approved)}). ` : '';
  if (allocated === 0 && l.prior > 0 && l.prior / l.approved >= targetCoverage) {
    return head + stockLine + heldBefore + 'That is at or above its fair level, so it waits while other requests catch up.';
  }
  if (allocated >= need) {
    return head + stockLine + heldBefore + `Its priority is high enough to be served in full: ${fmt(allocated)} ${unit}.`;
  }
  return head + stockLine + heldBefore + `It receives ${fmt(allocated)} of ${fmt(need)} ${unit} (cumulative coverage ${pct((l.prior + allocated) / l.approved)}); the remaining ${fmt(need - allocated)} ${unit} stays queued.`;
}
