-- Reporting and reconciliation views.

CREATE VIEW v_inventory_available AS
SELECT i.warehouse_id,
       w.name  AS warehouse_name,
       w.status AS warehouse_status,
       i.item_id,
       s.name  AS item_name,
       s.unit,
       c.name  AS category,
       i.quantity_on_hand,
       i.quantity_reserved,
       i.quantity_on_hand - i.quantity_reserved AS quantity_available,
       i.reorder_level,
       CASE WHEN i.reorder_level > 0 AND i.quantity_on_hand - i.quantity_reserved <= i.reorder_level THEN 1 ELSE 0 END AS below_reorder,
       i.updated_at
FROM inventory i
JOIN warehouses        w ON w.id = i.warehouse_id
JOIN supply_items      s ON s.id = i.item_id
JOIN supply_categories c ON c.id = s.category_id;

-- Request lines that still need stock (the allocator's work queue).
CREATE VIEW v_open_demand AS
SELECT ri.id                                      AS request_item_id,
       ri.request_id,
       r.camp_id,
       ri.item_id,
       r.urgency,
       r.created_at,
       ri.quantity_approved,
       ri.quantity_allocated,
       ri.quantity_approved - ri.quantity_allocated AS open_qty
FROM request_items ri
JOIN requests  r ON r.id = ri.request_id
JOIN camps     c ON c.id = r.camp_id
JOIN disasters d ON d.id = c.disaster_id
WHERE r.status IN ('PENDING','PARTIALLY_ALLOCATED')
  AND ri.quantity_allocated < ri.quantity_approved
  AND c.status <> 'CLOSED'
  AND d.status <> 'CLOSED';

-- Network-wide supply versus open demand per item: the basis of shortage alerts.
CREATE VIEW v_item_supply_demand AS
SELECT s.id        AS item_id,
       s.name      AS item_name,
       s.unit,
       cat.name    AS category,
       COALESCE(sup.available, 0)     AS available,
       COALESCE(dem.open_qty, 0)      AS open_demand,
       COALESCE(dem.open_requests, 0) AS open_lines,
       MAX(0, COALESCE(dem.open_qty, 0) - COALESCE(sup.available, 0)) AS shortage,
       CASE WHEN COALESCE(dem.open_qty, 0) > 0
            THEN ROUND(1.0 * MIN(COALESCE(sup.available, 0), dem.open_qty) / dem.open_qty, 4)
            ELSE 1.0 END AS coverage
FROM supply_items s
JOIN supply_categories cat ON cat.id = s.category_id
LEFT JOIN (
  SELECT i.item_id, SUM(i.quantity_on_hand - i.quantity_reserved) AS available
  FROM inventory i JOIN warehouses w ON w.id = i.warehouse_id
  WHERE w.status = 'ACTIVE'
  GROUP BY i.item_id
) sup ON sup.item_id = s.id
LEFT JOIN (
  SELECT item_id, SUM(open_qty) AS open_qty, COUNT(*) AS open_requests
  FROM v_open_demand GROUP BY item_id
) dem ON dem.item_id = s.id
WHERE s.active = 1;

CREATE VIEW v_camp_overview AS
SELECT c.id AS camp_id,
       c.name, c.district, c.status, c.latitude, c.longitude,
       c.population, c.vulnerable_count, c.capacity, c.disaster_id,
       (SELECT COUNT(*) FROM requests r
         WHERE r.camp_id = c.id AND r.status IN ('PENDING','PARTIALLY_ALLOCATED')) AS open_requests,
       (SELECT COALESCE(MAX(r.urgency), 0) FROM requests r
         WHERE r.camp_id = c.id AND r.status IN ('PENDING','PARTIALLY_ALLOCATED')) AS max_open_urgency,
       (SELECT COUNT(*) FROM shipments s
         WHERE s.camp_id = c.id AND s.status IN ('PLANNED','IN_TRANSIT')) AS active_shipments,
       (SELECT COALESCE(SUM(d.people_served), 0) FROM distributions d WHERE d.camp_id = c.id) AS people_served_total
FROM camps c;

CREATE VIEW v_request_progress AS
SELECT r.id AS request_id, r.camp_id, r.status, r.urgency, r.created_at,
       COUNT(ri.id)                                                          AS lines_total,
       SUM(CASE WHEN ri.quantity_allocated >= ri.quantity_approved THEN 1 ELSE 0 END) AS lines_allocated,
       SUM(CASE WHEN ri.quantity_delivered >= ri.quantity_approved THEN 1 ELSE 0 END) AS lines_delivered
FROM requests r
JOIN request_items ri ON ri.request_id = r.id
GROUP BY r.id;

----------------------------------------------------------------------
-- Reconciliation views: each should return zero rows when the data is consistent.
----------------------------------------------------------------------
-- inventory must equal the replayed ledger
CREATE VIEW v_ledger_mismatch AS
SELECT i.warehouse_id, i.item_id,
       i.quantity_on_hand, i.quantity_reserved,
       COALESCE(SUM(m.delta_on_hand), 0)  AS ledger_on_hand,
       COALESCE(SUM(m.delta_reserved), 0) AS ledger_reserved
FROM inventory i
LEFT JOIN stock_movements m ON m.warehouse_id = i.warehouse_id AND m.item_id = i.item_id
GROUP BY i.warehouse_id, i.item_id
HAVING i.quantity_on_hand  <> COALESCE(SUM(m.delta_on_hand), 0)
    OR i.quantity_reserved <> COALESCE(SUM(m.delta_reserved), 0);

-- reserved stock must equal the quantity on PLANNED shipments
CREATE VIEW v_reservation_mismatch AS
SELECT i.warehouse_id, i.item_id, i.quantity_reserved,
       COALESCE((SELECT SUM(si.quantity)
                 FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
                 WHERE sh.warehouse_id = i.warehouse_id AND si.item_id = i.item_id AND sh.status = 'PLANNED'), 0) AS planned_qty
FROM inventory i
WHERE i.quantity_reserved <> planned_qty;

-- allocated/delivered counters on request lines must equal what the shipments say
CREATE VIEW v_allocation_mismatch AS
SELECT ri.id AS request_item_id, ri.quantity_allocated, ri.quantity_delivered,
       COALESCE((SELECT SUM(CASE sh.status WHEN 'DELIVERED' THEN si.quantity_received ELSE si.quantity END)
                 FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
                 WHERE si.request_item_id = ri.id AND sh.status <> 'CANCELLED'), 0) AS shipment_qty,
       COALESCE((SELECT SUM(si.quantity_received)
                 FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
                 WHERE si.request_item_id = ri.id AND sh.status = 'DELIVERED'), 0) AS received_qty
FROM request_items ri
WHERE ri.quantity_allocated <> shipment_qty OR ri.quantity_delivered <> received_qty;

-- camp stock must equal deliveries minus distributions
CREATE VIEW v_camp_stock_mismatch AS
SELECT cs.camp_id, cs.item_id, cs.quantity,
       COALESCE((SELECT SUM(si.quantity_received)
                 FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
                 WHERE sh.camp_id = cs.camp_id AND si.item_id = cs.item_id AND sh.status = 'DELIVERED'), 0)
     - COALESCE((SELECT SUM(d.quantity) FROM distributions d
                 WHERE d.camp_id = cs.camp_id AND d.item_id = cs.item_id), 0) AS expected
FROM camp_stock cs
WHERE cs.quantity <> expected;
