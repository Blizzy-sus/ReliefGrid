"""Chapters 11-17 of the ReliefGrid report."""
import os
import re
import sqlite3
from docx_helpers import *  # noqa
from report_data import ASSETS, ROOT, schema_db, load_json, parse_results_md

DIAG = os.path.join(ASSETS, "diagrams_small")
SHOTS = os.path.join(ASSETS, "screens_small")


def fmt(n):
    return f"{n:,}" if isinstance(n, int) else str(n)


def results_text():
    with open(os.path.join(ROOT, "docs", "RESULTS.md"), encoding="utf-8") as f:
        return f.read()


# ======================================================================== 11 allocation
def ch11_allocation(doc, ctx):
    R = ctx["results"]
    h1(doc, "11. PRIORITY-BASED ALLOCATION METHODOLOGY")
    para(doc, "The allocation method is the intellectual core of ReliefGrid. It decides, for every supply item that is in short supply, how many units each open request line receives. The design goals were that it must be (i) **fair**: higher need earns more, but nobody with a legitimate claim is ignored; (ii) **explainable**: a camp coordinator must be able to read why a quantity was granted; (iii) **repeatable**: the same data must always give the same answer; (iv) **consistent across rounds**: camps already served must not be favoured again; and (v) **safe**: it can only hand out stock that exists. It is implemented as a pure module (`server/allocation/engine.js`) and invoked by a service that supplies the data and persists the outcome.", align="justify")
    h2(doc, "11.1 Inputs")
    table_caption(doc, "Inputs for one request line i of a supply item")
    table(doc, ["Symbol", "Meaning", "Source in the database"], [
        ["Aᵢ", "Approved quantity of the line", "request_items.quantity_approved"],
        ["Pᵢ", "Quantity already allocated by earlier runs (reserved, in transit or delivered)", "request_items.quantity_allocated"],
        ["dᵢ = Aᵢ − Pᵢ", "Remaining need", "derived (view v_open_demand)"],
        ["uᵢ", "Urgency weight (Low 1, Moderate 2, High 3.5, Critical 6)", "urgency_levels.weight"],
        ["vᵢ", "Share of residents who are at-risk (children under 5, elderly, pregnant women, people with disabilities)", "camps.vulnerable_count / camps.population"],
        ["hᵢ", "Hours the request has been waiting", "now − requests.created_at"],
        ["S", "Stock available for the item in active warehouses", "inventory: quantity_on_hand − quantity_reserved"],
    ], widths=[1.0, 3.3, 2.2], font=9.5, bold_first_col=True)
    h2(doc, "11.2 Approval against a planning standard")
    para(doc, "For items that have a per-person planning standard (for example rice 0.5 kg, packaged water 5 L, ORS 0.2 sachet and soap 0.1 bar per person per day), a request line is **approved up to** `standard × camp population × planning horizon` (3 days by default). Anything above that is trimmed and the reason is stored on the line. Items without a meaningful per-person standard (tarpaulins, insulin) are approved as requested, and administrators may override an approval but never above the requested quantity. The standards in the demonstration data are illustrative planning assumptions, not official figures.", align="justify")
    callout(doc, "**Verified example.** A camp of 1,000 people asks for 40,000 L of drinking water: 5 L × 1,000 × 3 days = 15,000 L is approved and the line records “Capped at the 3-day planning standard” (automated test `request validation and standard-based approval`). The same behaviour for a 1,150-person camp (17,250 L) is shown in Appendix A.")
    h2(doc, "11.3 Priority score")
    callout(doc, "**scoreᵢ = uᵢ × ( 1 + kᵥ · vᵢ ) × ( 1 + kₐ · min( 1, hᵢ / W ) )**\nwith vulnerability weight kᵥ = 1, aging bonus kₐ = 0.5 and aging window W = 48 hours (all editable by an administrator and snapshotted into every run).", fill="F2F2F2", border="BFBFBF", size=10.5)
    bullets(doc, [
        "**Urgency** is the dominant factor and is chosen by the camp. Coordinators may only raise it; only administrators may lower it.",
        "**Vulnerability** lifts camps with more at-risk residents, by up to a factor of 2. Camp population influences the allocation in two ways: through this share and through the planning-standard cap that limits how much a camp may claim.",
        "**Aging** lifts requests that have waited, by up to 1.5 after 48 hours, so that low-urgency requests cannot be postponed indefinitely.",
    ])
    h2(doc, "11.4 Rationing a scarce item")
    para(doc, "Each supply item is rationed independently: stock of rice says nothing about stock of tarpaulins. Let the *coverage* of a line be (Pᵢ + xᵢ) / Aᵢ, where xᵢ is what the line receives now.", align="justify")
    bullets(doc, [
        "**If S ≥ Σdᵢ** nobody is short and every line receives its remaining need.",
        "**Otherwise** the engine finds the single fair level λ for which  xᵢ = clamp( Aᵢ · λ · scoreᵢ − Pᵢ , 0 , dᵢ )  and  Σxᵢ = S.  In words: every line is brought up to a cumulative coverage of min(100%, λ × its priority score). Coverage is therefore proportional to priority and capped at 100%; a line that reaches 100% releases its surplus to the others; and a line that already holds more than its fair level (because an earlier run served it) receives nothing until the others catch up.",
    ])
    para(doc, "The total allocation Σxᵢ(λ) is a non-decreasing piecewise-linear function of λ whose breakpoints are the values at which a line starts to receive stock (λ = Pᵢ / (Aᵢ·scoreᵢ)) or becomes capped (λ = 1 / scoreᵢ). The engine sorts the breakpoints, locates the interval that contains S and interpolates, so the solution is exact rather than iterative. With nothing allocated before (Pᵢ = 0) the rule reduces to “coverage proportional to priority”. This is a priority-weighted form of max-min fairness (Bertsekas and Gallager, 1992) applied to cumulative coverage.", align="justify")
    figure(doc, os.path.join(DIAG, "allocation_flow.png"), "Allocation procedure for one run, executed inside a single transaction", max_height=6.6)
    h2(doc, "11.5 Whole units")
    para(doc, "Quantities are whole units. Each xᵢ is rounded down and the leftover units are given, one each, to the lines with the largest fractional parts (ties: higher priority, then lower id). The integer result sums exactly to S, never exceeds a line’s need and lies within one unit of the exact solution.", align="justify")
    h2(doc, "11.6 Worked examples")
    para(doc, "**Example A (analytical).** Two lines of 100 units with priorities 6 (Critical) and 1 (Low) share 100 units. 100·6λ + 100·λ = 100 gives λ = 1/7, so coverages are 6/7 and 1/7: the allocation is **86 and 14 units** (the fraction 0.71 outranks 0.29 in the rounding). This case is an automated test.", align="justify")
    t5 = R[5][0]
    para(doc, "**Example B (verified by script, scenario 5 of docs/RESULTS.md).** Two camps of equal priority each requested 1,000 units. In round 1, camp A alone had a request open and received 400 units. In round 2, camp B has asked and 600 more units arrive. A method that looks only at remaining need splits the 600 by remaining need; ReliefGrid levels cumulative coverage first.", align="justify")
    table_caption(doc, "Multi-round fairness: naive remaining-need split versus ReliefGrid (verified)")
    table(doc, ["Camp", "Already holds", "Naive share", "Cumulative coverage (naive)", "ReliefGrid share", "Cumulative coverage (ReliefGrid)"],
          t5["rows"], widths=[1.5, 0.8, 0.8, 1.2, 0.9, 1.3], font=9, align=["l", "r", "r", "r", "r", "r"])
    h2(doc, "11.7 Selecting source warehouses")
    para(doc, "After shares are fixed, lines are served in priority order, each from the nearest active warehouses that still have stock (road distance = straight-line great-circle distance × a detour factor of 1.35), splitting across warehouses when one is not enough. All lines going from one warehouse to one camp are bundled into one shipment, and stock for every shipment is reserved in the same transaction. Because stock is pooled per item before sourcing, an item can always be sourced completely; the engine asserts this. The greedy choice is not a minimum-cost flow, so total kilometres are not guaranteed to be optimal (Chapter 16).", align="justify")
    h2(doc, "11.8 Explainability")
    m = re.search(r"^> (Priority .+)$", results_text(), re.M)
    para(doc, "Every decision stores a plain-language explanation. The following sentence is a real output for a Critical camp in the seeded incident:", align="justify")
    callout(doc, f"“{m.group(1)}”", fill="FFFBEB", border="E5C97A", size=9.5)
    para(doc, "Camp coordinators see the history of these sentences on the page of their request; administrators see them, with the score breakdown and sources, in the preview and in every historical run. Together with the parameter snapshot stored on each run, any past decision can be audited.", align="justify")
    h2(doc, "11.9 Properties and how they are verified")
    table_caption(doc, "Properties of the method and the tests that verify them")
    table(doc, ["Property", "Verification"], [
        ["Never allocates more than the stock or more than a line needs; integer results", "Property test over 600 randomised scenarios (`tests/engine.test.js`)"],
        ["Uses every available unit when stock is short", "Same property test"],
        ["Within one unit of the exact real-valued solution", "Same test, compared with an independent bisection solver"],
        ["Higher priority never receives lower cumulative coverage (among lines that receive stock)", "Property test over 200 randomised scenarios; demo-data test"],
        ["Deterministic regardless of the order of the input", "`determinism` test"],
        ["Deficit awareness: lines above their fair level wait; lines are levelled", "Two dedicated tests (Example B)"],
        ["Abundant stock gives everyone their full remaining need", "`abundance` test and demo-data test"],
        ["Reservation never exceeds stock even with concurrent runs; failure mid-run rolls back", "API tests (Chapter 12)"],
    ], widths=[3.4, 3.1], font=9)


# ======================================================================== 12 transactions
def ch12_transactions(doc, ctx):
    h1(doc, "12. TRANSACTIONS, CONCURRENCY AND DATA INTEGRITY")
    para(doc, "Every operation that changes more than one row runs inside `tx(db, fn)` (`server/db.js`), which issues **BEGIN IMMEDIATE**. SQLite then takes the write lock before the transaction reads anything, so everything read inside the transaction cannot be changed by another writer until it commits. Nested calls join the outer transaction, and any exception triggers ROLLBACK.", align="justify")
    h2(doc, "12.1 Three layers of protection against double-booking")
    numbered(doc, [
        "**Serialised writers and a re-read inside the transaction.** `commitAllocation` loads open demand and stock after BEGIN IMMEDIATE; a plan computed earlier (the preview) is never trusted.",
        "**Conditional atomic update.** Reservation is `UPDATE inventory SET quantity_reserved = quantity_reserved + :q WHERE ... AND quantity_on_hand - quantity_reserved >= :q`. If it changes zero rows the service raises INSUFFICIENT_STOCK and the whole run rolls back.",
        "**Table constraint.** `CHECK (quantity_reserved <= quantity_on_hand)` rejects any statement that would over-reserve, whatever its origin.",
    ])
    h2(doc, "12.2 Atomic units of work")
    table_caption(doc, "Operations and what each transaction contains")
    table(doc, ["Operation", "Changes made atomically"], [
        ["Create request", "request + lines (with approved quantities) + audit row"],
        ["**Commit allocation**", "run + decisions + allocation lines + shipments + shipment lines + conditional reservations + ledger rows + request counters and statuses + audit"],
        ["Dispatch", "decrement quantity_on_hand and quantity_reserved together + ledger + shipment status (timeline row by trigger) + audit"],
        ["Deliver", "receipts + camp stock increase + request counters (shortfall released for re-allocation) + shipment status + audit"],
        ["Cancel shipment", "release reservation + ledger + request counters + status"],
        ["Receive / adjust stock", "inventory change (adjustment cannot go below reserved) + ledger + audit"],
        ["Record distribution", "stock guard trigger + insert + camp stock decrement"],
    ], widths=[1.6, 4.9], font=9.5, bold_first_col=False)
    h2(doc, "12.3 Shipment life-cycle")
    figure(doc, os.path.join(DIAG, "shipment_states.png"), "Shipment state machine enforced by trg_shipments_valid_transition", max_height=3.8)
    para(doc, "Dispatch converts a reservation into a real stock movement; cancellation before dispatch releases only the reservation. When a delivery reports fewer units than shipped, the shortfall is subtracted from `request_items.quantity_allocated` in the same transaction, so the missing quantity becomes open demand again and is picked up by the next run.", align="justify")
    h2(doc, "12.4 Ledger and reconciliation")
    para(doc, "Every change to `inventory` has a matching row in the append-only `stock_movements` ledger (types OPENING, RECEIPT, ADJUSTMENT, RESERVE, RELEASE and DISPATCH, each with a change to on-hand and reserved quantities). Four reconciliation views recompute the derived figures from first principles and must return no rows: `v_ledger_mismatch`, `v_reservation_mismatch`, `v_allocation_mismatch` and `v_camp_stock_mismatch`. The Administration page runs them on demand, and the test-suite runs them after every multi-step scenario.", align="justify")
    h2(doc, "12.5 Verified behaviour")
    bullets(doc, [
        "**Fault injection:** a database trigger that aborts the audit insert (the last step of an allocation run) leaves zero runs, shipments, decisions, reservations and ledger rows; once the fault is removed the same run succeeds.",
        "**Concurrent requests:** eight simultaneous allocation requests reserve each unit exactly once (5,000 of 5,000 units, never more).",
        "**Real two-connection isolation:** while one connection holds a write transaction, a second connection cannot start one, sees only committed data, and cannot over-reserve (`tests/database.test.js`, against a file database).",
        "**Over-allocation:** after all stock is reserved, a second run allocates zero units; a direct SQL attempt to raise the reservation fails with a CHECK violation.",
    ])
    callout(doc, "**Honest scope note.** Node.js executes the application in one thread and `node:sqlite` is synchronous, so the “eight concurrent requests” test demonstrates the correctness of the logic under interleaved requests rather than true parallelism; genuine multi-connection isolation is covered by the separate two-connection test.", fill="FFF8E5", border="E5C97A", size=9.5)


# ======================================================================== 13 SQL
def negative_tests():
    con = schema_db()
    con.execute("PRAGMA foreign_keys=ON")
    con.executescript("""
      INSERT INTO supply_items (category_id, name, unit) VALUES (1, 'Water', 'L');
      INSERT INTO warehouses (name, district, latitude, longitude) VALUES ('Depot A', 'North', 10.8, 79.6);
      INSERT INTO inventory (warehouse_id, item_id, quantity_on_hand, quantity_reserved, updated_at) VALUES (1, 1, 100, 0, 't');
      INSERT INTO stock_movements (warehouse_id, item_id, movement_type, delta_on_hand, created_at) VALUES (1, 1, 'OPENING', 100, 't');
      INSERT INTO disasters (name, type, started_at) VALUES ('Test', 'FLOOD', 't');
      INSERT INTO camps (disaster_id, name, district, latitude, longitude, capacity, population, opened_at) VALUES (1, 'Camp', 'N', 10.9, 79.7, 500, 100, 't');
      INSERT INTO shipments (code, warehouse_id, camp_id, distance_km, created_at, status_changed_at) VALUES ('SHP-00001', 1, 1, 12.5, 't', 't');
      INSERT INTO camp_stock (camp_id, item_id, quantity, updated_at) VALUES (1, 1, 5, 't');
    """)
    cases = [
        ("Reserve more stock than is on hand", "UPDATE inventory SET quantity_reserved = 101\nWHERE warehouse_id = 1 AND item_id = 1;"),
        ("Skip a step in the shipment life-cycle", "UPDATE shipments SET status = 'DELIVERED' WHERE id = 1;"),
        ("Edit the append-only stock ledger", "UPDATE stock_movements SET delta_on_hand = 999;"),
        ("Hand out more than the camp holds", "INSERT INTO distributions (camp_id, item_id, quantity, people_served, distributed_by, created_at)\nVALUES (1, 1, 6, 10, 1, 't');"),
        ("Refer to a camp that does not exist", "INSERT INTO requests (camp_id, requested_by, urgency, created_at, updated_at)\nVALUES (99, 1, 3, 't', 't');"),
    ]
    out = []
    for title, sql in cases:
        try:
            con.execute(sql)
            msg = "(no error)"
        except sqlite3.Error as e:
            msg = f"{type(e).__name__}: {e}"
        out.append((title, sql, msg))
    con.close()
    return out


def ch13_sql(doc, ctx):
    Q = ctx["queries"]
    h1(doc, "13. SQL OPERATIONS AND EXAMPLE QUERIES")
    para(doc, "This chapter shows representative SQL from the project. Unlike a purely illustrative listing, **every query result in Section 13.4 was produced by running the query on the demonstration database** seeded with a fixed clock (2026-07-15 12:00 UTC), and every error message in Section 13.3 was captured by executing the statement against a database created from the project’s own migration files. All 17 showcase queries are stored in `db/queries.sql` and executed by an automated test.", align="justify")
    h2(doc, "13.1 Schema definition (excerpt)")
    para(doc, "The inventory table and the shipment state-machine trigger, exactly as they appear in the migrations:", align="justify")
    code_block(doc, """CREATE TABLE inventory (
  warehouse_id      INTEGER NOT NULL REFERENCES warehouses(id),
  item_id           INTEGER NOT NULL REFERENCES supply_items(id),
  quantity_on_hand  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand  >= 0),
  quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  reorder_level     INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_at        TEXT    NOT NULL,
  PRIMARY KEY (warehouse_id, item_id),
  CHECK (quantity_reserved <= quantity_on_hand)
);

CREATE TRIGGER trg_shipments_valid_transition BEFORE UPDATE OF status ON shipments
WHEN OLD.status <> NEW.status AND NOT (
       (OLD.status = 'PLANNED'    AND NEW.status IN ('IN_TRANSIT', 'CANCELLED')) OR
       (OLD.status = 'IN_TRANSIT' AND NEW.status = 'DELIVERED'))
BEGIN SELECT RAISE(ABORT, 'invalid shipment status transition'); END;""", font=8.5)
    h2(doc, "13.2 Data manipulation as issued by the service layer")
    code_block(doc, """-- Reserve stock for an allocation line (fails safely if stock changed)
UPDATE inventory
   SET quantity_reserved = quantity_reserved + :qty, updated_at = :now
 WHERE warehouse_id = :wh AND item_id = :item
   AND quantity_on_hand - quantity_reserved >= :qty;      -- changes() must be 1

-- Dispatch: stock leaves the warehouse (reservation becomes a real movement)
UPDATE inventory
   SET quantity_on_hand  = quantity_on_hand  - :qty,
       quantity_reserved = quantity_reserved - :qty
 WHERE warehouse_id = :wh AND item_id = :item
   AND quantity_reserved >= :qty AND quantity_on_hand >= :qty;

-- Delivery with a shortfall: the missing units become open demand again
UPDATE request_items
   SET quantity_delivered = quantity_delivered + :received,
       quantity_allocated = quantity_allocated - (:shipped - :received)
 WHERE id = :request_item;

-- Receive stock: create the stock row on first receipt, otherwise add to it
INSERT INTO inventory (warehouse_id, item_id, quantity_on_hand, quantity_reserved, reorder_level, updated_at)
VALUES (:wh, :item, :qty, 0, 0, :now)
ON CONFLICT (warehouse_id, item_id) DO UPDATE
   SET quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand, updated_at = excluded.updated_at;""", font=8.5)
    para(doc, "A safe transaction example in the style of the project’s tests (it ends with ROLLBACK so it can be run on a copy without changing data):", align="justify")
    code_block(doc, """BEGIN IMMEDIATE;
UPDATE inventory SET quantity_reserved = quantity_reserved + 100
 WHERE warehouse_id = 1 AND item_id = 5 AND quantity_on_hand - quantity_reserved >= 100;
SELECT changes();                     -- 1 = reserved, 0 = not enough available stock
ROLLBACK;""", font=8.5)
    h2(doc, "13.3 Constraints and triggers rejecting invalid operations (captured output)")
    para(doc, "Each statement below was executed against a database built from the migrations (with a minimal set of rows); the message is the database’s own.", align="justify")
    rows = [[t, f"`{s.splitlines()[0]}`" + (" …" if len(s.splitlines()) > 1 else ""), m] for t, s, m in ctx["negative"]]
    table_caption(doc, "Captured database responses to invalid statements")
    table(doc, ["Attempted operation", "Statement (first line)", "Database response"], rows, widths=[1.8, 2.5, 2.2], font=8.5)
    h2(doc, "13.4 Showcase queries and their results")
    SELECT = [
        ("q01_shortage_by_item", "13.4.1 Supply versus open demand per item", ["item_name", "unit", "available", "open_demand", "shortage", "pct_coverable"], 6),
        ("q02_camps_ranked_by_unmet_need", "13.4.2 Camps ranked by unmet need (JOIN, GROUP BY, HAVING)", ["camp", "population", "open_lines", "avg_unmet_share"], 6),
        ("q05_nearest_stocked_warehouse", "13.4.3 Nearest warehouse still holding water, per camp (CTE and ROW_NUMBER)", ["camp", "warehouse", "available"], 6),
        ("q06_fairness_by_urgency_per_run", "13.4.4 Fairness check: coverage by urgency in each scarce run", ["run_id", "urgency", "lines", "avg_cumulative_coverage"], 8),
        ("q08_losses_by_route", "13.4.5 Losses in transit by route", ["warehouse", "camp", "shipped", "received", "lost"], 4),
        ("q11_critical_camps_with_nothing_coming", "13.4.6 Camps with an open Critical request and no shipment on the way (NOT EXISTS)", ["camp", "open_critical_requests"], 5),
        ("q12_top_volunteers", "13.4.7 Units delivered per volunteer", ["volunteer", "shipments", "units_delivered"], 5),
        ("q14_deliveries_per_day_with_gaps", "13.4.8 Deliveries per day (recursive CTE calendar)", ["day", "shipments_delivered"], 5),
        ("q15_integrity_report", "13.4.9 Integrity report (UNION ALL of the reconciliation views)", ["check_name", "problems"], 5),
    ]
    for key, title, cols, limit in SELECT:
        q = Q[key]
        h3(doc, title)
        para(doc, q["description"], italic=True, size=10, space_after=3)
        code_block(doc, q["sql"], font=7.5)
        rows = [[(f"{r[c]:,}" if isinstance(r[c], int) else str(r[c])) for c in cols] for r in q["rows"][:limit]]
        al = ["l" if isinstance(q["rows"][0][c], str) else "r" for c in cols]
        suffix = f" (first {limit} of {q['rowCount']} rows)" if q["rowCount"] > limit else f" ({q['rowCount']} rows)"
        table_caption(doc, f"Result of {key.split('_')[0]}{suffix}")
        w = [6.5 / len(cols)] * len(cols)
        if key == "q01_shortage_by_item":
            w = [2.0, 0.7, 0.9, 1.0, 0.9, 1.0]
        elif key == "q02_camps_ranked_by_unmet_need":
            w = [3.0, 1.0, 1.2, 1.3]
        elif key == "q05_nearest_stocked_warehouse":
            w = [3.0, 2.5, 1.0]
        elif key == "q08_losses_by_route":
            w = [2.0, 2.2, 0.8, 0.8, 0.7]
        table(doc, cols, rows, widths=w, font=8.5, align=al)
    para(doc, "Results are an output of the seeded demonstration data and will differ if the database is re-seeded with a different clock or modified through the application.", italic=True, size=9.5)


# ======================================================================== 14 modules and API
API = [
    ("POST", "/api/auth/login", "public (rate-limited)", "Sign in; returns a bearer token and the user"),
    ("POST", "/api/auth/logout", "any signed-in user", "Delete the session"),
    ("GET", "/api/auth/me", "any signed-in user", "Current user"),
    ("GET", "/api/auth/demo-accounts", "public, local builds only", "Sign-in shortcuts for the seeded demo users"),
    ("GET", "/api/dashboard", "all roles", "KPIs, map data, alerts, supply versus demand, activity"),
    ("GET", "/api/alerts", "all roles", "Shortage, SLA, low-stock and delay alerts"),
    ("GET", "/api/analytics", "all roles", "Coverage and delivery analytics"),
    ("GET", "/api/integrity", "admin", "Run the four reconciliation views"),
    ("GET", "/api/audit", "admin", "Audit trail"),
    ("GET / POST / PATCH", "/api/disasters[/:id]", "all / admin / admin", "List, create and change incident status"),
    ("GET", "/api/categories", "all roles", "Supply categories"),
    ("GET / PUT", "/api/urgency-levels[/:level]", "all / admin", "Read; edit weight and target hours"),
    ("GET / POST / PATCH", "/api/items[/:id]", "all / admin / admin", "Supply catalogue"),
    ("GET / POST / PATCH", "/api/warehouses[/:id]", "all / admin / admin", "Warehouses with stock totals; create; set status"),
    ("GET", "/api/camps", "all roles", "Camp list with open requests and urgency"),
    ("GET", "/api/camps/:id", "all roles", "Camp detail: requests, stock, shipments"),
    ("POST", "/api/camps", "admin", "Create a camp"),
    ("PATCH", "/api/camps/:id", "admin; coordinator of that camp", "Update census (population, at-risk); status is admin-only"),
    ("GET", "/api/camps/:id/stock", "all roles", "Stock held at a camp"),
    ("GET", "/api/volunteers", "admin, warehouse manager", "Active volunteers (for assignment)"),
    ("GET / POST / PATCH", "/api/users[/:id]", "admin", "List, create, activate/deactivate, reset password"),
    ("GET", "/api/inventory", "all roles", "Inventory view (filter by warehouse or item)"),
    ("GET", "/api/inventory/movements", "all roles", "Stock ledger"),
    ("POST", "/api/inventory/receive", "admin; manager of that warehouse", "Receive stock"),
    ("POST", "/api/inventory/adjust", "admin; manager of that warehouse", "Adjust stock with a reason (not below reserved)"),
    ("POST", "/api/inventory/reorder-level", "admin; manager of that warehouse", "Set reorder level"),
    ("GET", "/api/requests", "all roles", "Requests (filter by status, camp, urgency)"),
    ("GET", "/api/requests/:id", "all roles", "Request detail with lines, decisions and shipments"),
    ("POST", "/api/requests", "admin; coordinator of that camp", "Create a request"),
    ("POST", "/api/requests/:id/cancel", "admin; coordinator of that camp", "Cancel (no active shipments)"),
    ("POST", "/api/requests/:id/urgency", "admin; coordinator (raise only)", "Change urgency"),
    ("POST", "/api/request-items/:id/approval", "admin", "Override an approved quantity"),
    ("GET / PUT", "/api/allocation/settings", "all / admin", "Read; edit allocation parameters"),
    ("POST", "/api/allocation/preview", "admin", "Compute an allocation without changing data"),
    ("POST", "/api/allocation/run", "admin", "Commit an allocation run (one transaction)"),
    ("GET", "/api/allocation/runs[/:id]", "all roles", "Run history and run detail"),
    ("GET", "/api/shipments[/:id]", "all roles", "Shipment list and detail with timeline"),
    ("POST", "/api/shipments/:id/assign", "admin; manager of that warehouse", "Assign a volunteer"),
    ("POST", "/api/shipments/:id/dispatch", "admin; manager of that warehouse", "Dispatch"),
    ("POST", "/api/shipments/:id/cancel", "admin; manager of that warehouse", "Cancel a planned shipment"),
    ("POST", "/api/shipments/:id/claim", "volunteer", "Claim an unassigned shipment"),
    ("POST", "/api/shipments/:id/deliver", "admin; receiving coordinator; assigned volunteer", "Confirm delivery with received quantities"),
    ("GET / POST", "/api/distributions", "all / admin, coordinator of that camp", "List and record distributions"),
]


def ch14_modules(doc, ctx):
    routes = ctx["routes"]
    h1(doc, "14. APPLICATION MODULES AND API DESIGN")
    h2(doc, "14.1 Frontend modules")
    para(doc, "The front end is a single-page application written as ES modules without a build step. A router maps hash routes to nine page modules; navigation is filtered by role. All dynamic text is rendered through an auto-escaping template function, which prevents cross-site scripting by default. Screenshots of each module are in Appendix A.", align="justify")
    table_caption(doc, "Frontend modules")
    table(doc, ["Module", "Purpose", "Main users"], [
        ["Sign-in", "Authentication with local demo-account shortcuts", "All"],
        ["Dashboard", "KPI cards, situation map (camps coloured by urgency, shipment routes), alerts, supply versus open demand, urgency donut, recent activity; refreshes every 30 s", "All"],
        ["Requests", "Filterable list; new-request dialog with live planning-cap hints; request page showing requested → approved → allocated → delivered and the explanation history", "Coordinators, admin"],
        ["Allocation", "Method summary, preview with per-line score breakdown and explanations, commit with confirmation, run history and run detail", "Admin (read-only for others)"],
        ["Shipments", "Status board, dispatch, assign, claim, cancel, confirm-delivery dialog with per-line quantities, timeline", "Managers, volunteers, coordinators"],
        ["Inventory", "Per-warehouse and network stock, receive, adjust, reorder level, ledger viewer", "Managers, admin"],
        ["Relief camps", "Camp cards and detail pages; census update", "All"],
        ["Distribution", "Record aid handed out; camp stock; refusal when stock is insufficient", "Coordinators, admin"],
        ["Analytics", "Coverage by urgency, time to first delivery, deliveries per day, committed stock, shortages, camp coverage, runs, losses", "All"],
        ["Administration", "Users, allocation settings, audit trail, data-integrity checks", "Admin"],
    ], widths=[1.2, 3.9, 1.4], font=9, bold_first_col=True)
    h2(doc, "14.2 Backend API")
    para(doc, f"The server exposes {ctx["route_count"]} JSON endpoints under `/api` (counted from the route definitions). Every endpoint except sign-in requires a bearer token; role gates and scope checks are applied on top, and every error is returned in a uniform structure with a stable code. The table below lists the endpoints grouped by area; “all” means every signed-in role.", align="justify")
    table_caption(doc, "REST API endpoints and access rules")
    table(doc, ["Method", "Endpoint", "Access", "Purpose"], [list(r) for r in API], widths=[0.85, 1.9, 1.5, 2.25], font=8)
    h2(doc, "14.3 Security design")
    bullets(doc, [
        "**Passwords** are hashed with scrypt and a per-password random salt; comparison is constant-time, and a dummy hash is verified for unknown users so timing does not reveal which usernames exist.",
        "**Sessions** use random 256-bit tokens stored only as SHA-256 hashes, expire after 12 hours and are deleted on logout, deactivation and password reset. Tokens travel in an Authorization header, so classic CSRF does not apply.",
        "**Authorisation** is declared per route (role) and per object (own camp, own warehouse, assigned shipment); the users table CHECK keeps role and scope consistent.",
        "**Input handling:** all SQL uses prepared statements with bound parameters; every field is validated for type, range and length; JSON bodies are limited to 100 KB; unknown enumeration values are rejected.",
        "**Browser protections:** Content-Security-Policy `default-src 'self'`, X-Content-Type-Options, X-Frame-Options DENY and a no-referrer policy.",
        "**Abuse control:** after eight failed sign-ins within ten minutes for a given address and username, further attempts return HTTP 429; every failed attempt is audited.",
    ])


# ======================================================================== 15 testing and results
def ch15_testing(doc, ctx):
    R = ctx["results"]
    tests, summary = ctx["tests"], ctx["test_summary"]
    h1(doc, "15. TESTING AND RESULTS")
    h2(doc, "15.1 Testing strategy")
    para(doc, "Testing covers the allocation algorithm in isolation (including randomised property tests), the database schema (constraints, triggers, views, indexes, migrations and isolation), the HTTP API end to end (authentication, role-based access, lifecycle and concurrency), realistic scenarios on the seeded incident, and the SQL showcase queries. The user interface was verified manually in a browser and with scripted screenshots.", align="justify")
    h2(doc, "15.2 Environment and how to read the results")
    table_caption(doc, "Verification environment")
    table(doc, ["Item", "Value"], [
        ["Operating system", "Windows 11 Home (10.0.26200)"],
        ["Runtime", "Node.js v22.19.0"],
        ["Database engine", f"SQLite {ctx['schema']['sqlite_version']} (built into Node.js)"],
        ["Test runner", "`node:test` (built in), spec reporter"],
        ["Date of the verification run", "October 2026"],
    ], widths=[2.0, 4.5], font=9.5, bold_first_col=True)
    callout(doc, "**Reading guide.** *Verified* results in this chapter were produced by running the commands listed in Appendix B on the submitted code. *Illustrative* material (diagrams, the analytical Example A in Chapter 11, and the fictional demonstration data) is labelled as such. No result in this report has been estimated or invented. Allocation tables use a fixed clock so that they are exactly reproducible; screenshots were captured from the running application seeded at capture time, so hour-dependent figures (waiting time, “hours ago”) differ slightly from the fixed-clock tables.", size=9.5)
    h2(doc, "15.3 Automated test suite")
    per = {n: len(t) for n, t in tests}
    table_caption(doc, "Automated tests by file")
    table(doc, ["Test file", "Tests", "What it verifies"], [
        ["tests/engine.test.js", str(per["tests/engine.test.js"]), "Closed-form allocation cases, deficit awareness, 600-scenario property test against an independent solver, 200-scenario monotonicity test, determinism, scoring, planning cap, sourcing and distance"],
        ["tests/database.test.js", str(per["tests/database.test.js"]), "Migrations and checksum tamper detection, foreign keys, CHECK constraints, role-scope constraint, append-only history, shipment state machine and timeline, business-rule triggers, views, reconciliation, `EXPLAIN QUERY PLAN` index use, tx() semantics, real two-connection isolation"],
        ["tests/api.test.js", str(per["tests/api.test.js"]), "Authentication, rate limiting, role and scope matrix, validation, atomic preview/commit, over-allocation, concurrent runs, fault-injection rollback, full lifecycle with partial delivery and re-allocation, cancellation, inventory floor, dashboards, input hardening"],
        ["tests/scenarios.test.js", str(per["tests/scenarios.test.js"]), "Seeded incident is internally consistent; scarce items rationed by priority; Critical > High > Moderate > Low coverage; commit through the API; role journeys"],
        ["tests/queries.test.js", str(per["tests/queries.test.js"]), "All 17 showcase queries run on the demo data; integrity report clean; ledger replay ends at the inventory balance; coverage ordered by urgency"],
        ["**Total**", f"**{int(summary['tests'])}**", f"**{int(summary['pass'])} passed, {int(summary['fail'])} failed, 0 skipped; total duration {summary['duration_ms'] / 1000:.1f} s**"],
    ], widths=[1.7, 0.6, 4.2], font=9, align=["l", "c", "l"])
    para(doc, "The complete list of the 71 tests, as printed by the test runner, is in Appendix C.", align="justify")
    h2(doc, "15.4 Allocation scenarios (verified, fixed clock)")
    para(doc, "`npm run scenarios` runs the engine against hand-built situations and against three baseline rules: first-come-first-served, equal share of need (ignoring urgency) and strict priority (winner takes all). **Coverage** is the share of a camp’s approved quantity that it holds after the run.", align="justify")
    h3(doc, "Scenario 2: one water convoy for six camps (19,000 L for 48,400 L of demand)")
    wide = R[2][0]
    idx = [0, 1, 4, 5, 6, 7, 8, 9, 10]  # camp, urgency, waiting, needs, priority, RG, FCFS, equal, strict
    heads = ["Camp", "Urgency", "Waited", "Needs (L)", "Priority", "ReliefGrid", "First come", "Equal share", "Strict priority"]
    rows = [[r[i] for i in idx] for r in wide["rows"]]
    table_caption(doc, "Units / coverage per camp and method (Scenario 2)")
    table(doc, heads, rows, widths=[1.35, 0.7, 0.5, 0.65, 0.55, 0.7, 0.7, 0.7, 0.65], font=8, align=["l", "l", "r", "r", "r", "r", "r", "r", "r"])
    figure(doc, os.path.join(DIAG, "chart_methods.png"), "Coverage of each camp by allocation method (Scenario 2, verified)", max_height=4.3)
    summ = R[2][1]
    table_caption(doc, "Summary metrics by method (Scenario 2)")
    table(doc, [h.replace("*", "") for h in summ["head"]], summ["rows"], widths=[1.9, 0.8, 0.7, 0.8, 0.9, 0.6, 0.8], font=8.5, align=["l"] + ["r"] * 6)
    para(doc, "First-come-first-served gives the long-waiting low-urgency hostel everything it asked for while the Critical camp, which asked last, receives nothing. Equal sharing treats a Critical camp like a Low one. Strict priority serves the top request completely and leaves the three lowest-priority camps with nothing. ReliefGrid gives the Critical camp the largest share of what it needs (64%), every camp something (worst-off 14%) and rewards waiting. The Jain fairness index is highest for equal shares by construction; ReliefGrid deliberately trades some of it for priority, so it must be read together with the Critical and worst-off columns.", align="justify")
    h3(doc, "Scenario 3: extreme scarcity (30 insulin vials for 116 requested)")
    s3 = R[3][1]
    table_caption(doc, "Summary metrics by method (Scenario 3)")
    table(doc, [h.replace("*", "") for h in s3["head"]], s3["rows"], widths=[1.9, 0.8, 0.7, 0.8, 0.9, 0.6, 0.8], font=8.5, align=["l"] + ["r"] * 6)
    h3(doc, "Scenario 6: waiting is rewarded without overturning urgency")
    s6 = R[6][0]
    table_caption(doc, "Aging example (Scenario 6): 900 units for three requests of 1,000")
    table(doc, s6["head"], s6["rows"], widths=[1.9, 0.7, 0.8, 0.5, 0.7, 1.0, 0.9], font=8.5, align=["l"] + ["r"] * 6)
    h2(doc, "15.5 Seeded incident: end-to-end results")
    text = results_text()
    m = re.search(r"Current open demand: \*\*(\d+) request lines\*\*; \*\*(\d+) items are scarce\*\*", text)
    para(doc, f"The seed script replays three days of fictional operations through the real services (opening stock, wave of requests, two historical allocation runs, dispatches, partial deliveries and 231 distributions) and leaves 29 requests (178 request lines) in the system. At the fixed clock **{m.group(1)} request lines** are still open and **{m.group(2)} items are scarce**.", align="justify")
    table_caption(doc, "Stock versus open demand per item at the seeded state (verified)")
    table(doc, R[7][0]["head"], R[7][0]["rows"], widths=[2.1, 1.2, 1.3, 0.9, 1.0], font=8.5, align=["l", "r", "r", "r", "l"])
    table_caption(doc, "Packaged drinking water: a preview run over request lines that started from zero (verified)")
    table(doc, R[7][1]["head"], R[7][1]["rows"], widths=[2.4, 0.8, 0.7, 0.9, 0.9, 0.8], font=8.5, align=["l", "l", "r", "r", "r", "r"])
    figure(doc, os.path.join(DIAG, "chart_water.png"), "Coverage of drinking water by camp for the seeded incident (verified, fixed clock)", max_height=4.7)
    para(doc, "Critical camps end up between 91% and 97% covered, High camps at 56–59%, Moderate camps at 31–35% and Low camps at 14–16%, while no camp receives zero. Query q06 (Section 13.4.4) confirms the same ordering in the historical runs; in run 1 the average cumulative coverage was 0.922 for Critical, 0.527 for High, 0.305 for Moderate and 0.136 for Low request lines.", align="justify")
    m2 = re.search(r"Committing the run took \*\*(\d+) ms\*\* \(one transaction\): (\d+) shipments planned, ([\d,]+) units reserved\. Reserved stock \(([\d,]+)\) never exceeds stock on hand \(([\d,]+)\); integrity checks: \*\*(.+?)\*\*", text)
    callout(doc, f"**Commit of a full run (verified):** {m2.group(1)} ms in one transaction; {m2.group(2)} shipments planned; {m2.group(3)} units reserved; reserved stock ({m2.group(4)}) never exceeds stock on hand ({m2.group(5)}); integrity checks: {m2.group(6)}.", fill="EDF7ED", border="9CC99C", size=10)
    h2(doc, "15.6 Performance of the allocation engine")
    table_caption(doc, "Allocation engine timing on synthetic data (12 warehouses, 18 items)")
    table(doc, R[8][0]["head"], R[8][0]["rows"], widths=[1.4, 1.2, 2.4, 1.5], font=9, align=["r", "r", "r", "c"])
    para(doc, "Timings are for the pure engine on the machine described in Section 15.2 and will vary with hardware. Each item is solved independently in O(n²) in the number of its own request lines, so even thousands of open lines allocate in a small fraction of a second. These figures concern the algorithm only; database throughput was not load-tested.", align="justify")
    h2(doc, "15.7 Integrity results")
    bullets(doc, [
        "Query q15 over the four reconciliation views returned **zero problems** for ledger, reservations, allocations and camp stock on the seeded database.",
        "The integrity page in the running application reported “All 4 checks passed” after the full set of scripted UI operations (allocation commit, dispatch, partial delivery, new request, distribution), as shown in Appendix A.",
        "A test deliberately tampers with inventory and request counters and confirms that the reconciliation views detect it.",
    ])
    h2(doc, "15.8 Manual end-to-end verification in a browser")
    table_caption(doc, "Browser verification (manual and scripted)")
    table(doc, ["Area", "What was checked", "Result"], [
        ["Sign-in", "All four roles via demo shortcuts; sign-out; role-specific navigation", "Passed"],
        ["Dashboard", "KPIs, situation map with routes and critical markers, alerts, supply bars, donut, activity feed", "Passed"],
        ["Allocation", "Preview of 91 request lines; explanation expanded; confirmation; commit; run-detail page with shipment codes", "Passed"],
        ["Shipments", "Manager dispatch; volunteer claim and partial delivery (shortfall reported); admin cancellation with reason; trigger-written timeline", "Passed"],
        ["Requests", "Coordinator creates a request; planning-cap hint; trimmed quantity and reason on the request page", "Passed"],
        ["Distribution", "Record a distribution; an over-stock attempt is refused with the server’s message", "Passed"],
        ["Camps, Inventory, Analytics, Admin", "Camp grid and detail; warehouse tabs and ledger; charts; users table; settings edit changes the next preview; integrity check", "Passed"],
        ["Responsive layout", "375 px viewport: off-canvas navigation; no horizontal overflow on any of the nine pages (measured)", "Passed"],
    ], widths=[1.5, 4.2, 0.8], font=9, align=["l", "l", "c"])
    para(doc, "Defects found and fixed during this process: card grids rendering stray commas, a map whose bounds were distorted by a closed camp in another district, misaligned supply bars, a “Low” badge on items with no reorder level, a misleading “people served” label (now “aid servings”) and two charts that mixed incompatible units. Testing multi-round scenarios also exposed a real flaw in the first version of the algorithm (an already well-served request competed again as if it had nothing); the method was made deficit-aware and is now covered by tests.", align="justify")
    h2(doc, "15.9 Summary")
    table_caption(doc, "Summary of verified outcomes")
    table(doc, ["Claim", "Evidence", "Status"], [
        ["All automated tests pass", f"{int(summary['pass'])}/{int(summary['tests'])} passed in {summary['duration_ms'] / 1000:.1f} s", "Verified"],
        ["Stock cannot be over-allocated", "CHECK constraint, conditional update, 8-request concurrency test, fault-injection rollback", "Verified"],
        ["History is immutable", "Trigger tests on ledger, decisions, lines, events and audit log", "Verified"],
        ["Allocation follows priority and never starves a camp", "Property tests; Scenario 2 and seeded water results", "Verified"],
        ["Allocation is fair across rounds", "Deficit-awareness tests; Scenario 5", "Verified"],
        ["Database self-consistency", "q15 and the integrity page: zero problems", "Verified"],
        ["Responsive, role-aware interface", "Manual and scripted browser checks; screenshots", "Verified (manual)"],
        ["Behaviour under heavy multi-user load or on other browsers", "Not tested", "Not verified"],
    ], widths=[2.3, 3.2, 1.0], font=9, align=["l", "l", "c"])


# ======================================================================== 16, 17, references
def ch16_limitations(doc, ctx):
    h1(doc, "16. LIMITATIONS AND FUTURE ENHANCEMENTS")
    h2(doc, "16.1 Limitations")
    bullets(doc, [
        "**Single-writer database.** SQLite serialises writers. This gives simple, strong isolation and suits one control room, but it is not designed for many write-heavy nodes; the Node.js `node:sqlite` module is also marked experimental in Node 22.",
        "**Greedy sourcing.** Warehouses are chosen in priority order, nearest first; this is explainable but not a global minimum-distance assignment, and there are no vehicle capacities, road closures or real routing.",
        "**Items are rationed independently.** A camp’s very high priority for water does not trade off against its need for blankets.",
        "**Declared data are trusted.** Urgency, population and at-risk counts are entered by coordinators; the planning cap, audit trail and administrator overrides are safeguards, not proof of honesty.",
        "**Linear aging and vulnerability.** The forms are simple, tunable parameters and have not been calibrated against real operational outcomes.",
        "**Schematic map.** The situation map is offline and schematic (no map tiles); distances are straight-line estimates multiplied by a detour factor.",
        "**No notifications or file attachments;** no TLS termination (intended to sit behind a reverse proxy); login throttling is per process and held in memory.",
        "**Demonstration data only.** All data are fictional; planning standards are illustrative assumptions.",
        "**Testing gaps.** No automated browser tests, no load tests beyond the engine benchmark, no cross-browser or assistive-technology audit.",
    ])
    h2(doc, "16.2 Future enhancements")
    bullets(doc, [
        "Port the database layer to PostgreSQL (row-level locks with `SELECT ... FOR UPDATE`, trigger functions in PL/pgSQL) for multi-node deployment, and add read replicas for dashboards.",
        "Replace greedy sourcing with a minimum-cost flow that accounts for distance, vehicle capacity and road status, while keeping the explanation text.",
        "Integrate real map tiles and road routing, GPS tracking of shipments and offline-first mobile screens for volunteers.",
        "Add SMS/e-mail/push notifications for shortage alerts and delivery confirmations.",
        "Learn or calibrate urgency, aging and vulnerability weights from historical outcomes and expose a what-if simulator for administrators.",
        "Support cross-item trade-offs (bundles such as a family kit) and expiry-aware (first-expiry-first-out) allocation for perishable items.",
        "Add automated browser tests, accessibility audits and load tests; add multi-factor authentication and fine-grained audit export.",
        "Exchange data with government and NGO systems through documented APIs, with explicit provenance fields.",
    ])


def ch17_conclusion(doc, ctx):
    h1(doc, "17. CONCLUSION")
    para(doc, "ReliefGrid demonstrates how database design can make a high-stakes coordination problem safer and fairer. The project organises incidents, camps, warehouses, supply items, stock, requests, allocation decisions, shipments and distributions into a normalised relational model with 22 tables, 9 views, 21 triggers and 24 indexes. Constraints, triggers and reconciliation views move integrity from convention into the database: stock cannot be over-reserved, history cannot be rewritten, shipments cannot skip states, and derived figures can always be checked against the ledgers they come from.", align="justify")
    para(doc, "The allocation method turns urgency, camp population and vulnerability, waiting time and available stock into an explainable decision. By levelling cumulative coverage it stays fair across successive rounds, and by solving the fair level exactly it is deterministic and testable. Executing allocation, reservation, dispatch and delivery as single transactions with three layers of protection means that failures leave the database unchanged, and the immutable decision records mean that every outcome can be audited later.", align="justify")
    para(doc, "The verified results support these claims: all 71 automated tests pass; the reconciliation views report no problems; in the seeded shortage Critical camps receive about 91–97% of their drinking-water need, Low-urgency camps about 14–16% and no camp receives nothing; and the method outperforms first-come-first-served, equal sharing and strict priority on the metrics reported. The prototype’s limits — a single-writer embedded database, greedy sourcing, fictional data and no load or browser-automation testing — are stated openly, and the future-work list shows how each could be addressed. Overall, the project applies core DBMS concepts (modelling, normalisation, constraints, triggers, views, indexing, transactions and analytical SQL) to a real-world resource-allocation problem.", align="justify")


def references(doc, ctx):
    h1(doc, "REFERENCES")
    refs = [
        "SQLite Consortium. SQLite Documentation. https://www.sqlite.org/docs.html",
        "SQLite Consortium. Transaction control, including BEGIN IMMEDIATE. https://www.sqlite.org/lang_transaction.html",
        "SQLite Consortium. CREATE TRIGGER; Window Functions; Write-Ahead Logging. https://www.sqlite.org/lang_createtrigger.html, https://www.sqlite.org/windowfunctions.html, https://www.sqlite.org/wal.html",
        "Node.js Foundation. Node.js documentation: SQLite (`node:sqlite`), Crypto and the test runner. https://nodejs.org/api/",
        "Express. Express 5.x Documentation. https://expressjs.com/",
        "E. F. Codd. A Relational Model of Data for Large Shared Data Banks. Communications of the ACM, 13(6), 1970.",
        "R. Elmasri and S. B. Navathe. Fundamentals of Database Systems. Pearson.",
        "A. Silberschatz, H. F. Korth and S. Sudarshan. Database System Concepts. McGraw-Hill.",
        "D. Bertsekas and R. Gallager. Data Networks (2nd ed.), Prentice Hall, 1992 (max-min fair allocation).",
        "R. Jain, D.-M. Chiu and W. Hawe. A Quantitative Measure of Fairness and Discrimination for Resource Allocation in Shared Computer Systems. DEC Technical Report TR-301, 1984.",
        "C. Percival and S. Josefsson. The scrypt Password-Based Key Derivation Function. RFC 7914, IETF, 2016.",
        "The Sphere Association. The Sphere Handbook: Humanitarian Charter and Minimum Standards in Humanitarian Response (background for per-person planning standards; the standards used in ReliefGrid are illustrative). https://spherestandards.org/handbook/",
        "Project documentation prepared for ReliefGrid: README.md, docs/ARCHITECTURE.md, docs/DATABASE.md, docs/ALLOCATION.md, docs/RESULTS.md and docs/TESTING.md (October 2026).",
    ]
    for i, r in enumerate(refs, 1):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.35)
        p.paragraph_format.first_line_indent = Inches(-0.35)
        p.paragraph_format.space_after = Pt(4)
        add_runs(p, f"{i}.  {r}", size=10.5)
