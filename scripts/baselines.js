// Simple rationing rules used only to put ReliefGrid's method in context (see docs/RESULTS.md).
// Each takes entries [{ id, need, score, createdAt }] and an integer supply and returns Map(id -> units).

function largestRemainder(entries, exact, supply) {
  const out = new Map(entries.map((e) => [e.id, Math.min(e.need, Math.floor(exact.get(e.id) + 1e-9))]));
  let left = supply - [...out.values()].reduce((a, b) => a + b, 0);
  const order = entries.slice().sort((a, b) => (exact.get(b.id) - Math.floor(exact.get(b.id))) - (exact.get(a.id) - Math.floor(exact.get(a.id))));
  for (const e of order) { if (left <= 0) break; if (out.get(e.id) < e.need) { out.set(e.id, out.get(e.id) + 1); left -= 1; } }
  return out;
}

/** First come, first served. */
export function fifo(entries, supply) {
  const out = new Map(entries.map((e) => [e.id, 0]));
  let left = supply;
  for (const e of entries.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    const x = Math.min(e.need, left);
    out.set(e.id, x); left -= x;
  }
  return out;
}

/** Everybody gets the same fraction of their need, ignoring urgency. */
export function proportionalToNeed(entries, supply) {
  const total = entries.reduce((s, e) => s + e.need, 0);
  if (supply >= total) return new Map(entries.map((e) => [e.id, e.need]));
  return largestRemainder(entries, new Map(entries.map((e) => [e.id, (e.need * supply) / total])), supply);
}

/** Highest priority score is served completely before anyone else gets anything. */
export function strictPriority(entries, supply) {
  const out = new Map(entries.map((e) => [e.id, 0]));
  let left = supply;
  for (const e of entries.slice().sort((a, b) => b.score - a.score)) {
    const x = Math.min(e.need, left);
    out.set(e.id, x); left -= x;
  }
  return out;
}

/** Priority-proportional but blind to what earlier rounds already delivered (the flaw ReliefGrid fixes). */
export function priorityOfRemaining(entries, supply, fairShare) {
  return fairShare(entries.map((e) => ({ id: e.id, approved: e.need, prior: 0, score: e.score })), supply).shares;
}

// ---- metrics --------------------------------------------------------------
export const jain = (xs) => {
  const s = xs.reduce((a, b) => a + b, 0);
  const q = xs.reduce((a, b) => a + b * b, 0);
  return q === 0 ? 1 : (s * s) / (xs.length * q);
};
