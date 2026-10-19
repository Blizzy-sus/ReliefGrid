-- ReliefGrid: MySQL 8.0.16+ schema (tables and indexes)
-- Run order: 01_schema -> 02_reference_data -> 03_demo_data (optional) -> 04_views -> 05_triggers
--
-- Translated from the SQLite migrations in db/migrations. Differences you may notice:
--   * INTEGER PRIMARY KEY -> INT AUTO_INCREMENT; TEXT timestamps -> DATETIME(3); TEXT keys -> VARCHAR(n)
--   * allocation_settings columns "key"/"value" are named setting_key/setting_value (KEY is a reserved word)
--   * SQLite's partial index idx_request_items_open is reproduced with a stored generated column (is_open)
--   * CHECK constraints are enforced by MySQL 8.0.16 and later (earlier versions parse but ignore them)

CREATE DATABASE IF NOT EXISTS reliefgrid CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE reliefgrid;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS audit_log, distributions, camp_stock, shipment_events, allocation_lines, shipment_items, shipments,
  allocation_decisions, allocation_runs, request_items, requests, stock_movements, inventory, sessions, users, camps,
  warehouses, disasters, allocation_settings, supply_items, supply_categories, urgency_levels;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------------------------
-- Reference / lookup data
-- ---------------------------------------------------------------------------------------------
CREATE TABLE urgency_levels (
  level      TINYINT      NOT NULL,
  label      VARCHAR(20)  NOT NULL,
  weight     DECIMAL(8,3) NOT NULL,                 -- multiplier in the priority score
  sla_hours  INT          NOT NULL,                 -- target time to first allocation
  PRIMARY KEY (level),
  UNIQUE KEY uq_urgency_label (label),
  CONSTRAINT ck_urgency_level  CHECK (level BETWEEN 1 AND 4),
  CONSTRAINT ck_urgency_weight CHECK (weight > 0),
  CONSTRAINT ck_urgency_sla    CHECK (sla_hours > 0)
) ENGINE=InnoDB;

CREATE TABLE supply_categories (
  id   INT          NOT NULL AUTO_INCREMENT,
  name VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_category_name (name)
) ENGINE=InnoDB;

CREATE TABLE supply_items (
  id          INT           NOT NULL AUTO_INCREMENT,
  category_id INT           NOT NULL,
  name        VARCHAR(100)  NOT NULL,
  unit        VARCHAR(20)   NOT NULL,
  -- planning standard (units per person per day); NULL = no per-capita standard
  standard_per_person_per_day DECIMAL(10,4) NULL,
  perishable  TINYINT(1)    NOT NULL DEFAULT 0,
  active      TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_name (name),
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES supply_categories (id),
  CONSTRAINT ck_item_standard   CHECK (standard_per_person_per_day IS NULL OR standard_per_person_per_day > 0),
  CONSTRAINT ck_item_perishable CHECK (perishable IN (0, 1)),
  CONSTRAINT ck_item_active     CHECK (active IN (0, 1))
) ENGINE=InnoDB;

CREATE TABLE allocation_settings (
  setting_key   VARCHAR(60)   NOT NULL,
  setting_value DECIMAL(12,4) NOT NULL,
  description   VARCHAR(300)  NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------------------------
CREATE TABLE disasters (
  id         INT          NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120) NOT NULL,
  type       VARCHAR(12)  NOT NULL,
  status     VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
  started_at DATETIME(3)  NOT NULL,
  ended_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_disaster_name (name),
  CONSTRAINT ck_disaster_type   CHECK (type IN ('FLOOD','CYCLONE','EARTHQUAKE','LANDSLIDE','FIRE','OTHER')),
  CONSTRAINT ck_disaster_status CHECK (status IN ('ACTIVE','RECOVERY','CLOSED')),
  CONSTRAINT ck_disaster_dates  CHECK (ended_at IS NULL OR ended_at >= started_at)
) ENGINE=InnoDB;

CREATE TABLE warehouses (
  id            INT           NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120)  NOT NULL,
  district      VARCHAR(80)   NOT NULL,
  latitude      DECIMAL(9,6)  NOT NULL,
  longitude     DECIMAL(9,6)  NOT NULL,
  status        VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
  contact_phone VARCHAR(30)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouse_name (name),
  CONSTRAINT ck_wh_lat    CHECK (latitude  BETWEEN  -90 AND  90),
  CONSTRAINT ck_wh_lon    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT ck_wh_status CHECK (status IN ('ACTIVE','OFFLINE'))
) ENGINE=InnoDB;

CREATE TABLE camps (
  id               INT          NOT NULL AUTO_INCREMENT,
  disaster_id      INT          NOT NULL,
  name             VARCHAR(120) NOT NULL,
  district         VARCHAR(80)  NOT NULL,
  latitude         DECIMAL(9,6) NOT NULL,
  longitude        DECIMAL(9,6) NOT NULL,
  capacity         INT          NOT NULL,
  population       INT          NOT NULL DEFAULT 0,
  -- children under 5, elderly, pregnant/lactating women, people with disabilities
  vulnerable_count INT          NOT NULL DEFAULT 0,
  status           VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
  contact_phone    VARCHAR(30)  NULL,
  opened_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_camp_name_per_disaster (disaster_id, name),
  CONSTRAINT fk_camps_disaster FOREIGN KEY (disaster_id) REFERENCES disasters (id),
  CONSTRAINT ck_camp_lat        CHECK (latitude  BETWEEN  -90 AND  90),
  CONSTRAINT ck_camp_lon        CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT ck_camp_capacity   CHECK (capacity > 0),
  CONSTRAINT ck_camp_population CHECK (population >= 0),
  CONSTRAINT ck_camp_vulnerable CHECK (vulnerable_count >= 0),
  CONSTRAINT ck_camp_status     CHECK (status IN ('OPEN','FULL','CLOSED')),
  CONSTRAINT ck_camp_vuln_le_pop CHECK (vulnerable_count <= population)
) ENGINE=InnoDB;
CREATE INDEX idx_camps_disaster_status ON camps (disaster_id, status);

-- ---------------------------------------------------------------------------------------------
-- Users and sessions
-- ---------------------------------------------------------------------------------------------
CREATE TABLE users (
  id            INT          NOT NULL AUTO_INCREMENT,
  username      VARCHAR(40)  NOT NULL,              -- default collation is case-insensitive, like COLLATE NOCASE
  full_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30)  NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL,
  camp_id       INT          NULL,
  warehouse_id  INT          NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME(3)  NOT NULL,
  last_login_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username),
  CONSTRAINT fk_users_camp      FOREIGN KEY (camp_id)      REFERENCES camps (id),
  CONSTRAINT fk_users_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT ck_user_role   CHECK (role IN ('admin','warehouse_manager','camp_coordinator','volunteer')),
  CONSTRAINT ck_user_active CHECK (active IN (0, 1)),
  -- a user's scope must match their role
  CONSTRAINT ck_user_scope CHECK (
    (role = 'camp_coordinator'  AND camp_id IS NOT NULL AND warehouse_id IS NULL) OR
    (role = 'warehouse_manager' AND warehouse_id IS NOT NULL AND camp_id IS NULL) OR
    (role IN ('admin','volunteer') AND camp_id IS NULL AND warehouse_id IS NULL))
) ENGINE=InnoDB;

CREATE TABLE sessions (
  token_hash CHAR(64)    NOT NULL,                  -- SHA-256 of the bearer token; the token itself is never stored
  user_id    INT         NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token_hash),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX idx_sessions_user    ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Inventory and its ledger
-- ---------------------------------------------------------------------------------------------
-- quantity_reserved = stock promised to PLANNED shipments but still physically in the warehouse.
-- available = quantity_on_hand - quantity_reserved. The CHECKs make over-allocation impossible.
CREATE TABLE inventory (
  warehouse_id      INT         NOT NULL,
  item_id           INT         NOT NULL,
  quantity_on_hand  INT         NOT NULL DEFAULT 0,
  quantity_reserved INT         NOT NULL DEFAULT 0,
  reorder_level     INT         NOT NULL DEFAULT 0,
  updated_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (warehouse_id, item_id),
  CONSTRAINT fk_inv_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT fk_inv_item      FOREIGN KEY (item_id)      REFERENCES supply_items (id),
  CONSTRAINT ck_inv_on_hand  CHECK (quantity_on_hand  >= 0),
  CONSTRAINT ck_inv_reserved CHECK (quantity_reserved >= 0),
  CONSTRAINT ck_inv_reorder  CHECK (reorder_level >= 0),
  CONSTRAINT ck_inv_reserved_le_on_hand CHECK (quantity_reserved <= quantity_on_hand)
) ENGINE=InnoDB;
CREATE INDEX idx_inventory_item ON inventory (item_id);

-- Append-only ledger (enforced by triggers in 05_triggers.sql). Replaying it reproduces `inventory`.
CREATE TABLE stock_movements (
  id             INT          NOT NULL AUTO_INCREMENT,
  warehouse_id   INT          NOT NULL,
  item_id        INT          NOT NULL,
  movement_type  VARCHAR(12)  NOT NULL,
  delta_on_hand  INT          NOT NULL DEFAULT 0,
  delta_reserved INT          NOT NULL DEFAULT 0,
  reference_type VARCHAR(30)  NULL,
  reference_id   INT          NULL,
  user_id        INT          NULL,
  note           VARCHAR(500) NULL,
  created_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_mov_inventory FOREIGN KEY (warehouse_id, item_id) REFERENCES inventory (warehouse_id, item_id),
  CONSTRAINT fk_mov_user      FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT ck_mov_type CHECK (movement_type IN ('OPENING','RECEIPT','ADJUSTMENT','RESERVE','RELEASE','DISPATCH')),
  CONSTRAINT ck_mov_nonzero CHECK (delta_on_hand <> 0 OR delta_reserved <> 0)
) ENGINE=InnoDB;
CREATE INDEX idx_movements_wh_item ON stock_movements (warehouse_id, item_id, created_at);
CREATE INDEX idx_movements_ref     ON stock_movements (reference_type, reference_id);

-- ---------------------------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------------------------
CREATE TABLE requests (
  id           INT          NOT NULL AUTO_INCREMENT,
  camp_id      INT          NOT NULL,
  requested_by INT          NOT NULL,
  urgency      TINYINT      NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  notes        VARCHAR(500) NULL,
  needed_by    DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL,
  updated_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_req_camp    FOREIGN KEY (camp_id)      REFERENCES camps (id),
  CONSTRAINT fk_req_user    FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_req_urgency FOREIGN KEY (urgency)      REFERENCES urgency_levels (level),
  CONSTRAINT ck_req_status CHECK (status IN ('PENDING','PARTIALLY_ALLOCATED','ALLOCATED','FULFILLED','CANCELLED'))
) ENGINE=InnoDB;
CREATE INDEX idx_requests_status_urgency ON requests (status, urgency);
CREATE INDEX idx_requests_camp           ON requests (camp_id, created_at);

-- requested : what the camp asked for      approved : what the planning standard allows (<= requested)
-- allocated : approved units promised/delivered so far      delivered : units confirmed received at the camp
CREATE TABLE request_items (
  id                 INT          NOT NULL AUTO_INCREMENT,
  request_id         INT          NOT NULL,
  item_id            INT          NOT NULL,
  quantity_requested INT          NOT NULL,
  quantity_approved  INT          NOT NULL,
  quantity_allocated INT          NOT NULL DEFAULT 0,
  quantity_delivered INT          NOT NULL DEFAULT 0,
  approval_note      VARCHAR(500) NULL,
  -- stands in for SQLite's partial index: 1 only while the line still needs stock
  is_open            TINYINT(1) GENERATED ALWAYS AS (quantity_allocated < quantity_approved) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_item (request_id, item_id),
  CONSTRAINT fk_ri_request FOREIGN KEY (request_id) REFERENCES requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_item    FOREIGN KEY (item_id)    REFERENCES supply_items (id),
  CONSTRAINT ck_ri_requested CHECK (quantity_requested > 0),
  CONSTRAINT ck_ri_approved  CHECK (quantity_approved  >= 0),
  CONSTRAINT ck_ri_allocated CHECK (quantity_allocated >= 0),
  CONSTRAINT ck_ri_delivered CHECK (quantity_delivered >= 0),
  CONSTRAINT ck_ri_approved_le_requested  CHECK (quantity_approved  <= quantity_requested),
  CONSTRAINT ck_ri_allocated_le_approved  CHECK (quantity_allocated <= quantity_approved),
  CONSTRAINT ck_ri_delivered_le_allocated CHECK (quantity_delivered <= quantity_allocated)
) ENGINE=InnoDB;
CREATE INDEX idx_request_items_item ON request_items (item_id);
CREATE INDEX idx_request_items_open ON request_items (is_open, item_id);

-- ---------------------------------------------------------------------------------------------
-- Allocation history (immutable; see triggers)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE allocation_runs (
  id                  INT          NOT NULL AUTO_INCREMENT,
  run_by              INT          NOT NULL,
  disaster_id         INT          NULL,
  params_json         JSON         NOT NULL,        -- snapshot of settings + urgency weights used
  created_at          DATETIME(3)  NOT NULL,
  requests_considered INT          NOT NULL,
  items_scarce        INT          NOT NULL,
  units_allocated     INT          NOT NULL,
  shipments_created   INT          NOT NULL,
  note                VARCHAR(500) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_run_user     FOREIGN KEY (run_by)      REFERENCES users (id),
  CONSTRAINT fk_run_disaster FOREIGN KEY (disaster_id) REFERENCES disasters (id),
  CONSTRAINT ck_run_requests  CHECK (requests_considered >= 0),
  CONSTRAINT ck_run_scarce    CHECK (items_scarce >= 0),
  CONSTRAINT ck_run_units     CHECK (units_allocated >= 0),
  CONSTRAINT ck_run_shipments CHECK (shipments_created >= 0)
) ENGINE=InnoDB;

CREATE TABLE allocation_decisions (
  id                   INT    NOT NULL AUTO_INCREMENT,
  run_id               INT    NOT NULL,
  request_item_id      INT    NOT NULL,
  camp_id              INT    NOT NULL,
  item_id              INT    NOT NULL,
  approved_qty         INT    NOT NULL,             -- the line's approved quantity
  prior_qty            INT    NOT NULL,             -- already allocated before this run
  need_qty             INT    NOT NULL,             -- remaining need = approved - prior
  item_supply          INT    NOT NULL,             -- network stock available for this item in the run
  item_demand          INT    NOT NULL,             -- total open demand for this item in the run
  urgency_weight       DOUBLE NOT NULL,
  vulnerability_factor DOUBLE NOT NULL,
  aging_factor         DOUBLE NOT NULL,
  priority_score       DOUBLE NOT NULL,
  allocated_qty        INT    NOT NULL,
  scarce               TINYINT(1) NOT NULL,
  explanation          TEXT   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_decision_line (run_id, request_item_id),
  CONSTRAINT fk_dec_run   FOREIGN KEY (run_id)          REFERENCES allocation_runs (id),
  CONSTRAINT fk_dec_ri    FOREIGN KEY (request_item_id) REFERENCES request_items (id),
  CONSTRAINT fk_dec_camp  FOREIGN KEY (camp_id)         REFERENCES camps (id),
  CONSTRAINT fk_dec_item  FOREIGN KEY (item_id)         REFERENCES supply_items (id),
  CONSTRAINT ck_dec_approved CHECK (approved_qty > 0),
  CONSTRAINT ck_dec_prior    CHECK (prior_qty >= 0),
  CONSTRAINT ck_dec_need     CHECK (need_qty > 0),
  CONSTRAINT ck_dec_supply   CHECK (item_supply >= 0),
  CONSTRAINT ck_dec_demand   CHECK (item_demand > 0),
  CONSTRAINT ck_dec_alloc    CHECK (allocated_qty >= 0),
  CONSTRAINT ck_dec_scarce   CHECK (scarce IN (0, 1)),
  CONSTRAINT ck_dec_alloc_le_need CHECK (allocated_qty <= need_qty),
  CONSTRAINT ck_dec_arith    CHECK (approved_qty = prior_qty + need_qty)
) ENGINE=InnoDB;
CREATE INDEX idx_decisions_run          ON allocation_decisions (run_id);
CREATE INDEX idx_decisions_request_item ON allocation_decisions (request_item_id);

-- ---------------------------------------------------------------------------------------------
-- Shipments, camp stock, distribution
-- ---------------------------------------------------------------------------------------------
CREATE TABLE shipments (
  id            INT          NOT NULL AUTO_INCREMENT,
  code          VARCHAR(20)  NOT NULL,
  run_id        INT          NULL,
  warehouse_id  INT          NOT NULL,
  camp_id       INT          NOT NULL,
  status        VARCHAR(12)  NOT NULL DEFAULT 'PLANNED',
  volunteer_id  INT          NULL,
  distance_km   DOUBLE       NOT NULL,
  vehicle       VARCHAR(60)  NULL,
  created_at    DATETIME(3)  NOT NULL,
  dispatched_at DATETIME(3)  NULL,
  eta           DATETIME(3)  NULL,
  delivered_at  DATETIME(3)  NULL,
  -- context for the status-change trigger (who/when/why) so the event log cannot be forgotten
  status_changed_at DATETIME(3) NOT NULL,
  last_actor_id INT          NULL,
  last_note     VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipment_code (code),
  CONSTRAINT fk_ship_run       FOREIGN KEY (run_id)        REFERENCES allocation_runs (id),
  CONSTRAINT fk_ship_warehouse FOREIGN KEY (warehouse_id)  REFERENCES warehouses (id),
  CONSTRAINT fk_ship_camp      FOREIGN KEY (camp_id)       REFERENCES camps (id),
  CONSTRAINT fk_ship_volunteer FOREIGN KEY (volunteer_id)  REFERENCES users (id),
  CONSTRAINT fk_ship_actor     FOREIGN KEY (last_actor_id) REFERENCES users (id),
  CONSTRAINT ck_ship_status   CHECK (status IN ('PLANNED','IN_TRANSIT','DELIVERED','CANCELLED')),
  CONSTRAINT ck_ship_distance CHECK (distance_km >= 0)
) ENGINE=InnoDB;
CREATE INDEX idx_shipments_status    ON shipments (status);
CREATE INDEX idx_shipments_camp      ON shipments (camp_id, status);
CREATE INDEX idx_shipments_warehouse ON shipments (warehouse_id, status);
CREATE INDEX idx_shipments_volunteer ON shipments (volunteer_id, status);

CREATE TABLE shipment_items (
  id                INT NOT NULL AUTO_INCREMENT,
  shipment_id       INT NOT NULL,
  request_item_id   INT NOT NULL,
  item_id           INT NOT NULL,
  quantity          INT NOT NULL,
  quantity_received INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipment_line (shipment_id, request_item_id),
  CONSTRAINT fk_si_shipment FOREIGN KEY (shipment_id)     REFERENCES shipments (id),
  CONSTRAINT fk_si_ri       FOREIGN KEY (request_item_id) REFERENCES request_items (id),
  CONSTRAINT fk_si_item     FOREIGN KEY (item_id)         REFERENCES supply_items (id),
  CONSTRAINT ck_si_quantity CHECK (quantity > 0),
  CONSTRAINT ck_si_received CHECK (quantity_received IS NULL OR (quantity_received >= 0 AND quantity_received <= quantity))
) ENGINE=InnoDB;
CREATE INDEX idx_shipment_items_request_item ON shipment_items (request_item_id);

CREATE TABLE allocation_lines (
  id           INT    NOT NULL AUTO_INCREMENT,
  decision_id  INT    NOT NULL,
  shipment_id  INT    NOT NULL,
  warehouse_id INT    NOT NULL,
  quantity     INT    NOT NULL,
  distance_km  DOUBLE NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_line_decision  FOREIGN KEY (decision_id)  REFERENCES allocation_decisions (id),
  CONSTRAINT fk_line_shipment  FOREIGN KEY (shipment_id)  REFERENCES shipments (id),
  CONSTRAINT fk_line_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT ck_line_quantity CHECK (quantity > 0),
  CONSTRAINT ck_line_distance CHECK (distance_km >= 0)
) ENGINE=InnoDB;
CREATE INDEX idx_lines_decision ON allocation_lines (decision_id);
CREATE INDEX idx_lines_shipment ON allocation_lines (shipment_id);

CREATE TABLE shipment_events (
  id          INT          NOT NULL AUTO_INCREMENT,
  shipment_id INT          NOT NULL,
  status      VARCHAR(12)  NOT NULL,
  actor_id    INT          NULL,
  note        VARCHAR(500) NULL,
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_ev_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id),
  CONSTRAINT fk_ev_actor    FOREIGN KEY (actor_id)    REFERENCES users (id)
) ENGINE=InnoDB;
CREATE INDEX idx_shipment_events_shipment ON shipment_events (shipment_id, id);

-- Supplies physically held at a camp.
CREATE TABLE camp_stock (
  camp_id    INT         NOT NULL,
  item_id    INT         NOT NULL,
  quantity   INT         NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (camp_id, item_id),
  CONSTRAINT fk_cs_camp FOREIGN KEY (camp_id) REFERENCES camps (id),
  CONSTRAINT fk_cs_item FOREIGN KEY (item_id) REFERENCES supply_items (id),
  CONSTRAINT ck_cs_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB;

CREATE TABLE distributions (
  id             INT          NOT NULL AUTO_INCREMENT,
  camp_id        INT          NOT NULL,
  item_id        INT          NOT NULL,
  quantity       INT          NOT NULL,
  people_served  INT          NOT NULL,
  distributed_by INT          NOT NULL,
  note           VARCHAR(500) NULL,
  created_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_dist_stock FOREIGN KEY (camp_id, item_id) REFERENCES camp_stock (camp_id, item_id),
  CONSTRAINT fk_dist_user  FOREIGN KEY (distributed_by)   REFERENCES users (id),
  CONSTRAINT ck_dist_quantity CHECK (quantity > 0),
  CONSTRAINT ck_dist_people   CHECK (people_served > 0)
) ENGINE=InnoDB;
CREATE INDEX idx_distributions_camp ON distributions (camp_id, created_at);
CREATE INDEX idx_distributions_item ON distributions (item_id);

-- ---------------------------------------------------------------------------------------------
-- General audit trail
-- ---------------------------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          INT         NOT NULL AUTO_INCREMENT,
  user_id     INT         NULL,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id   INT         NULL,
  details     JSON        NULL,
  created_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;
CREATE INDEX idx_audit_created ON audit_log (created_at);
CREATE INDEX idx_audit_entity  ON audit_log (entity_type, entity_id);
