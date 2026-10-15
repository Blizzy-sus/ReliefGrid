-- ReliefGrid core schema (3NF).
-- Conventions: INTEGER PRIMARY KEYs, ISO-8601 UTC timestamps in TEXT columns,
-- every enumeration is enforced with a CHECK or a lookup table, every foreign
-- key is declared (foreign_keys pragma is enabled on every connection).

----------------------------------------------------------------------
-- Reference / lookup data
----------------------------------------------------------------------
CREATE TABLE urgency_levels (
  level      INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 4),
  label      TEXT    NOT NULL UNIQUE,
  weight     REAL    NOT NULL CHECK (weight > 0),   -- multiplier in the priority score
  sla_hours  INTEGER NOT NULL CHECK (sla_hours > 0) -- target time to first allocation
);

CREATE TABLE supply_categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE supply_items (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES supply_categories(id),
  name        TEXT    NOT NULL UNIQUE,
  unit        TEXT    NOT NULL,
  -- Planning standard (units per person per day). NULL = no per-capita standard,
  -- so requests for the item are approved as asked.
  standard_per_person_per_day REAL CHECK (standard_per_person_per_day IS NULL OR standard_per_person_per_day > 0),
  perishable  INTEGER NOT NULL DEFAULT 0 CHECK (perishable IN (0, 1)),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE allocation_settings (
  key         TEXT PRIMARY KEY,
  value       REAL NOT NULL,
  description TEXT NOT NULL
);

----------------------------------------------------------------------
-- Places
----------------------------------------------------------------------
CREATE TABLE disasters (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK (type IN ('FLOOD','CYCLONE','EARTHQUAKE','LANDSLIDE','FIRE','OTHER')),
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RECOVERY','CLOSED')),
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE warehouses (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  district      TEXT NOT NULL,
  latitude      REAL NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
  longitude     REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','OFFLINE')),
  contact_phone TEXT
);

CREATE TABLE camps (
  id               INTEGER PRIMARY KEY,
  disaster_id      INTEGER NOT NULL REFERENCES disasters(id),
  name             TEXT    NOT NULL,
  district         TEXT    NOT NULL,
  latitude         REAL    NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
  longitude        REAL    NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  capacity         INTEGER NOT NULL CHECK (capacity > 0),
  population       INTEGER NOT NULL DEFAULT 0 CHECK (population >= 0),
  -- children under 5, elderly, pregnant/lactating women, people with disabilities
  vulnerable_count INTEGER NOT NULL DEFAULT 0 CHECK (vulnerable_count >= 0),
  status           TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FULL','CLOSED')),
  contact_phone    TEXT,
  opened_at        TEXT    NOT NULL,
  UNIQUE (disaster_id, name),
  CHECK (vulnerable_count <= population)
);
CREATE INDEX idx_camps_disaster_status ON camps(disaster_id, status);

----------------------------------------------------------------------
-- Users, sessions
----------------------------------------------------------------------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','warehouse_manager','camp_coordinator','volunteer')),
  camp_id       INTEGER REFERENCES camps(id),
  warehouse_id  INTEGER REFERENCES warehouses(id),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  -- a user's scope must match their role
  CHECK (
    (role = 'camp_coordinator'  AND camp_id IS NOT NULL AND warehouse_id IS NULL) OR
    (role = 'warehouse_manager' AND warehouse_id IS NOT NULL AND camp_id IS NULL) OR
    (role IN ('admin','volunteer') AND camp_id IS NULL AND warehouse_id IS NULL)
  )
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                 -- SHA-256 of the bearer token; the token itself is never stored
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

----------------------------------------------------------------------
-- Inventory and its ledger
----------------------------------------------------------------------
-- quantity_reserved = stock promised to PLANNED shipments but still physically in the warehouse.
-- available = quantity_on_hand - quantity_reserved.  The CHECKs make over-allocation impossible
-- even if application code is wrong.
CREATE TABLE inventory (
  warehouse_id      INTEGER NOT NULL REFERENCES warehouses(id),
  item_id           INTEGER NOT NULL REFERENCES supply_items(id),
  quantity_on_hand  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand  >= 0),
  quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  reorder_level     INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_at        TEXT    NOT NULL,
  PRIMARY KEY (warehouse_id, item_id),
  CHECK (quantity_reserved <= quantity_on_hand)
);
CREATE INDEX idx_inventory_item ON inventory(item_id);

-- Append-only ledger (enforced by triggers in 003). Replaying it reproduces `inventory`.
CREATE TABLE stock_movements (
  id             INTEGER PRIMARY KEY,
  warehouse_id   INTEGER NOT NULL,
  item_id        INTEGER NOT NULL,
  movement_type  TEXT    NOT NULL CHECK (movement_type IN ('OPENING','RECEIPT','ADJUSTMENT','RESERVE','RELEASE','DISPATCH')),
  delta_on_hand  INTEGER NOT NULL DEFAULT 0,
  delta_reserved INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id   INTEGER,
  user_id        INTEGER REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (warehouse_id, item_id) REFERENCES inventory(warehouse_id, item_id),
  CHECK (delta_on_hand <> 0 OR delta_reserved <> 0)
);
CREATE INDEX idx_movements_wh_item ON stock_movements(warehouse_id, item_id, created_at);
CREATE INDEX idx_movements_ref     ON stock_movements(reference_type, reference_id);

----------------------------------------------------------------------
-- Requests
----------------------------------------------------------------------
CREATE TABLE requests (
  id           INTEGER PRIMARY KEY,
  camp_id      INTEGER NOT NULL REFERENCES camps(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  urgency      INTEGER NOT NULL REFERENCES urgency_levels(level),
  status       TEXT    NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','PARTIALLY_ALLOCATED','ALLOCATED','FULFILLED','CANCELLED')),
  notes        TEXT,
  needed_by    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_requests_status_urgency ON requests(status, urgency);
CREATE INDEX idx_requests_camp           ON requests(camp_id, created_at);

-- requested  : what the camp asked for
-- approved   : what the planning standard allows (<= requested; admin may override)
-- allocated  : approved units promised or delivered so far (reserved / in transit / delivered)
-- delivered  : units confirmed received at the camp
CREATE TABLE request_items (
  id                 INTEGER PRIMARY KEY,
  request_id         INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  item_id            INTEGER NOT NULL REFERENCES supply_items(id),
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  quantity_approved  INTEGER NOT NULL CHECK (quantity_approved  >= 0),
  quantity_allocated INTEGER NOT NULL DEFAULT 0 CHECK (quantity_allocated >= 0),
  quantity_delivered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
  approval_note      TEXT,
  UNIQUE (request_id, item_id),
  CHECK (quantity_approved  <= quantity_requested),
  CHECK (quantity_allocated <= quantity_approved),
  CHECK (quantity_delivered <= quantity_allocated)
);
CREATE INDEX idx_request_items_item ON request_items(item_id);
-- Partial index: only rows that still need stock are scanned by the allocator.
CREATE INDEX idx_request_items_open ON request_items(item_id) WHERE quantity_allocated < quantity_approved;

----------------------------------------------------------------------
-- Allocation history (immutable; see triggers)
----------------------------------------------------------------------
CREATE TABLE allocation_runs (
  id                    INTEGER PRIMARY KEY,
  run_by                INTEGER NOT NULL REFERENCES users(id),
  disaster_id           INTEGER REFERENCES disasters(id),
  params_json           TEXT    NOT NULL,   -- snapshot of settings + urgency weights used
  created_at            TEXT    NOT NULL,
  requests_considered   INTEGER NOT NULL CHECK (requests_considered >= 0),
  items_scarce          INTEGER NOT NULL CHECK (items_scarce >= 0),
  units_allocated       INTEGER NOT NULL CHECK (units_allocated >= 0),
  shipments_created     INTEGER NOT NULL CHECK (shipments_created >= 0),
  note                  TEXT
);

CREATE TABLE allocation_decisions (
  id                   INTEGER PRIMARY KEY,
  run_id               INTEGER NOT NULL REFERENCES allocation_runs(id),
  request_item_id      INTEGER NOT NULL REFERENCES request_items(id),
  camp_id              INTEGER NOT NULL REFERENCES camps(id),
  item_id              INTEGER NOT NULL REFERENCES supply_items(id),
  approved_qty         INTEGER NOT NULL CHECK (approved_qty > 0),  -- the line's approved quantity
  prior_qty            INTEGER NOT NULL CHECK (prior_qty >= 0),    -- already allocated before this run
  need_qty             INTEGER NOT NULL CHECK (need_qty > 0),      -- remaining need = approved - prior
  item_supply          INTEGER NOT NULL CHECK (item_supply >= 0),  -- network stock available for this item in the run
  item_demand          INTEGER NOT NULL CHECK (item_demand > 0),   -- total open demand for this item in the run
  urgency_weight       REAL    NOT NULL,
  vulnerability_factor REAL    NOT NULL,
  aging_factor         REAL    NOT NULL,
  priority_score       REAL    NOT NULL,
  allocated_qty        INTEGER NOT NULL CHECK (allocated_qty >= 0),
  scarce               INTEGER NOT NULL CHECK (scarce IN (0, 1)),
  explanation          TEXT    NOT NULL,
  UNIQUE (run_id, request_item_id),
  CHECK (allocated_qty <= need_qty),
  CHECK (approved_qty = prior_qty + need_qty)
);
CREATE INDEX idx_decisions_run          ON allocation_decisions(run_id);
CREATE INDEX idx_decisions_request_item ON allocation_decisions(request_item_id);

----------------------------------------------------------------------
-- Shipments, camp stock, distribution
----------------------------------------------------------------------
CREATE TABLE shipments (
  id            INTEGER PRIMARY KEY,
  code          TEXT    NOT NULL UNIQUE,
  run_id        INTEGER REFERENCES allocation_runs(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  camp_id       INTEGER NOT NULL REFERENCES camps(id),
  status        TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_TRANSIT','DELIVERED','CANCELLED')),
  volunteer_id  INTEGER REFERENCES users(id),
  distance_km   REAL    NOT NULL CHECK (distance_km >= 0),
  vehicle       TEXT,
  created_at    TEXT    NOT NULL,
  dispatched_at TEXT,
  eta           TEXT,
  delivered_at  TEXT,
  -- context for the status-change trigger (who/when/why) so the event log cannot be forgotten
  status_changed_at TEXT NOT NULL,
  last_actor_id INTEGER REFERENCES users(id),
  last_note     TEXT
);
CREATE INDEX idx_shipments_status    ON shipments(status);
CREATE INDEX idx_shipments_camp      ON shipments(camp_id, status);
CREATE INDEX idx_shipments_warehouse ON shipments(warehouse_id, status);
CREATE INDEX idx_shipments_volunteer ON shipments(volunteer_id, status);

CREATE TABLE shipment_items (
  id                INTEGER PRIMARY KEY,
  shipment_id       INTEGER NOT NULL REFERENCES shipments(id),
  request_item_id   INTEGER NOT NULL REFERENCES request_items(id),
  item_id           INTEGER NOT NULL REFERENCES supply_items(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  quantity_received INTEGER CHECK (quantity_received IS NULL OR (quantity_received >= 0 AND quantity_received <= quantity)),
  UNIQUE (shipment_id, request_item_id)
);
CREATE INDEX idx_shipment_items_request_item ON shipment_items(request_item_id);

CREATE TABLE allocation_lines (
  id          INTEGER PRIMARY KEY,
  decision_id INTEGER NOT NULL REFERENCES allocation_decisions(id),
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  distance_km REAL    NOT NULL CHECK (distance_km >= 0)
);
CREATE INDEX idx_lines_decision ON allocation_lines(decision_id);
CREATE INDEX idx_lines_shipment ON allocation_lines(shipment_id);

CREATE TABLE shipment_events (
  id          INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id),
  status      TEXT    NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  note        TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_shipment_events_shipment ON shipment_events(shipment_id, id);

-- Supplies physically held at a camp.
CREATE TABLE camp_stock (
  camp_id    INTEGER NOT NULL REFERENCES camps(id),
  item_id    INTEGER NOT NULL REFERENCES supply_items(id),
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (camp_id, item_id)
);

CREATE TABLE distributions (
  id            INTEGER PRIMARY KEY,
  camp_id       INTEGER NOT NULL,
  item_id       INTEGER NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  people_served INTEGER NOT NULL CHECK (people_served > 0),
  distributed_by INTEGER NOT NULL REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (camp_id, item_id) REFERENCES camp_stock(camp_id, item_id)
);
CREATE INDEX idx_distributions_camp ON distributions(camp_id, created_at);
CREATE INDEX idx_distributions_item ON distributions(item_id);

----------------------------------------------------------------------
-- General audit trail
----------------------------------------------------------------------
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  details     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id);
