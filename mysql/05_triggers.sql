-- ReliefGrid: integrity enforced inside the database (21 triggers, MySQL 8.0 SIGNAL syntax)
-- Load the demo data (03_demo_data.sql) BEFORE creating these triggers: otherwise the shipment triggers would
-- write a second, duplicate timeline row for every shipment inserted by the bulk load.
-- In MySQL Workbench the DELIMITER lines below are understood by the script runner.
USE reliefgrid;

DROP TRIGGER IF EXISTS trg_stock_movements_no_update;
DROP TRIGGER IF EXISTS trg_stock_movements_no_delete;
DROP TRIGGER IF EXISTS trg_allocation_runs_no_update;
DROP TRIGGER IF EXISTS trg_allocation_runs_no_delete;
DROP TRIGGER IF EXISTS trg_allocation_decisions_no_update;
DROP TRIGGER IF EXISTS trg_allocation_decisions_no_delete;
DROP TRIGGER IF EXISTS trg_allocation_lines_no_update;
DROP TRIGGER IF EXISTS trg_allocation_lines_no_delete;
DROP TRIGGER IF EXISTS trg_shipment_events_no_update;
DROP TRIGGER IF EXISTS trg_shipment_events_no_delete;
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;
DROP TRIGGER IF EXISTS trg_shipments_valid_transition;
DROP TRIGGER IF EXISTS trg_shipments_event_on_insert;
DROP TRIGGER IF EXISTS trg_shipments_event_on_status;
DROP TRIGGER IF EXISTS trg_shipment_items_immutable;
DROP TRIGGER IF EXISTS trg_shipment_items_receipt_state;
DROP TRIGGER IF EXISTS trg_requests_camp_open;
DROP TRIGGER IF EXISTS trg_requests_urgency_no_downgrade_when_closed;
DROP TRIGGER IF EXISTS trg_inventory_no_delete_with_stock;
DROP TRIGGER IF EXISTS trg_distribution_stock_guard;

-- ---------------------------------------------------------------------------------------------
-- Append-only history tables (single-statement triggers need no DELIMITER)
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only';
CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only';

CREATE TRIGGER trg_allocation_runs_no_update BEFORE UPDATE ON allocation_runs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'allocation history is immutable';
CREATE TRIGGER trg_allocation_runs_no_delete BEFORE DELETE ON allocation_runs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'allocation history is immutable';
CREATE TRIGGER trg_allocation_decisions_no_update BEFORE UPDATE ON allocation_decisions FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'allocation history is immutable';
CREATE TRIGGER trg_allocation_decisions_no_delete BEFORE DELETE ON allocation_decisions FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'allocation history is immutable';
CREATE TRIGGER trg_allocation_lines_no_update BEFORE UPDATE ON allocation_lines FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'allocation history is immutable';
CREATE TRIGGER trg_allocation_lines_no_delete BEFORE DELETE ON allocation_lines FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'allocation history is immutable';

CREATE TRIGGER trg_shipment_events_no_update BEFORE UPDATE ON shipment_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shipment_events is append-only';
CREATE TRIGGER trg_shipment_events_no_delete BEFORE DELETE ON shipment_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shipment_events is append-only';

CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';

-- ---------------------------------------------------------------------------------------------
-- Shipments: state machine + automatic event log, shipment-line rules
-- ---------------------------------------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_shipments_valid_transition BEFORE UPDATE ON shipments FOR EACH ROW
BEGIN
  IF OLD.status <> NEW.status AND NOT (
       (OLD.status = 'PLANNED'    AND NEW.status IN ('IN_TRANSIT', 'CANCELLED')) OR
       (OLD.status = 'IN_TRANSIT' AND NEW.status = 'DELIVERED')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'invalid shipment status transition';
  END IF;
END$$

CREATE TRIGGER trg_shipments_event_on_insert AFTER INSERT ON shipments FOR EACH ROW
BEGIN
  INSERT INTO shipment_events (shipment_id, status, actor_id, note, created_at)
  VALUES (NEW.id, NEW.status, NEW.last_actor_id, NEW.last_note, NEW.status_changed_at);
END$$

CREATE TRIGGER trg_shipments_event_on_status AFTER UPDATE ON shipments FOR EACH ROW
BEGIN
  IF OLD.status <> NEW.status THEN
    INSERT INTO shipment_events (shipment_id, status, actor_id, note, created_at)
    VALUES (NEW.id, NEW.status, NEW.last_actor_id, NEW.last_note, NEW.status_changed_at);
  END IF;
END$$

-- Lines of a shipment are fixed once created; only the receipt count may be recorded.
CREATE TRIGGER trg_shipment_items_immutable BEFORE UPDATE ON shipment_items FOR EACH ROW
BEGIN
  IF NOT (NEW.shipment_id <=> OLD.shipment_id AND NEW.request_item_id <=> OLD.request_item_id
          AND NEW.item_id <=> OLD.item_id AND NEW.quantity <=> OLD.quantity) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shipment lines are immutable';
  END IF;
END$$

-- Receipts may only be recorded for shipments that are in transit.
CREATE TRIGGER trg_shipment_items_receipt_state BEFORE UPDATE ON shipment_items FOR EACH ROW
BEGIN
  IF NOT (NEW.quantity_received <=> OLD.quantity_received)
     AND (SELECT status FROM shipments WHERE id = NEW.shipment_id) <> 'IN_TRANSIT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'receipts can only be recorded for in-transit shipments';
  END IF;
END$$

-- ---------------------------------------------------------------------------------------------
-- Business rules
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER trg_requests_camp_open BEFORE INSERT ON requests FOR EACH ROW
BEGIN
  IF (SELECT status FROM camps WHERE id = NEW.camp_id) = 'CLOSED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot create requests for a closed camp';
  END IF;
END$$

CREATE TRIGGER trg_requests_urgency_no_downgrade_when_closed BEFORE UPDATE ON requests FOR EACH ROW
BEGIN
  IF OLD.status IN ('FULFILLED', 'CANCELLED') AND NEW.urgency <> OLD.urgency THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot change urgency of a closed request';
  END IF;
END$$

CREATE TRIGGER trg_inventory_no_delete_with_stock BEFORE DELETE ON inventory FOR EACH ROW
BEGIN
  IF OLD.quantity_on_hand > 0 OR OLD.quantity_reserved > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cannot delete an inventory row that still holds stock';
  END IF;
END$$

CREATE TRIGGER trg_distribution_stock_guard BEFORE INSERT ON distributions FOR EACH ROW
BEGIN
  IF COALESCE((SELECT quantity FROM camp_stock WHERE camp_id = NEW.camp_id AND item_id = NEW.item_id), 0) < NEW.quantity THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'distribution exceeds stock held at the camp';
  END IF;
END$$

DELIMITER ;
