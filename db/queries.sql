-- Showcase queries for ReliefGrid (SQLite dialect).  Run against the seeded demo database:
--   node --disable-warning=ExperimentalWarning scripts/run-queries.js
-- Each block starts with "-- name:" and is executed by tests/queries.test.js.

-- name: q01_shortage_by_item
-- View + aggregation: supply vs open demand per item, worst coverage first.
SELECT item_name, unit, available, open_demand, shortage, ROUND(100 * coverage) AS pct_coverable
FROM v_item_supply_demand
WHERE open_demand > 0
ORDER BY coverage, open_demand DESC;

-- name: q02_camps_ranked_by_unmet_need
-- Multi-table JOIN, GROUP BY, HAVING: camps with the largest outstanding share of approved quantities.
SELECT c.name AS camp, c.population,
       COUNT(ri.id)                                                         AS open_lines,
       ROUND(AVG(1.0 * (ri.quantity_approved - ri.quantity_allocated) / ri.quantity_approved), 3) AS avg_unmet_share
FROM camps c
JOIN requests r      ON r.camp_id = c.id AND r.status IN ('PENDING', 'PARTIALLY_ALLOCATED')
JOIN request_items ri ON ri.request_id = r.id AND ri.quantity_allocated < ri.quantity_approved
GROUP BY c.id
HAVING COUNT(ri.id) >= 2
ORDER BY avg_unmet_share DESC, open_lines DESC;

-- name: q03_requests_past_sla
-- JOIN with a lookup table and date arithmetic: pending requests older than their urgency's target.
SELECT r.id AS request_id, c.name AS camp, ul.label AS urgency, ul.sla_hours,
       ROUND((julianday('now') - julianday(r.created_at)) * 24, 1) AS hours_waiting
FROM requests r
JOIN camps c ON c.id = r.camp_id
JOIN urgency_levels ul ON ul.level = r.urgency
WHERE r.status = 'PENDING'
  AND (julianday('now') - julianday(r.created_at)) * 24 > ul.sla_hours
ORDER BY r.urgency DESC, r.created_at;

-- name: q04_network_share_per_warehouse
-- Window function: each warehouse's share of the network's available stock of every item.
SELECT item_name, warehouse_name, quantity_available,
       ROUND(100.0 * quantity_available / NULLIF(SUM(quantity_available) OVER (PARTITION BY item_id), 0), 1) AS pct_of_network
FROM v_inventory_available
WHERE quantity_available > 0
ORDER BY item_name, pct_of_network DESC;

-- name: q05_nearest_stocked_warehouse
-- CTE + ROW_NUMBER: the closest warehouse that still has water available, for every camp.
WITH ranked AS (
  SELECT c.name AS camp, w.name AS warehouse, i.quantity_on_hand - i.quantity_reserved AS available,
         ROW_NUMBER() OVER (
           PARTITION BY c.id
           ORDER BY (w.latitude - c.latitude) * (w.latitude - c.latitude) + (w.longitude - c.longitude) * (w.longitude - c.longitude)
         ) AS rn
  FROM camps c
  JOIN inventory i  ON i.item_id = (SELECT id FROM supply_items WHERE name = 'Packaged drinking water')
  JOIN warehouses w ON w.id = i.warehouse_id AND w.status = 'ACTIVE'
  WHERE c.status <> 'CLOSED' AND i.quantity_on_hand - i.quantity_reserved > 0
)
SELECT camp, warehouse, available FROM ranked WHERE rn = 1 ORDER BY camp;

-- name: q06_fairness_by_urgency_per_run
-- Did higher urgency get higher cumulative coverage when stock was short?
SELECT d.run_id, ul.label AS urgency, COUNT(*) AS lines,
       ROUND(AVG(1.0 * (d.prior_qty + d.allocated_qty) / d.approved_qty), 3) AS avg_cumulative_coverage
FROM allocation_decisions d
JOIN request_items ri ON ri.id = d.request_item_id
JOIN requests r       ON r.id = ri.request_id
JOIN urgency_levels ul ON ul.level = r.urgency
WHERE d.scarce = 1
GROUP BY d.run_id, ul.level
ORDER BY d.run_id, ul.level DESC;

-- name: q07_shipment_timeline_gaps
-- LAG window function over the trigger-written event log: hours between status changes.
SELECT s.code, e.status, e.created_at,
       ROUND((julianday(e.created_at) - julianday(LAG(e.created_at) OVER (PARTITION BY e.shipment_id ORDER BY e.id))) * 24, 1) AS hours_since_previous
FROM shipment_events e
JOIN shipments s ON s.id = e.shipment_id
ORDER BY s.id, e.id
LIMIT 60;

-- name: q08_losses_by_route
-- Aggregation over a self-consistent subset: units reported short at delivery, by warehouse and camp.
SELECT w.name AS warehouse, c.name AS camp,
       SUM(si.quantity) AS shipped, SUM(si.quantity_received) AS received,
       SUM(si.quantity - si.quantity_received) AS lost
FROM shipment_items si
JOIN shipments s  ON s.id = si.shipment_id AND s.status = 'DELIVERED'
JOIN warehouses w ON w.id = s.warehouse_id
JOIN camps c      ON c.id = s.camp_id
WHERE si.quantity_received < si.quantity
GROUP BY w.id, c.id
ORDER BY lost DESC;

-- name: q09_people_served_per_camp
-- LEFT JOIN with COALESCE so camps with no distributions still appear.
SELECT c.name AS camp, c.population,
       COALESCE(SUM(d.people_served), 0) AS person_servings,
       COUNT(d.id)                       AS distribution_events,
       COALESCE(ROUND(1.0 * SUM(d.people_served) / NULLIF(COUNT(d.id), 0)), 0) AS avg_people_per_event
FROM camps c
LEFT JOIN distributions d ON d.camp_id = c.id
WHERE c.status <> 'CLOSED'
GROUP BY c.id
ORDER BY person_servings DESC;

-- name: q10_ledger_running_balance
-- Running totals with SUM() OVER: replaying the append-only ledger reproduces the inventory row.
SELECT m.id, m.movement_type, m.delta_on_hand, m.delta_reserved,
       SUM(m.delta_on_hand)  OVER (ORDER BY m.id) AS running_on_hand,
       SUM(m.delta_reserved) OVER (ORDER BY m.id) AS running_reserved,
       m.note
FROM stock_movements m
WHERE m.warehouse_id = (SELECT MIN(id) FROM warehouses)
  AND m.item_id = (SELECT id FROM supply_items WHERE name = 'Packaged drinking water')
ORDER BY m.id;

-- name: q11_critical_camps_with_nothing_coming
-- Correlated NOT EXISTS: camps with an open Critical request and no shipment on the way.
SELECT c.name AS camp, COUNT(*) AS open_critical_requests
FROM camps c
JOIN requests r ON r.camp_id = c.id AND r.urgency = 4 AND r.status IN ('PENDING', 'PARTIALLY_ALLOCATED')
WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.camp_id = c.id AND s.status IN ('PLANNED', 'IN_TRANSIT'))
GROUP BY c.id
ORDER BY open_critical_requests DESC;

-- name: q12_top_volunteers
-- Join across four tables: units delivered by each volunteer.
SELECT u.full_name AS volunteer, COUNT(DISTINCT s.id) AS shipments, SUM(si.quantity_received) AS units_delivered
FROM users u
JOIN shipments s       ON s.volunteer_id = u.id AND s.status = 'DELIVERED'
JOIN shipment_items si ON si.shipment_id = s.id
WHERE u.role = 'volunteer'
GROUP BY u.id
ORDER BY units_delivered DESC;

-- name: q13_items_low_everywhere
-- Double NOT EXISTS (relational division flavour): items below reorder level at every warehouse that tracks one.
SELECT s.name AS item
FROM supply_items s
WHERE EXISTS (SELECT 1 FROM v_inventory_available v WHERE v.item_id = s.id AND v.reorder_level > 0)
  AND NOT EXISTS (SELECT 1 FROM v_inventory_available v WHERE v.item_id = s.id AND v.reorder_level > 0 AND v.below_reorder = 0)
ORDER BY s.name;

-- name: q14_deliveries_per_day_with_gaps
-- Recursive CTE builds a calendar so days without deliveries still show up.
WITH RECURSIVE days(d) AS (
  SELECT date(MIN(delivered_at)) FROM shipments WHERE status = 'DELIVERED'
  UNION ALL
  SELECT date(d, '+1 day') FROM days WHERE d < (SELECT date(MAX(delivered_at)) FROM shipments WHERE status = 'DELIVERED')
)
SELECT d AS day, COUNT(s.id) AS shipments_delivered
FROM days LEFT JOIN shipments s ON date(s.delivered_at) = d AND s.status = 'DELIVERED'
GROUP BY d
ORDER BY d;

-- name: q15_integrity_report
-- UNION ALL of the reconciliation views: an empty result means the database is self-consistent.
SELECT 'ledger'      AS check_name, COUNT(*) AS problems FROM v_ledger_mismatch
UNION ALL SELECT 'reservations', COUNT(*) FROM v_reservation_mismatch
UNION ALL SELECT 'allocations',  COUNT(*) FROM v_allocation_mismatch
UNION ALL SELECT 'camp_stock',   COUNT(*) FROM v_camp_stock_mismatch;

-- name: q16_priority_score_in_sql
-- The engine's priority score reproduced in pure SQL from the settings table (aging measured to "now").
SELECT od.request_id, c.name AS camp, i.name AS item, ul.label AS urgency,
       ROUND(ul.weight
             * (1 + (SELECT value FROM allocation_settings WHERE key = 'vulnerability_weight') * 1.0 * c.vulnerable_count / NULLIF(c.population, 0))
             * (1 + (SELECT value FROM allocation_settings WHERE key = 'aging_max_bonus')
                    * MIN(1.0, (julianday('now') - julianday(od.created_at)) * 24 / (SELECT value FROM allocation_settings WHERE key = 'aging_window_hours'))), 2) AS priority_score
FROM v_open_demand od
JOIN camps c           ON c.id = od.camp_id
JOIN supply_items i    ON i.id = od.item_id
JOIN urgency_levels ul ON ul.level = od.urgency
ORDER BY priority_score DESC
LIMIT 15;

-- name: q17_request_pipeline_funnel
-- Conditional aggregation: where each request line is in the pipeline, per urgency.
SELECT ul.label AS urgency,
       COUNT(*)                                                         AS lines,
       SUM(ri.quantity_allocated = 0)                                   AS not_yet_allocated,
       SUM(ri.quantity_allocated > 0 AND ri.quantity_delivered = 0)     AS allocated_not_delivered,
       SUM(ri.quantity_delivered >= ri.quantity_approved)               AS fully_delivered
FROM request_items ri
JOIN requests r        ON r.id = ri.request_id AND r.status <> 'CANCELLED'
JOIN urgency_levels ul ON ul.level = r.urgency
GROUP BY ul.level
ORDER BY ul.level DESC;
