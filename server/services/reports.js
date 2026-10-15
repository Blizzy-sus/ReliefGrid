import { iso } from './common.js';

const rows = (stmt, ...params) => stmt.all(...params).map((r) => ({ ...r }));
const fmt = (n) => Number(n).toLocaleString('en-US');

/** Operational alerts derived from live data. Sorted most severe first. */
export function getAlerts(db, at) {
  const now = new Date(iso(at));
  const alerts = [];

  for (const r of rows(db.prepare(`SELECT * FROM v_item_supply_demand WHERE open_demand > 0 AND shortage > 0 ORDER BY coverage, open_demand DESC`))) {
    const none = r.available === 0;
    alerts.push({
      type: 'SHORTAGE',
      severity: none || r.coverage < 0.5 ? 'critical' : 'warning',
      title: none ? `${r.item_name}: out of stock` : `${r.item_name}: shortage`,
      detail: `${fmt(r.available)} ${r.unit} available for ${fmt(r.open_demand)} ${r.unit} of open demand (${Math.round(r.coverage * 100)}% coverable, ${fmt(r.shortage)} short).`,
      link: { page: 'allocation' },
      itemId: r.item_id,
    });
  }

  for (const r of rows(db.prepare(`
      SELECT r.id, r.urgency, ul.label, ul.sla_hours, r.created_at, c.name AS camp
      FROM requests r JOIN urgency_levels ul ON ul.level = r.urgency JOIN camps c ON c.id = r.camp_id
      WHERE r.status = 'PENDING' ORDER BY r.urgency DESC, r.created_at`))) {
    const hours = (now - new Date(r.created_at)) / 3_600_000;
    if (hours > r.sla_hours) {
      alerts.push({
        type: 'SLA_BREACH',
        severity: r.urgency >= 3 ? 'critical' : 'warning',
        title: `Request #${r.id} past its ${r.label} target`,
        detail: `${r.camp} has waited ${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h for a first allocation (target ${r.sla_hours}h).`,
        link: { page: 'requests', id: r.id },
      });
    }
  }

  const low = new Map();
  for (const r of rows(db.prepare(`SELECT * FROM v_inventory_available WHERE reorder_level > 0 AND quantity_available <= reorder_level AND warehouse_status = 'ACTIVE' ORDER BY item_name, warehouse_name`))) {
    if (!low.has(r.item_id)) low.set(r.item_id, []);
    low.get(r.item_id).push(r);
  }
  for (const group of low.values()) {
    const first = group[0];
    alerts.push({
      type: 'LOW_STOCK',
      severity: 'warning',
      title: group.length === 1 ? `${first.item_name} low at ${first.warehouse_name}` : `${first.item_name} below reorder level at ${group.length} warehouses`,
      detail: group.map((g) => `${g.warehouse_name}: ${fmt(g.quantity_available)} ${g.unit} (reorder at ${fmt(g.reorder_level)})`).join(' · '),
      link: { page: 'inventory' },
    });
  }

  for (const r of rows(db.prepare(`
      SELECT s.id, s.code, s.status, s.eta, s.created_at, c.name AS camp
      FROM shipments s JOIN camps c ON c.id = s.camp_id WHERE s.status IN ('PLANNED', 'IN_TRANSIT')`))) {
    if (r.status === 'IN_TRANSIT' && r.eta && now - new Date(r.eta) > 2 * 3_600_000) {
      alerts.push({
        type: 'DELAYED_SHIPMENT', severity: 'warning', title: `${r.code} is overdue`,
        detail: `Due at ${r.camp} ${Math.round((now - new Date(r.eta)) / 3_600_000)}h ago.`, link: { page: 'shipments', id: r.id },
      });
    }
    if (r.status === 'PLANNED' && now - new Date(r.created_at) > 6 * 3_600_000) {
      alerts.push({
        type: 'UNDISPATCHED', severity: 'info', title: `${r.code} awaiting dispatch`,
        detail: `Planned ${Math.round((now - new Date(r.created_at)) / 3_600_000)}h ago for ${r.camp}; stock is reserved but not moving.`,
        link: { page: 'shipments', id: r.id },
      });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function getDashboard(db, at) {
  const one = (sql, ...p) => ({ ...db.prepare(sql).get(...p) });
  const camps = one(`SELECT COUNT(*) AS total, COALESCE(SUM(population), 0) AS population, COALESCE(SUM(vulnerable_count), 0) AS vulnerable
                     FROM camps WHERE status <> 'CLOSED'`);
  const requests = one(`SELECT SUM(status IN ('PENDING','PARTIALLY_ALLOCATED')) AS open,
                               SUM(status IN ('PENDING','PARTIALLY_ALLOCATED') AND urgency = 4) AS openCritical,
                               SUM(status = 'FULFILLED') AS fulfilled, COUNT(*) AS total FROM requests`);
  const shipments = one(`SELECT SUM(status = 'PLANNED') AS planned, SUM(status = 'IN_TRANSIT') AS inTransit,
                                SUM(status = 'DELIVERED') AS delivered FROM shipments`);
  const served = one('SELECT COALESCE(SUM(people_served), 0) AS peopleServed, COUNT(*) AS events FROM distributions');
  const stock = one(`SELECT COALESCE(SUM(quantity_on_hand), 0) AS onHand, COALESCE(SUM(quantity_reserved), 0) AS reserved FROM inventory`);
  const supplyDemand = rows(db.prepare(`
    SELECT item_id AS itemId, item_name AS itemName, unit, category, available, open_demand AS openDemand, shortage, coverage
    FROM v_item_supply_demand WHERE open_demand > 0 OR available > 0 ORDER BY (open_demand > 0) DESC, coverage, open_demand DESC`));
  const urgency = rows(db.prepare(`
    SELECT ul.level, ul.label, COUNT(r.id) AS count
    FROM urgency_levels ul LEFT JOIN requests r ON r.urgency = ul.level AND r.status IN ('PENDING','PARTIALLY_ALLOCATED')
    GROUP BY ul.level ORDER BY ul.level DESC`));
  const mapCamps = rows(db.prepare('SELECT camp_id AS id, name, status, latitude, longitude, population, open_requests AS openRequests, max_open_urgency AS maxUrgency, active_shipments AS activeShipments FROM v_camp_overview'));
  const mapWarehouses = rows(db.prepare(`
    SELECT w.id, w.name, w.status, w.latitude, w.longitude,
           COALESCE((SELECT SUM(quantity_available) FROM v_inventory_available v WHERE v.warehouse_id = w.id), 0) AS available
    FROM warehouses w`));
  const routes = rows(db.prepare(`SELECT DISTINCT warehouse_id AS warehouseId, camp_id AS campId, status FROM shipments WHERE status IN ('PLANNED', 'IN_TRANSIT')`));
  const activity = rows(db.prepare(`
    SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt, u.full_name AS actor
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.action NOT IN ('LOGIN', 'LOGIN_FAILED') ORDER BY a.id DESC LIMIT 12`));
  const alerts = getAlerts(db, at);
  return {
    camps, requests, shipments, served, stock, supplyDemand, urgency, mapCamps, mapWarehouses, routes, activity,
    alerts: alerts.slice(0, 8), alertCount: alerts.length, criticalAlerts: alerts.filter((a) => a.severity === 'critical').length,
  };
}

export function getAnalytics(db) {
  const coverageByUrgency = rows(db.prepare(`
    SELECT ul.level, ul.label,
           COUNT(ri.id) AS lines,
           ROUND(AVG(1.0 * ri.quantity_allocated / ri.quantity_approved), 4) AS avgAllocatedCoverage,
           ROUND(AVG(1.0 * ri.quantity_delivered / ri.quantity_approved), 4) AS avgDeliveredCoverage
    FROM urgency_levels ul
    LEFT JOIN requests r ON r.urgency = ul.level AND r.status <> 'CANCELLED'
    LEFT JOIN request_items ri ON ri.request_id = r.id AND ri.quantity_approved > 0
    GROUP BY ul.level ORDER BY ul.level DESC`));

  const hoursToFirstDelivery = rows(db.prepare(`
    SELECT ul.level, ul.label, COUNT(*) AS requests,
           ROUND(AVG((julianday(f.first_delivery) - julianday(r.created_at)) * 24), 1) AS avgHours
    FROM requests r
    JOIN urgency_levels ul ON ul.level = r.urgency
    JOIN (SELECT ri.request_id, MIN(s.delivered_at) AS first_delivery
          FROM shipment_items si
          JOIN shipments s ON s.id = si.shipment_id AND s.status = 'DELIVERED'
          JOIN request_items ri ON ri.id = si.request_item_id
          GROUP BY ri.request_id) f ON f.request_id = r.id
    GROUP BY ul.level ORDER BY ul.level DESC`));

  const deliveriesByDay = rows(db.prepare(`
    SELECT substr(s.delivered_at, 1, 10) AS day, COUNT(DISTINCT s.id) AS shipments, COALESCE(SUM(si.quantity_received), 0) AS units
    FROM shipments s JOIN shipment_items si ON si.shipment_id = s.id
    WHERE s.status = 'DELIVERED' GROUP BY day ORDER BY day`));

  const stockByCategory = rows(db.prepare(`
    SELECT category, SUM(quantity_available) AS available, SUM(quantity_reserved) AS reserved
    FROM v_inventory_available GROUP BY category ORDER BY category`));

  const campCoverage = rows(db.prepare(`
    SELECT c.id, c.name, c.population,
           COUNT(ri.id) AS lines,
           ROUND(AVG(1.0 * ri.quantity_allocated / ri.quantity_approved), 4) AS allocatedCoverage,
           ROUND(AVG(1.0 * ri.quantity_delivered / ri.quantity_approved), 4) AS deliveredCoverage
    FROM camps c
    JOIN requests r ON r.camp_id = c.id AND r.status <> 'CANCELLED'
    JOIN request_items ri ON ri.request_id = r.id AND ri.quantity_approved > 0
    GROUP BY c.id ORDER BY allocatedCoverage`));

  const runs = rows(db.prepare(`
    SELECT id, created_at AS createdAt, requests_considered AS requests, items_scarce AS scarceItems,
           units_allocated AS units, shipments_created AS shipments FROM allocation_runs ORDER BY id`));

  const topShortages = rows(db.prepare(`
    SELECT item_name AS itemName, unit, open_demand AS openDemand, available, shortage, coverage
    FROM v_item_supply_demand WHERE shortage > 0 ORDER BY coverage LIMIT 8`));

  const losses = { ...db.prepare(`
    SELECT COALESCE(SUM(si.quantity - si.quantity_received), 0) AS units, COUNT(*) AS lines
    FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
    WHERE s.status = 'DELIVERED' AND si.quantity_received < si.quantity`).get() };

  return { coverageByUrgency, hoursToFirstDelivery, deliveriesByDay, stockByCategory, campCoverage, runs, topShortages, losses };
}

/** Run every reconciliation view; an empty list means the database is self-consistent. */
export function checkIntegrity(db) {
  const checks = [
    ['v_ledger_mismatch', 'Inventory does not match the replayed stock ledger'],
    ['v_reservation_mismatch', 'Reserved stock does not match planned shipments'],
    ['v_allocation_mismatch', 'Request allocated/delivered counters do not match shipments'],
    ['v_camp_stock_mismatch', 'Camp stock does not match deliveries minus distributions'],
  ];
  const problems = [];
  for (const [view, description] of checks) {
    const found = rows(db.prepare(`SELECT * FROM ${view}`));
    if (found.length) problems.push({ check: view, description, rows: found });
  }
  return { ok: problems.length === 0, checks: checks.map(([v, d]) => ({ check: v, description: d })), problems };
}
