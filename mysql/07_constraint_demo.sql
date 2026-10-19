-- ReliefGrid: demonstrate the database rejecting invalid operations (run each statement ONE AT A TIME).
-- In Workbench select a statement and press Ctrl+Enter. Every statement below is expected to FAIL with the message
-- shown in its comment; none of them changes data. (If you run the whole file at once Workbench stops at the first error.)
USE reliefgrid;

-- 1. Reserve more stock than is on hand -> CHECK constraint ck_inv_reserved_le_on_hand
UPDATE inventory SET quantity_reserved = quantity_on_hand + 1 WHERE warehouse_id = 1 AND item_id = 1;

-- 2. Skip a step in the shipment life-cycle -> trigger: "invalid shipment status transition"
UPDATE shipments SET status = 'DELIVERED'
WHERE id = (SELECT id FROM (SELECT MIN(id) AS id FROM shipments WHERE status = 'PLANNED') AS t);

-- 3. Edit the append-only stock ledger -> trigger: "stock_movements is append-only"
UPDATE stock_movements SET delta_on_hand = 999 WHERE id = 1;

-- 4. Delete from the audit trail -> trigger: "audit_log is append-only"
DELETE FROM audit_log WHERE id = 1;

-- 5. Rewrite allocation history -> trigger: "allocation history is immutable"
UPDATE allocation_decisions SET allocated_qty = 0 WHERE id = 1;

-- 6. Hand out more than the camp holds -> trigger: "distribution exceeds stock held at the camp"
INSERT INTO distributions (camp_id, item_id, quantity, people_served, distributed_by, created_at)
SELECT camp_id, item_id, quantity + 1, 1, 1, NOW(3) FROM camp_stock WHERE quantity > 0 LIMIT 1;

-- 7. Request supplies for a closed camp -> trigger: "cannot create requests for a closed camp"
INSERT INTO requests (camp_id, requested_by, urgency, created_at, updated_at)
SELECT id, 1, 3, NOW(3), NOW(3) FROM camps WHERE status = 'CLOSED' LIMIT 1;

-- 8. Refer to a camp that does not exist -> foreign key constraint fails
INSERT INTO requests (camp_id, requested_by, urgency, created_at, updated_at) VALUES (9999, 1, 3, NOW(3), NOW(3));

-- 9. A camp coordinator without a camp -> CHECK constraint ck_user_scope
INSERT INTO users (username, full_name, password_hash, role, created_at)
VALUES ('bad_coordinator', 'Bad Coordinator', 'x', 'camp_coordinator', NOW(3));

-- 10. Allocate more than was approved -> CHECK constraint ck_ri_allocated_le_approved
UPDATE request_items SET quantity_allocated = quantity_approved + 1 WHERE id = 1;

-- ---------------------------------------------------------------------------------------------
-- A safe reservation attempt, the same conditional UPDATE the application uses (ends with ROLLBACK):
-- ROW_COUNT() = 1 means the units were available; 0 means not enough stock (the service would abort the run).
-- ---------------------------------------------------------------------------------------------
START TRANSACTION;
UPDATE inventory SET quantity_reserved = quantity_reserved + 100
WHERE warehouse_id = 1 AND item_id = 5 AND quantity_on_hand - quantity_reserved >= 100;
SELECT ROW_COUNT() AS rows_reserved;
ROLLBACK;

-- Self-check: all four reconciliation views should return zero rows.
SELECT * FROM v_ledger_mismatch;
SELECT * FROM v_reservation_mismatch;
SELECT * FROM v_allocation_mismatch;
SELECT * FROM v_camp_stock_mismatch;
