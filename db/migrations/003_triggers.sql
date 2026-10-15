-- Integrity enforced inside the database so no client can bypass it.

----------------------------------------------------------------------
-- Append-only history tables
----------------------------------------------------------------------
CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;

CREATE TRIGGER trg_allocation_runs_no_update BEFORE UPDATE ON allocation_runs
BEGIN SELECT RAISE(ABORT, 'allocation history is immutable'); END;
CREATE TRIGGER trg_allocation_runs_no_delete BEFORE DELETE ON allocation_runs
BEGIN SELECT RAISE(ABORT, 'allocation history is immutable'); END;
CREATE TRIGGER trg_allocation_decisions_no_update BEFORE UPDATE ON allocation_decisions
BEGIN SELECT RAISE(ABORT, 'allocation history is immutable'); END;
CREATE TRIGGER trg_allocation_decisions_no_delete BEFORE DELETE ON allocation_decisions
BEGIN SELECT RAISE(ABORT, 'allocation history is immutable'); END;
CREATE TRIGGER trg_allocation_lines_no_update BEFORE UPDATE ON allocation_lines
BEGIN SELECT RAISE(ABORT, 'allocation history is immutable'); END;
CREATE TRIGGER trg_allocation_lines_no_delete BEFORE DELETE ON allocation_lines
BEGIN SELECT RAISE(ABORT, 'allocation history is immutable'); END;

CREATE TRIGGER trg_shipment_events_no_update BEFORE UPDATE ON shipment_events
BEGIN SELECT RAISE(ABORT, 'shipment_events is append-only'); END;
CREATE TRIGGER trg_shipment_events_no_delete BEFORE DELETE ON shipment_events
BEGIN SELECT RAISE(ABORT, 'shipment_events is append-only'); END;

CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

----------------------------------------------------------------------
-- Shipments: state machine + automatic event log
----------------------------------------------------------------------
CREATE TRIGGER trg_shipments_valid_transition BEFORE UPDATE OF status ON shipments
WHEN OLD.status <> NEW.status AND NOT (
       (OLD.status = 'PLANNED'    AND NEW.status IN ('IN_TRANSIT', 'CANCELLED')) OR
       (OLD.status = 'IN_TRANSIT' AND NEW.status = 'DELIVERED'))
BEGIN SELECT RAISE(ABORT, 'invalid shipment status transition'); END;

CREATE TRIGGER trg_shipments_event_on_insert AFTER INSERT ON shipments
BEGIN
  INSERT INTO shipment_events (shipment_id, status, actor_id, note, created_at)
  VALUES (NEW.id, NEW.status, NEW.last_actor_id, NEW.last_note, NEW.status_changed_at);
END;

CREATE TRIGGER trg_shipments_event_on_status AFTER UPDATE OF status ON shipments
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO shipment_events (shipment_id, status, actor_id, note, created_at)
  VALUES (NEW.id, NEW.status, NEW.last_actor_id, NEW.last_note, NEW.status_changed_at);
END;

-- Lines of a shipment are fixed once created; only the receipt count may be recorded.
CREATE TRIGGER trg_shipment_items_immutable BEFORE UPDATE OF shipment_id, request_item_id, item_id, quantity ON shipment_items
BEGIN SELECT RAISE(ABORT, 'shipment lines are immutable'); END;

-- Receipts may only be recorded for shipments that are in transit.
CREATE TRIGGER trg_shipment_items_receipt_state BEFORE UPDATE OF quantity_received ON shipment_items
WHEN (SELECT status FROM shipments WHERE id = NEW.shipment_id) <> 'IN_TRANSIT'
BEGIN SELECT RAISE(ABORT, 'receipts can only be recorded for in-transit shipments'); END;

----------------------------------------------------------------------
-- Business rules
----------------------------------------------------------------------
CREATE TRIGGER trg_requests_camp_open BEFORE INSERT ON requests
WHEN (SELECT status FROM camps WHERE id = NEW.camp_id) = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'cannot create requests for a closed camp'); END;

CREATE TRIGGER trg_requests_urgency_no_downgrade_when_closed BEFORE UPDATE OF urgency ON requests
WHEN OLD.status IN ('FULFILLED', 'CANCELLED') AND NEW.urgency <> OLD.urgency
BEGIN SELECT RAISE(ABORT, 'cannot change urgency of a closed request'); END;

CREATE TRIGGER trg_inventory_no_delete_with_stock BEFORE DELETE ON inventory
WHEN OLD.quantity_on_hand > 0 OR OLD.quantity_reserved > 0
BEGIN SELECT RAISE(ABORT, 'cannot delete an inventory row that still holds stock'); END;

CREATE TRIGGER trg_distribution_stock_guard BEFORE INSERT ON distributions
WHEN COALESCE((SELECT quantity FROM camp_stock WHERE camp_id = NEW.camp_id AND item_id = NEW.item_id), 0) < NEW.quantity
BEGIN SELECT RAISE(ABORT, 'distribution exceeds stock held at the camp'); END;
