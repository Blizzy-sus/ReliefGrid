import { HttpError, tx } from '../db.js';
import { allocate } from '../allocation/engine.js';
import { audit, getSettings, int, iso, recordMovement } from './common.js';
import { refreshRequestStatus } from './requests.js';

/** Read everything the engine needs. Must run inside the same transaction as the writes. */
export function loadInputs(db, { disasterId = null } = {}) {
  const requests = db.prepare(`
    SELECT od.request_item_id AS requestItemId, od.request_id AS requestId, od.camp_id AS campId,
           od.item_id AS itemId, od.quantity_approved AS approved, od.quantity_allocated AS prior,
           ul.label AS urgencyLabel, ul.weight AS urgencyWeight,
           c.population, c.vulnerable_count AS vulnerableCount, od.created_at AS createdAt
    FROM v_open_demand od
    JOIN urgency_levels ul ON ul.level = od.urgency
    JOIN camps c ON c.id = od.camp_id
    WHERE (? IS NULL OR c.disaster_id = ?)
    ORDER BY od.request_item_id`).all(disasterId, disasterId).map((r) => ({ ...r }));

  const stock = db.prepare(`
    SELECT i.warehouse_id AS warehouseId, i.item_id AS itemId, i.quantity_on_hand - i.quantity_reserved AS available
    FROM inventory i JOIN warehouses w ON w.id = i.warehouse_id
    WHERE w.status = 'ACTIVE' AND i.quantity_on_hand - i.quantity_reserved > 0`).all().map((r) => ({ ...r }));

  const camps = new Map(db.prepare('SELECT id, name, latitude, longitude FROM camps').all().map((c) => [c.id, { ...c }]));
  const warehouses = new Map(db.prepare('SELECT id, name, latitude, longitude FROM warehouses').all().map((w) => [w.id, { ...w }]));
  const items = new Map(db.prepare('SELECT id, name, unit FROM supply_items').all().map((i) => [i.id, { ...i }]));
  const settings = getSettings(db);
  const urgencyLevels = db.prepare('SELECT level, label, weight, sla_hours FROM urgency_levels ORDER BY level').all().map((u) => ({ ...u }));
  return { requests, stock, camps, warehouses, items, settings, urgencyLevels };
}

function decorate(result, inputs) {
  const decisions = result.decisions.map((d) => ({
    ...d,
    campName: inputs.camps.get(d.campId).name,
    itemName: inputs.items.get(d.itemId).name,
    unit: inputs.items.get(d.itemId).unit,
    sources: d.sources.map((s) => ({ ...s, warehouseName: inputs.warehouses.get(s.warehouseId).name })),
  }));
  const shipmentKeys = new Set();
  for (const d of decisions) for (const s of d.sources) shipmentKeys.add(`${s.warehouseId}:${d.campId}`);
  return {
    items: result.items,
    decisions,
    totals: {
      requestLines: decisions.length,
      scarceItems: result.items.filter((i) => i.scarce).length,
      unitsAllocated: result.items.reduce((s, i) => s + i.allocated, 0),
      shipments: shipmentKeys.size,
    },
  };
}

/** Compute a plan without changing anything. */
export function previewAllocation(db, { disasterId = null } = {}, at) {
  const inputs = loadInputs(db, { disasterId });
  const result = allocate({ ...inputs, now: new Date(iso(at)) });
  return { ...decorate(result, inputs), settings: inputs.settings, urgencyLevels: inputs.urgencyLevels, generatedAt: iso(at) };
}

/**
 * Compute and commit an allocation run in one transaction.  Stock is re-read inside the
 * transaction (BEGIN IMMEDIATE), so two concurrent runs can never reserve the same units;
 * the conditional UPDATE and the table CHECK constraints are two further lines of defence.
 */
export function commitAllocation(db, user, { disasterId = null, note = null } = {}, at) {
  if (disasterId != null) int(disasterId, 'disasterId', { min: 1 });
  return tx(db, () => {
    const now = iso(at);
    const inputs = loadInputs(db, { disasterId });
    if (inputs.requests.length === 0) throw new HttpError(409, 'NOTHING_TO_ALLOCATE', 'There are no open requests to allocate.');
    const result = allocate({ ...inputs, now: new Date(now) });
    const plan = decorate(result, inputs);

    const params = { settings: inputs.settings, urgencyLevels: inputs.urgencyLevels };
    const run = db.prepare(`INSERT INTO allocation_runs
      (run_by, disaster_id, params_json, created_at, requests_considered, items_scarce, units_allocated, shipments_created, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, disasterId, JSON.stringify(params), now, plan.totals.requestLines, plan.totals.scarceItems,
        plan.totals.unitsAllocated, plan.totals.shipments, note);
    const runId = Number(run.lastInsertRowid);

    const insShipment = db.prepare(`INSERT INTO shipments
      (code, run_id, warehouse_id, camp_id, status, distance_km, created_at, status_changed_at, last_actor_id, last_note)
      VALUES ('SHP-' || printf('%05d', (SELECT COALESCE(MAX(id), 0) + 1 FROM shipments)), ?, ?, ?, 'PLANNED', ?, ?, ?, ?, ?)`);
    const insDecision = db.prepare(`INSERT INTO allocation_decisions
      (run_id, request_item_id, camp_id, item_id, approved_qty, prior_qty, need_qty, item_supply, item_demand, urgency_weight,
       vulnerability_factor, aging_factor, priority_score, allocated_qty, scarce, explanation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insLine = db.prepare(`INSERT INTO allocation_lines (decision_id, shipment_id, warehouse_id, quantity, distance_km)
      VALUES (?, ?, ?, ?, ?)`);
    const insShipItem = db.prepare(`INSERT INTO shipment_items (shipment_id, request_item_id, item_id, quantity) VALUES (?, ?, ?, ?)`);
    const reserve = db.prepare(`UPDATE inventory SET quantity_reserved = quantity_reserved + ?, updated_at = ?
      WHERE warehouse_id = ? AND item_id = ? AND quantity_on_hand - quantity_reserved >= ?`);
    const bumpAllocated = db.prepare('UPDATE request_items SET quantity_allocated = quantity_allocated + ? WHERE id = ?');

    const shipments = new Map();
    const touchedRequests = new Set();
    const created = [];
    for (const d of plan.decisions) {
      const dec = insDecision.run(runId, d.requestItemId, d.campId, d.itemId, d.approved, d.prior, d.need, d.itemSupply, d.itemDemand,
        d.urgencyWeight, d.vulnerabilityFactor, d.agingFactor, d.score, d.allocated, d.scarce ? 1 : 0, d.explanation);
      const decisionId = Number(dec.lastInsertRowid);
      for (const s of d.sources) {
        const key = `${s.warehouseId}:${d.campId}`;
        if (!shipments.has(key)) {
          const sh = insShipment.run(runId, s.warehouseId, d.campId, s.distanceKm, now, now, user.id, `Planned by allocation run #${runId}`);
          const shipmentId = Number(sh.lastInsertRowid);
          shipments.set(key, shipmentId);
          created.push(shipmentId);
        }
        const shipmentId = shipments.get(key);
        insLine.run(decisionId, shipmentId, s.warehouseId, s.quantity, s.distanceKm);
        insShipItem.run(shipmentId, d.requestItemId, d.itemId, s.quantity);
        const r = reserve.run(s.quantity, now, s.warehouseId, d.itemId, s.quantity);
        if (r.changes !== 1) {
          throw new HttpError(409, 'INSUFFICIENT_STOCK', `Stock changed while allocating: ${d.itemName} at ${s.warehouseName}.`);
        }
        recordMovement(db, {
          warehouseId: s.warehouseId, itemId: d.itemId, type: 'RESERVE', deltaReserved: s.quantity,
          refType: 'allocation_run', refId: runId, userId: user.id, note: `Reserved for ${d.campName}`,
        }, at);
        bumpAllocated.run(s.quantity, d.requestItemId);
      }
      touchedRequests.add(d.requestId);
    }
    for (const id of touchedRequests) refreshRequestStatus(db, id, at);
    audit(db, user.id, 'ALLOCATION_RUN', 'allocation_run', runId, {
      requests: plan.totals.requestLines, scarceItems: plan.totals.scarceItems, units: plan.totals.unitsAllocated, shipments: created.length,
    }, at);
    return { runId, shipmentIds: created, ...plan };
  });
}

export function listRuns(db, limit = 50) {
  return db.prepare(`
    SELECT r.id, r.created_at AS createdAt, r.requests_considered AS requestsConsidered, r.items_scarce AS itemsScarce,
           r.units_allocated AS unitsAllocated, r.shipments_created AS shipmentsCreated, r.note,
           u.full_name AS runBy
    FROM allocation_runs r JOIN users u ON u.id = r.run_by
    ORDER BY r.id DESC LIMIT ?`).all(limit).map((x) => ({ ...x }));
}

export function getRun(db, id) {
  const run = db.prepare(`
    SELECT r.id, r.created_at AS createdAt, r.requests_considered AS requestsConsidered, r.items_scarce AS itemsScarce,
           r.units_allocated AS unitsAllocated, r.shipments_created AS shipmentsCreated, r.note, r.params_json AS params,
           u.full_name AS runBy
    FROM allocation_runs r JOIN users u ON u.id = r.run_by WHERE r.id = ?`).get(id);
  if (!run) return null;
  const decisions = db.prepare(`
    SELECT d.id, d.request_item_id AS requestItemId, ri.request_id AS requestId, d.camp_id AS campId, c.name AS campName,
           d.item_id AS itemId, s.name AS itemName, s.unit, d.approved_qty AS approved, d.prior_qty AS prior, d.need_qty AS need,
           d.item_supply AS itemSupply, d.item_demand AS itemDemand, d.urgency_weight AS urgencyWeight,
           d.vulnerability_factor AS vulnerabilityFactor, d.aging_factor AS agingFactor, d.priority_score AS score,
           d.allocated_qty AS allocated, d.scarce, d.explanation,
           ROUND(1.0 * d.allocated_qty / d.need_qty, 4) AS coverage,
           ROUND(1.0 * (d.prior_qty + d.allocated_qty) / d.approved_qty, 4) AS cumulativeCoverage
    FROM allocation_decisions d
    JOIN request_items ri ON ri.id = d.request_item_id
    JOIN camps c ON c.id = d.camp_id
    JOIN supply_items s ON s.id = d.item_id
    WHERE d.run_id = ? ORDER BY d.item_id, d.priority_score DESC`).all(id).map((x) => ({ ...x }));
  const lines = db.prepare(`
    SELECT l.decision_id AS decisionId, l.warehouse_id AS warehouseId, w.name AS warehouseName, l.quantity,
           l.distance_km AS distanceKm, sh.code AS shipmentCode, sh.id AS shipmentId
    FROM allocation_lines l
    JOIN allocation_decisions d ON d.id = l.decision_id
    JOIN warehouses w ON w.id = l.warehouse_id
    JOIN shipments sh ON sh.id = l.shipment_id
    WHERE d.run_id = ?`).all(id).map((x) => ({ ...x }));
  for (const d of decisions) d.sources = lines.filter((l) => l.decisionId === d.id);
  const shipments = db.prepare(`
    SELECT s.id, s.code, s.status, w.name AS warehouseName, c.name AS campName, s.distance_km AS distanceKm
    FROM shipments s JOIN warehouses w ON w.id = s.warehouse_id JOIN camps c ON c.id = s.camp_id
    WHERE s.run_id = ? ORDER BY s.id`).all(id).map((x) => ({ ...x }));
  return { ...run, params: JSON.parse(run.params), decisions, shipments };
}
