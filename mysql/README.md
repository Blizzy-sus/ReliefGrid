# ReliefGrid in MySQL Workbench

The same database that the app keeps in SQLite, rebuilt for **MySQL 8.0.16 or newer** (earlier versions parse but ignore `CHECK` constraints):
22 tables, 9 views, 21 triggers, 24 indexes, 58 `CHECK` constraints and 38 foreign keys, plus the fictional demo incident (2,229 rows).

## Quick start (about one minute)

1. Open **MySQL Workbench** and connect to your local MySQL (usually *Local instance MySQL80*, `localhost:3306`).
2. **File → Open SQL Script…** and choose `reliefgrid_mysql_full.sql`.
3. Click the **lightning bolt** (Execute) to run the whole script. It creates the `reliefgrid` database and everything in it.
4. In the **Navigator → Schemas** panel click the refresh icon; expand `reliefgrid` to see Tables, Views and triggers.
5. Try it: open `06_showcase_queries.sql`, put the cursor inside a query and press **Ctrl+Enter**.

Re-running the script is safe: it drops and recreates the ReliefGrid tables (it never touches other databases).

## Files

| File | Purpose |
|---|---|
| `reliefgrid_mysql_full.sql` | everything below in one script (schema + reference data + demo data + views + triggers) |
| `01_schema.sql` | creates the `reliefgrid` database, all 22 tables, constraints and indexes |
| `02_reference_data.sql` | urgency levels (weights), allocation parameters, supply categories |
| `03_demo_data.sql` | the demo incident: 12 camps, 4 warehouses, 18 items, 22 users, 29 requests, 43 shipments, 231 distributions, ledger and audit rows |
| `04_views.sql` | the 9 views, including the 4 reconciliation views |
| `05_triggers.sql` | the 21 triggers (append-only history, shipment state machine, automatic timeline, business rules) |
| `06_showcase_queries.sql` | the 17 showcase queries (joins, windows, CTEs, subqueries) converted to MySQL |
| `07_constraint_demo.sql` | ten statements that the database must reject, plus a safe reservation transaction |
| `tools/export_demo_data.py` | regenerates `03_demo_data.sql` and the full script from the app's SQLite database |

Running the pieces separately: execute `01` → `02` → `03` (optional) → `04` → `05`. Load demo data **before** the triggers.

## Draw the EER diagram

*Database → Reverse Engineer…* → pick your connection → select the `reliefgrid` schema → **Next** through the wizard (tick *Place imported objects on a diagram*). Workbench draws the crow's-foot diagram with all 38 foreign keys; use *Arrange → Autolayout* if boxes overlap. *File → Save Model* keeps it as a `.mwb` you can export to PNG/PDF (*File → Export*).

## How it differs from the SQLite version

| SQLite (the app) | MySQL (this folder) |
|---|---|
| `INTEGER PRIMARY KEY`, `TEXT` timestamps | `INT AUTO_INCREMENT`, `DATETIME(3)`, `VARCHAR(n)` for text keys |
| `allocation_settings(key, value)` | `setting_key`, `setting_value` (`KEY` is a reserved word in MySQL) |
| partial index `idx_request_items_open ... WHERE allocated < approved` | stored generated column `is_open` + index `(is_open, item_id)` (verified: the planner uses it) |
| `RAISE(ABORT, msg)` in triggers | `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg` |
| `BEFORE UPDATE OF col` triggers | `BEFORE UPDATE` with an `IF` on the changed columns (MySQL has no per-column trigger events) |
| `MAX(a, b)`, `MIN(a, b)`, `julianday()`, `date(x,'+1 day')` | `GREATEST`, `LEAST`, `TIMESTAMPDIFF`, `DATE_ADD` |
| views filtering on a `SELECT` alias | wrapped in a derived table (MySQL does not allow aliases in `WHERE`) |
| `BEGIN IMMEDIATE` write lock | `START TRANSACTION` + row locks (`SELECT ... FOR UPDATE`) would be the equivalent when porting the service layer |

## What was verified

The full script was run on **MySQL 8.0.46** with the default strict `sql_mode` (the same one Workbench uses):
- it completes with no errors and produces 22 tables, 9 views, 21 triggers, 58 `CHECK` constraints and 38 foreign keys, with row counts identical to the SQLite database;
- all 17 queries in `06` run (12, 12, 7, 50, 12, 8, 60, 4, 12, 41, 3, 5, 0, 2, 4, 15 and 4 rows on the generated demo data; `q13` is legitimately empty);
- every statement in `07` is rejected with the message shown above it, and a legitimate dispatch/delivery writes its timeline rows through the triggers;
- the four reconciliation views return zero rows.

## Notes

- This is a **separate MySQL copy of the database**. The Node.js app still reads and writes SQLite; pointing it at MySQL would mean porting the transaction helper (`BEGIN IMMEDIATE`) and the date handling in `server/` (offered, not done).
- Workbench's **Safe Updates** mode (error 1175) is on by default; the statements in `07` use key columns in their `WHERE` clauses, so it does not interfere.
- The demo users' passwords are the app's scrypt hashes (`ReliefGrid@2026`), so they only work with the Node app, not as MySQL logins.
