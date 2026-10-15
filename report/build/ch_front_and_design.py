"""Cover, front matter and chapters 1-10 of the ReliefGrid report."""
import os
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx_helpers import *  # noqa
from report_data import ASSETS, load_json

DIAG = os.path.join(ASSETS, "diagrams_small")
PLACEHOLDER = "[TO BE FILLED]"


def cover(doc, ctx):
    p = para(doc, "", align="center", space_after=10)
    p.add_run().add_picture(os.path.join(ASSETS, "vit_logo.png"), width=Inches(3.4))
    para(doc, "", space_after=4)
    para(doc, "RELIEFGRID", bold=True, size=24, align="center", space_after=4)
    para(doc, "Every Camp. Every Supply. Fairly Shared.", italic=True, size=13, align="center", space_after=22)
    para(doc, "DISASTER RELIEF RESOURCE ALLOCATION SYSTEM", bold=True, size=15, align="center", space_after=18)
    para(doc, "DATABASE SYSTEMS — DIGITAL ASSIGNMENT II", bold=True, size=14, align="center", space_after=18)
    kv_table(doc, [
        ("Course Code:", "BCSE302L"),
        ("Submitted by:", "ABHISHEK KANDAVEL"),
        ("Register Number:", "24BCE5424"),
        ("Programme:", "B.Tech — Computer Science and Engineering"),
        ("Campus:", "VIT Chennai"),
        ("Faculty:", "PARVATHY AK"),
        ("Academic Year:", "2026–2027"),
        ("Database Engine:", f"SQLite {ctx['schema']['sqlite_version']} (embedded; Node.js 22 `node:sqlite`)"),
    ])


def front_matter(doc, ctx):
    stats = ctx["stats"]
    front_heading(doc, "DECLARATION")
    para(doc, "I hereby declare that this report, titled “ReliefGrid — Disaster Relief Resource Allocation System”, has been prepared by me for the Database Systems Digital Assignment II. It documents the database design, relational model, allocation methodology, data-integrity controls, transaction handling, application modules and verification results of the application that I designed and implemented.", align="justify", size=10.5, space_after=5)
    para(doc, "All places, organisations and people that appear in the application and in this report (for example the “Cauvery Delta Floods 2026” incident, the relief camps, warehouses and user names) are **fictional demonstration data**. They are not official disclosures and do not describe any real emergency. Test counts, query outputs, allocation results and screenshots in this report were produced by running the submitted application and its test suite; Appendix B lists the commands used to reproduce them.", align="justify", size=10.5, space_after=5)
    front_heading(doc, "ACKNOWLEDGEMENT")
    para(doc, "I would like to thank my course faculty, Parvathy AK, and the Database Systems faculty at VIT for the opportunity to apply relational database concepts to a socially relevant problem, and for the guidance on design, normalisation and transaction processing that shaped this work. I also acknowledge the open-source projects on which the implementation relies, namely Node.js (including its built-in SQLite module), SQLite and the Express web framework, together with the published research on fair resource allocation that informed the allocation method.", align="justify", size=10.5, space_after=5)
    front_heading(doc, "ABSTRACT")
    para(doc, "I developed ReliefGrid to help relief organisations coordinate scarce supplies during floods, cyclones and similar emergencies. When requests from relief camps exceed warehouse stock, ad-hoc coordination tends to reward whoever asks first, can promise the same stock twice and leaves no explanation for those who receive less than they need. ReliefGrid addresses this with a relational database linking camps, warehouses, supply items, inventory, requests, allocation decisions, shipments and distributions, and with a priority-based allocation engine whose every decision is recorded and explained.", align="justify", size=10.5, space_after=5)
    para(doc, f"The database is implemented in SQLite with {len(ctx['schema']['tables'])} tables, {len(ctx['schema']['views'])} views, {len(ctx['schema']['triggers'])} triggers and {len(ctx['schema']['indexes'])} indexes, created by four checksum-verified migrations. Integrity is enforced inside the database: check constraints make over-reservation of stock impossible, triggers keep the ledger, allocation history and audit log append-only and enforce a shipment state machine, and reconciliation views prove that inventory equals its replayed ledger. A Node.js and Express backend exposes {ctx['route_count']} role-protected REST endpoints, and a browser interface provides dashboards, a situation map, explained allocation previews, shipment tracking and analytics.", align="justify", size=10.5, space_after=5)
    para(doc, "The allocation method scores every open request line by urgency, the share of at-risk residents and waiting time, and then raises each line to a coverage proportional to its score (capped at 100%) using an exact piecewise-linear solution that is also aware of what earlier runs already delivered. Allocation, reservation, dispatch and delivery run as single atomic transactions. The report documents the design, normalisation, SQL, testing (71 automated tests, all passing) and measured results, and states the limitations of the prototype.", align="justify", size=10.5, space_after=5)
    front_heading(doc, "KEYWORDS")
    para(doc, "Relational Database, SQLite, ER Model, Normalization, Referential Integrity, Transactions, Concurrency Control, Triggers, Views, Disaster Relief, Resource Allocation, Max-Min Fairness, Node.js, Express.", align="justify", size=10.5, space_after=5)


def toc_page(doc):
    front_heading(doc, "TABLE OF CONTENTS").paragraph_format.page_break_before = True
    p = doc.add_paragraph()
    add_field(p, 'TOC \\o "1-2" \\h \\z \\u', "Right-click and choose Update Field to build the table of contents.", dirty=True)
    front_heading(doc, "LIST OF FIGURES").paragraph_format.page_break_before = True
    p = doc.add_paragraph()
    add_field(p, 'TOC \\h \\z \\c "Figure"', "Update field to build the list of figures.", dirty=True)
    para(doc, "", space_after=8)
    front_heading(doc, "LIST OF TABLES")
    p = doc.add_paragraph()
    add_field(p, 'TOC \\h \\z \\c "Table"', "Update field to build the list of tables.", dirty=True)


# ======================================================================== chapters 1-10
def chapters_1_to_5(doc, ctx):
    S = ctx["schema"]
    h1(doc, "1. INTRODUCTION")
    para(doc, "Floods and cyclones displace thousands of people within hours. They move into schools, community halls and shelters that become temporary relief camps, while food, drinking water, medicines and shelter materials are held in a small number of warehouses. The difficult part of the response is rarely the existence of supplies; it is deciding, quickly and defensibly, how limited supplies should be shared among many camps whose size, vulnerability and urgency differ, and then tracking those supplies to the people who need them.", align="justify")
    para(doc, "ReliefGrid — Disaster Relief Resource Allocation System — is a full-stack web application that gives relief camps, warehouses, administrators and volunteers one shared, consistent picture of needs and stock. Camps submit supply requests with an urgency level; warehouses maintain inventory; and an allocation engine decides how much of each scarce item each request receives, from which warehouse, and why. The decision is turned into shipments that are dispatched, delivered and finally distributed to residents, with every step recorded.", align="justify")
    para(doc, "From a Database Management Systems perspective the project demonstrates entity modelling, primary and foreign keys, normalisation and deliberate denormalisation, check and unique constraints, triggers, views, partial and composite indexes, versioned schema migrations, transaction-safe updates with explicit concurrency control, reconciliation queries and a range of analytical SQL (joins, window functions, recursive common table expressions and correlated subqueries). It also illustrates why auditability and integrity matter more than raw features in a system that allocates life-sustaining supplies.", align="justify")

    h1(doc, "2. PROBLEM STATEMENT")
    para(doc, "During an emergency, demand for a supply item frequently exceeds what the warehouses hold. Coordinating the response with spreadsheets, telephone calls and messaging groups creates several recurring risks:", align="justify")
    bullets(doc, [
        "**Unfair outcomes.** First-come-first-served rewards whoever called first, not whoever needs the item most; a camp with many children, elderly residents or a critical medical need may receive nothing while an earlier, less urgent request is filled completely.",
        "**Double-booking of stock.** Two coordinators can be promised the same units at the same time because the stock figure they saw was out of date.",
        "**Over-claiming.** Requests are not checked against any per-person planning standard, so inflated requests distort shares.",
        "**Loss of fairness over time.** A camp served generously in one round competes again in the next as if it had received nothing.",
        "**No explanation or trail.** Camps that receive less than they asked for cannot see why, and administrators cannot later audit who decided what, using which numbers.",
        "**Weak delivery tracking.** Goods lost or damaged in transit are not fed back into the demand picture.",
    ])
    para(doc, "The problem addressed by ReliefGrid is therefore to design and implement a relational data repository and web application that (i) records camps, warehouses, stock, requests and deliveries consistently; (ii) allocates scarce supplies by a clearly defined, fair and explainable rule; (iii) makes over-allocation impossible and preserves an immutable decision history; and (iv) lets each class of user do only what their role allows.", align="justify")

    h1(doc, "3. OBJECTIVES AND SCOPE")
    h2(doc, "3.1 Objectives")
    bullets(doc, [
        "Design a normalised relational schema for incidents, camps, warehouses, supply items, inventory, requests, allocation decisions, shipments, camp stock and distributions.",
        "Use primary keys, foreign keys, unique and check constraints, triggers and indexes to protect integrity and support efficient retrieval.",
        "Design a priority-based allocation method that considers urgency, camp population and vulnerability, waiting time and available stock, and that remains fair across successive allocation rounds.",
        "Make stock reservation, dispatch, delivery and cancellation transaction-safe so that stock can never be over-allocated and the ledger always reconciles.",
        "Keep an auditable, append-only history of stock movements, allocation decisions, shipment status changes and user actions.",
        "Provide authentication and role-based access control for administrators, warehouse managers, camp coordinators and volunteers.",
        "Expose the data through a REST API and a responsive browser interface with dashboards, shortage alerts and analytics.",
        "Validate the system with automated tests and realistic scenarios, and report limitations honestly.",
    ])
    h2(doc, "3.2 Scope")
    para(doc, "The implemented scope is a working prototype for a single incident region. It includes managing camps, warehouses, items and inventory; submitting and reviewing supply requests; previewing and committing allocation runs; planning, dispatching, delivering and cancelling shipments; recording distributions at camps; dashboards, alerts and analytics; user and settings administration; an audit trail and database self-checks.", align="justify")
    para(doc, "The application is not a production emergency-management system. It does not integrate with real government or NGO data feeds, route vehicles on real road networks, send SMS or e-mail notifications or support multi-site database replication. All demonstration data are fictional (Chapter 16 discusses limitations in detail).", align="justify")

    h1(doc, "4. EXISTING SYSTEM AND PROPOSED SYSTEM")
    h2(doc, "4.1 Existing coordination practice")
    para(doc, "In many relief operations coordination relies on a mixture of spreadsheets, phone calls, messaging groups and paper registers. This is flexible and quick to start, but it does not enforce any consistency between what a warehouse holds, what has been promised and what has been delivered. Prioritisation is manual and typically not recorded, and there is no systematic feedback from deliveries into outstanding demand. The comparison below is a general characterisation of ad-hoc coordination, not a description of any specific organisation.", align="justify")
    h2(doc, "4.2 Proposed system")
    para(doc, "ReliefGrid replaces ad-hoc coordination with a normalised relational repository and a web interface in which every quantity has an owner and a state. Stock that has been promised to a planned shipment is tracked separately from stock physically present; an allocation engine applies one documented rule to all requests; and database constraints, triggers and reconciliation views prevent and detect inconsistencies.", align="justify")
    table_caption(doc, "Ad-hoc coordination compared with ReliefGrid")
    table(doc, ["Aspect", "Ad-hoc coordination (typical)", "ReliefGrid"], [
        ["Stock visibility", "Separate spreadsheets; may be stale", "Single inventory with on-hand, reserved and available quantities per warehouse"],
        ["Prioritisation", "Manual judgement, rarely recorded", "Score from urgency, at-risk share and waiting time, stored with each decision"],
        ["Over-allocation", "Possible: same stock promised twice", "Prevented by transactions, conditional updates and a table CHECK constraint"],
        ["Fairness over time", "A well-served camp competes again as if new", "Deficit-aware: cumulative coverage is levelled across rounds"],
        ["Explanation", "Usually none", "Plain-language explanation per request line, visible to the camp"],
        ["Over-claiming", "Unchecked", "Approved quantity capped by a per-person planning standard"],
        ["Delivery tracking", "Calls and messages", "Shipment life-cycle with automatic timeline; short deliveries return to the queue"],
        ["Traceability", "Edits overwrite history", "Append-only stock ledger, allocation history and audit log (trigger-enforced)"],
        ["Access control", "Shared files and groups", "Four roles with scope limits, enforced in the API and by database constraints"],
        ["Integrity checks", "Manual reconciliation", "Four reconciliation views that must return zero rows"],
    ], widths=[1.35, 2.2, 2.95], font=9.5, bold_first_col=True)

    h1(doc, "5. REQUIREMENTS AND TECHNOLOGY STACK")
    h2(doc, "5.1 Functional requirements")
    bullets(doc, [
        "The system shall manage incidents, relief camps (with population and at-risk counts), warehouses, supply items and per-warehouse inventory.",
        "Camp coordinators shall submit requests with an urgency level and item quantities; quantities shall be approved against a per-person planning standard where one exists.",
        "Administrators shall be able to preview an allocation without changing data and then commit it; the system shall generate shipments and reserve stock in the same transaction.",
        "Warehouse managers shall dispatch and cancel planned shipments; volunteers and coordinators shall confirm deliveries, recording any shortfall.",
        "Camp coordinators shall record distributions to residents; camp stock shall never become negative.",
        "The system shall provide dashboards, a situation map, shortage, SLA, low-stock and delay alerts, and analytics.",
        "The system shall authenticate users and restrict every operation by role and scope, and shall record an audit trail.",
        "Administrators shall be able to tune urgency weights and allocation parameters and run database integrity checks.",
    ])
    h2(doc, "5.2 Non-functional requirements")
    bullets(doc, [
        "**Data integrity:** impossible states (negative or over-reserved stock, invalid transitions, orphan references) are rejected by the database itself.",
        "**Atomicity and isolation:** multi-step operations succeed or fail as a whole and cannot interleave unsafely.",
        "**Traceability:** history is append-only and every decision can be reproduced from stored parameters.",
        "**Maintainability:** schema changes are versioned migrations; the allocation algorithm is isolated as pure, unit-testable code.",
        "**Security:** salted password hashing, hashed session tokens, prepared statements, input validation, security headers and login throttling.",
        "**Usability:** responsive interface in light and dark themes, clear status and urgency indicators, and explanations written in plain language.",
        "**Portability:** one command to set up and run on a developer machine, with no database server to install.",
    ])
    h2(doc, "5.3 Technology stack")
    table_caption(doc, "Technology stack")
    table(doc, ["Layer", "Technology", "Purpose"], [
        ["Database", f"SQLite {S['sqlite_version']} via Node.js built-in `node:sqlite`", "Relational storage with constraints, triggers, views, partial indexes, window functions and CTEs; WAL journal"],
        ["Migrations", "Custom runner + SQL files", "Ordered, checksum-verified schema changes; refuses to run if an applied file was edited"],
        ["Backend", "Node.js 22, Express 5", "REST API, authentication middleware, role and scope guards"],
        ["Business logic", "Service modules (JavaScript)", "One function per operation; each runs in one transaction"],
        ["Allocation engine", "Pure JavaScript module", "Priority scoring, exact fair-level solver, rounding, warehouse sourcing, explanations"],
        ["Security", "Node `crypto` (scrypt, SHA-256)", "Password hashing; hashed bearer-token sessions"],
        ["Frontend", "Vanilla ES modules, HTML, CSS", "Single-page application with auto-escaping templates; no build step"],
        ["Charts and map", "Hand-written SVG", "Offline analytics charts and situational map"],
        ["Testing", "`node:test`, scenario harness", f"{ctx['n_tests']} automated tests; baseline comparisons and performance benchmark"],
    ], widths=[1.3, 2.35, 2.85], font=9.5, bold_first_col=True, pad=30)
    h2(doc, "5.4 Users, roles and permissions")
    para(doc, "Four roles are defined. Camp coordinators and warehouse managers are bound to a single camp or warehouse by a database CHECK constraint on the users table; every API route additionally checks that scope.", align="justify")
    table_caption(doc, "Role-based permissions (as implemented)")
    table(doc, ["Capability", "Admin", "Warehouse manager", "Camp coordinator", "Volunteer"], [
        ["View dashboards, requests, shipments, inventory, camps, analytics, allocation history", "Yes", "Yes", "Yes", "Yes"],
        ["Create / cancel a supply request; raise urgency", "Yes", "—", "Own camp", "—"],
        ["Lower urgency; override approved quantity", "Yes", "—", "—", "—"],
        ["Preview and commit allocation; edit allocation settings", "Yes", "—", "—", "—"],
        ["Receive / adjust stock; set reorder level", "Yes", "Own warehouse", "—", "—"],
        ["Assign volunteer, dispatch or cancel a planned shipment", "Yes", "Own warehouse", "—", "—"],
        ["Claim an unassigned shipment", "—", "—", "—", "Yes"],
        ["Confirm delivery of a shipment", "Yes", "—", "Receiving camp", "Assigned"],
        ["Record distribution to residents", "Yes", "—", "Own camp", "—"],
        ["Update camp census (population, at-risk)", "Yes", "—", "Own camp", "—"],
        ["Manage users, audit trail, integrity checks, camp status", "Yes", "—", "—", "—"],
    ], widths=[2.9, 0.6, 1.0, 1.0, 1.0], font=9, align=["l", "c", "c", "c", "c"], pad=30, keep=True)


def chapters_6_to_10(doc, ctx):
    S = ctx["schema"]
    info = S["info"]
    h1(doc, "6. SYSTEM ARCHITECTURE AND METHODOLOGY")
    h2(doc, "6.1 High-level architecture")
    para(doc, "The architecture separates presentation, application logic, the pure allocation engine and persistence. The browser talks only to the REST API using a bearer token. Routes perform authentication, role and scope checks and input parsing; services contain the business operations and open one transaction per operation; the allocation engine contains no input/output at all, so it can be tested with randomised scenarios in milliseconds. The database enforces integrity independently of the application code.", align="justify")
    figure(doc, os.path.join(DIAG, "architecture.png"), "ReliefGrid system architecture (presentation, application and data layers)", max_height=4.9)
    h2(doc, "6.2 Methodology")
    numbered(doc, [
        "**Problem analysis:** identify actors (camps, warehouses, administrators, volunteers), the supplies they exchange and the failure modes of manual coordination (Chapter 2).",
        "**Schema design:** model entities and relationships, choose keys and optional relationships, decide where counters are stored and how they are reconciled (Chapters 7–10).",
        "**Allocation design:** define the priority score and a fairness rule, prove its properties and implement it as a pure module (Chapter 11).",
        "**Implementation:** write four ordered SQL migrations (schema, views, triggers, reference data), a migration runner and a transaction helper.",
        "**Services and API:** implement one service function per business operation, then the routes with role and scope guards (Chapters 12 and 14).",
        "**Seed scenario:** replay three days of fictional operations through the real services with an injected clock so that ledgers, counters and the audit log are genuinely consistent.",
        "**Frontend:** build the single-page application (nine modules) on top of the API.",
        "**Verification:** unit, property, database, API and scenario tests; baseline comparison; manual end-to-end checks in a browser (Chapter 15).",
    ])
    h2(doc, "6.3 Data flow")
    para(doc, "A coordinator creates a request; the service computes an approved quantity for each line from the camp’s population and the item’s planning standard and stores request and lines in one transaction. An administrator previews an allocation: the engine reads open demand (view `v_open_demand`) and available stock and returns decisions without writing anything. On commit, the same computation is repeated inside a write transaction and its result is persisted: an allocation run, one decision per line (with the score components and an explanation), allocation lines (which warehouse supplies how much), planned shipments, shipment lines, stock reservations and ledger rows.", align="justify")
    para(doc, "A warehouse manager dispatches a shipment, which converts reserved stock into stock that has left the warehouse. A volunteer or coordinator confirms delivery, entering what actually arrived; camp stock increases, request counters are updated and any shortfall becomes open demand again. Finally the coordinator records distributions to residents, which decrease camp stock. The front end never touches SQL; it only consumes the JSON API.", align="justify")
    h2(doc, "6.4 Sequence of a committed allocation")
    figure(doc, os.path.join(DIAG, "commit_sequence.png"), "Sequence of interactions when an allocation run is committed", max_height=4.9)

    # ---------------------------------------------------------------- 7 database design
    h1(doc, "7. DATABASE DESIGN")
    para(doc, f"The database is organised into {len(S['tables'])} application tables in seven groups. Each table has a primary key; foreign keys connect related concepts, while nullable foreign keys represent genuinely optional relationships such as a shipment that has no assigned volunteer yet. The schema is created by the four migration files in `db/migrations` and is identical for the application, the tests and the seed script.", align="justify")
    table_caption(doc, "Table groups and their responsibilities")
    table(doc, ["Group", "Tables", "Responsibility"], [
        ["Reference data", "urgency_levels, supply_categories, supply_items, allocation_settings", "Urgency weights and target hours, item catalogue with per-person planning standards, tunable allocation parameters"],
        ["Places and people", "disasters, camps, warehouses, users, sessions", "Incidents, camps with population and at-risk counts, warehouses with coordinates, role-scoped users and hashed sessions"],
        ["Demand", "requests, request_items", "Requests with urgency; lines carry requested, approved, allocated and delivered quantities"],
        ["Warehouse stock", "inventory, stock_movements", "Current on-hand and reserved quantities per warehouse and item; append-only ledger that replays to them"],
        ["Allocation decisions", "allocation_runs, allocation_decisions, allocation_lines", "Immutable record of each run: parameters, inputs, scores, outcome, explanation and source warehouses"],
        ["Logistics", "shipments, shipment_items, shipment_events, camp_stock, distributions", "Shipments and their lines, trigger-written timeline, stock at camps and aid handed out"],
        ["Audit", "audit_log", "Append-only record of state-changing actions"],
    ], widths=[1.25, 2.35, 2.9], font=9.5, bold_first_col=True)
    h2(doc, "7.1 Reserved versus on-hand stock")
    para(doc, "Allocation is a *plan*; stock physically leaves a warehouse only at dispatch. The inventory table therefore keeps two counters per warehouse and item: `quantity_on_hand` and `quantity_reserved`, and defines availability as their difference. A reservation is made when an allocation run is committed, released if the shipment is cancelled and converted into a dispatch (both counters decrease together) when the shipment leaves. The table-level constraint `CHECK (quantity_reserved <= quantity_on_hand)` guarantees that no sequence of operations, however buggy, can promise more than exists.", align="justify")
    h2(doc, "7.2 Immutable decision records")
    para(doc, "Each allocation decision stores the inputs that produced it: the approved and previously allocated quantities, the remaining need, the network supply and demand for the item, and the urgency, vulnerability and aging factors. These values change over time, so they are deliberately copied into the decision, and database triggers forbid updates and deletes. This makes every decision explainable and auditable long after the underlying request lines have moved on.", align="justify")
    h2(doc, "7.3 Primary keys and foreign keys")
    para(doc, "All tables use integer primary keys, except association tables whose key is naturally composite (`inventory` and `camp_stock`) and `sessions` and `allocation_settings`, which use natural text keys. Foreign keys are declared everywhere and enforced on every connection (`PRAGMA foreign_keys = ON`). Deletes are restricted by default; only `sessions` (when a user is removed) and `request_items` (when a request is removed) cascade.", align="justify")
    table_caption(doc, "Principal relationships and their integrity role")
    table(doc, ["Relationship", "Meaning", "Integrity role"], [
        ["disasters → camps", "A camp belongs to one incident", "Closed incidents drop out of allocation"],
        ["camps → requests → request_items", "A camp raises requests; a request has item lines", "No orphan lines; lines cascade with their request"],
        ["supply_items → request_items / inventory / camp_stock", "Every quantity refers to a catalogue item", "Units and planning standards come from one place"],
        ["warehouses + supply_items → inventory", "One stock row per warehouse and item (composite key)", "No duplicate stock rows; target of ledger foreign key"],
        ["inventory → stock_movements", "Each ledger row refers to an existing stock line", "Ledger cannot refer to stock that does not exist"],
        ["allocation_runs → allocation_decisions → allocation_lines", "A run has decisions; a decision has sources", "History is queryable in both directions"],
        ["request_items → allocation_decisions / shipment_items", "A line is considered in runs and fulfilled by shipments", "Counters on the line can be reconciled against shipments"],
        ["warehouses, camps → shipments", "A shipment goes from one warehouse to one camp", "Shipment routes are always valid places"],
        ["shipments → shipment_items / shipment_events", "Contents and timeline of a shipment", "Timeline rows exist only for real shipments"],
        ["camp_stock → distributions", "Aid handed out is taken from stock held at the camp", "A distribution can only refer to stock the camp holds"],
        ["users → camps / warehouses", "Coordinators and managers are scoped to one place", "Scope enforced by a CHECK on the users table"],
    ], widths=[2.2, 2.3, 2.0], font=9)

    # ---------------------------------------------------------------- 8 ER model
    h1(doc, "8. ENTITY–RELATIONSHIP MODEL")
    para(doc, "The ER model captures the principal entities and relationships of the implemented schema. The diagram in Section 8.2 was generated by a script from the live schema (`PRAGMA table_info` and `PRAGMA foreign_key_list`), so it cannot drift from the migrations. Entities are coloured by group, connectors by the table they reference.", align="justify")
    callout(doc, "**Modelling note.** Cardinalities describe what the schema permits. A foreign key from `camps` to `disasters` guarantees that each camp references an existing incident; it does not require every incident to have a camp. Six actor columns (`user_id`, `actor_id`, `run_by`, `distributed_by`, `last_actor_id` and similar) also reference `users`; they are omitted from the diagram only for readability.")
    h2(doc, "8.1 Main entities")
    ENT = [
        ("disasters", "An incident that groups camps", "id, name, type, status, started_at"),
        ("camps", "A relief camp", "id, disaster_id, name, capacity, population, vulnerable_count, status"),
        ("warehouses", "A depot holding supplies", "id, name, latitude, longitude, status"),
        ("users / sessions", "Accounts with a role and scope; hashed login sessions", "id, username, role, camp_id, warehouse_id / token_hash, expires_at"),
        ("urgency_levels", "Urgency labels with weight and target hours", "level, label, weight, sla_hours"),
        ("supply_categories / supply_items", "Catalogue of supplies", "id, category_id, name, unit, standard_per_person_per_day"),
        ("allocation_settings", "Tunable method parameters", "key, value, description"),
        ("requests", "A camp’s supply request", "id, camp_id, requested_by, urgency, status, created_at"),
        ("request_items", "A requested item with four counters", "id, request_id, item_id, quantity_requested / approved / allocated / delivered"),
        ("inventory", "Stock of an item in a warehouse", "warehouse_id, item_id, quantity_on_hand, quantity_reserved, reorder_level"),
        ("stock_movements", "Append-only stock ledger", "id, warehouse_id, item_id, movement_type, delta_on_hand, delta_reserved"),
        ("allocation_runs", "A committed allocation run", "id, run_by, params_json, requests_considered, units_allocated"),
        ("allocation_decisions", "Decision for one request line in a run", "id, run_id, request_item_id, priority_score, allocated_qty, explanation"),
        ("allocation_lines", "Which warehouse supplies a decision, and how much", "id, decision_id, shipment_id, warehouse_id, quantity, distance_km"),
        ("shipments", "Movement from one warehouse to one camp", "id, code, warehouse_id, camp_id, status, volunteer_id, eta"),
        ("shipment_items / shipment_events", "Lines and status timeline of a shipment", "shipment_id, request_item_id, quantity, quantity_received / status, actor_id, created_at"),
        ("camp_stock / distributions", "Stock at a camp; aid handed out", "camp_id, item_id, quantity / quantity, people_served"),
        ("audit_log", "Append-only action log", "id, user_id, action, entity_type, entity_id, created_at"),
    ]
    table_caption(doc, "Entities and representative attributes")
    table(doc, ["Entity", "Purpose", "Representative attributes"], [list(r) for r in ENT], widths=[1.6, 2.1, 2.8], font=9, bold_first_col=True)


def er_cardinality(doc, ctx):
    h2(doc, "8.3 Cardinality summary")
    bullets(doc, [
        "One incident has many camps; each camp references exactly one incident.",
        "One camp raises many requests; one request contains one or more request lines; each line refers to one catalogue item (unique per request).",
        "One warehouse holds many inventory rows (one per item); each inventory row has many ledger entries.",
        "One allocation run has many decisions; each decision refers to exactly one request line and has zero or more allocation lines (zero when nothing could be allocated).",
        "One shipment has one or more lines and a timeline of events; it goes from exactly one warehouse to exactly one camp and may have zero or one volunteer.",
        "One request line can be supplied by several shipments (different warehouses), and one shipment can carry lines for several requests of the same camp.",
        "A user is optionally scoped to one camp or one warehouse, depending on role.",
    ])



def er_section(doc, ctx):
    h2(doc, "8.2 ER diagram")
    figure(doc, os.path.join(DIAG, "er_diagram.png"), f"Entity-relationship diagram of the implemented schema ({len(ctx['schema']['tables'])} tables, {ctx['er_edges']} drawn relationships)", width=9.6, max_height=6.3)


def chapters_9_10(doc, ctx):
    S = ctx["schema"]
    info = S["info"]
    sc = ctx["schema_json"]
    h1(doc, "9. RELATIONAL SCHEMA AND DATA DICTIONARY")
    para(doc, "The relational notation below is generated directly from the migrated database. PK denotes primary key and FK denotes foreign key (with the referenced table). Types follow SQLite affinity rules; exact nullability, defaults and constraints are listed in the data dictionary for the principal tables and can be read in full from `db/migrations/001_core_schema.sql`.", align="justify")
    rows = []
    for t in S["tables"]:
        fkmap = {}
        for fk in info[t]["fks"]:
            fkmap[fk["from_"]] = fk["table"]
        parts = []
        for c in info[t]["cols"]:
            tag = []
            if c["pk"]:
                tag.append("PK")
            if c["name"] in fkmap:
                tag.append(f"FK→{fkmap[c['name']]}")
            parts.append(c["name"] + (f" ({', '.join(tag)})" if tag else ""))
        rows.append([t.upper(), ", ".join(parts)])
    table_caption(doc, "Relational schema (all tables)")
    table(doc, ["Relation", "Attributes"], rows, widths=[1.6, 4.9], font=8.5, bold_first_col=True)
    h2(doc, "9.1 Table responsibilities")
    para(doc, "`request_items` is the central demand table: its four counters record how much was asked, approved, promised and received. `inventory` and `stock_movements` form a balance-and-ledger pair, and `shipments`/`shipment_items` connect demand to stock. `allocation_runs`, `allocation_decisions` and `allocation_lines` are the permanent memory of every allocation. `camp_stock` and `distributions` close the loop at the camp. The remaining tables provide reference data, identity and audit.", align="justify")
    h2(doc, "9.2 Data dictionary of the principal tables")
    DICT = {
        "inventory": {
            "warehouse_id": "Part of the composite primary key; references warehouses",
            "item_id": "Part of the composite primary key; references supply_items",
            "quantity_on_hand": "Physically in the warehouse. CHECK >= 0",
            "quantity_reserved": "Promised to PLANNED shipments. CHECK >= 0 and <= quantity_on_hand",
            "reorder_level": "Alert threshold; 0 means none. CHECK >= 0",
            "updated_at": "ISO-8601 UTC timestamp",
        },
        "request_items": {
            "id": "Surrogate primary key",
            "request_id": "Parent request; ON DELETE CASCADE; UNIQUE with item_id",
            "item_id": "Catalogue item",
            "quantity_requested": "What the camp asked for. CHECK > 0",
            "quantity_approved": "After the planning-standard cap. CHECK <= requested",
            "quantity_allocated": "Reserved, in transit or delivered. CHECK <= approved",
            "quantity_delivered": "Confirmed received. CHECK <= allocated",
            "approval_note": "Reason when the quantity was trimmed or overridden",
        },
        "allocation_decisions": {
            "run_id": "Run that made the decision; UNIQUE with request_item_id",
            "request_item_id": "The request line considered",
            "approved_qty / prior_qty / need_qty": "Snapshot; CHECK approved = prior + need",
            "item_supply / item_demand": "Network stock and open demand for the item in this run",
            "urgency_weight / vulnerability_factor / aging_factor": "The three components of the score",
            "priority_score": "Product of the three factors",
            "allocated_qty": "Units granted now. CHECK <= need_qty",
            "scarce": "1 when stock was short for the item",
            "explanation": "Plain-language reasoning shown to users",
        },
        "shipments": {
            "code": "UNIQUE human-readable code (SHP-00001 ...)",
            "run_id": "Allocation run that planned it (NULL for manual shipments)",
            "warehouse_id / camp_id": "Origin and destination",
            "status": "CHECK in PLANNED, IN_TRANSIT, DELIVERED, CANCELLED; transitions enforced by trigger",
            "volunteer_id": "Nullable until a volunteer is assigned",
            "distance_km": "Estimated road distance. CHECK >= 0",
            "dispatched_at / eta / delivered_at": "Nullable timestamps filled as the shipment progresses",
            "status_changed_at / last_actor_id / last_note": "Context the trigger copies into shipment_events",
        },
    }
    for tname, notes in DICT.items():
        h3(doc, tname)
        cols = {c["name"]: c for c in info[tname]["cols"]}
        rows = []
        for key, note in notes.items():
            first = key.split(" / ")[0]
            c = cols.get(first)
            typ = c["type"] if c else "INTEGER"
            if " / " in key:
                typ = "INTEGER / " + "INTEGER"
            null = "NOT NULL" if (c and c["notnull"]) or (c and c["pk"]) else "NULL"
            rows.append([key.replace(" / ", ",\n"), typ if " / " not in key else typ.split(" / ")[0], null, note])
        table(doc, ["Column", "Type", "Null?", "Meaning and constraints"], rows, widths=[1.7, 0.8, 0.8, 3.2], font=8.5)
    h2(doc, "9.3 Indexes")
    PURPOSE = {
        "idx_audit_created": "Chronological audit listing", "idx_audit_entity": "Audit entries of one entity",
        "idx_camps_disaster_status": "Camps of an incident by status", "idx_decisions_request_item": "Decision history of a request line",
        "idx_decisions_run": "All decisions of a run", "idx_distributions_camp": "Distributions of a camp over time",
        "idx_distributions_item": "Distributions of an item", "idx_inventory_item": "Stock of an item across warehouses",
        "idx_lines_decision": "Sources of a decision", "idx_lines_shipment": "Allocation lines of a shipment",
        "idx_movements_ref": "Ledger rows caused by a run or shipment", "idx_movements_wh_item": "Ledger of one stock line in time order",
        "idx_request_items_item": "Lines for an item", "idx_request_items_open": "Allocator work queue: only lines that still need stock (partial index)",
        "idx_requests_camp": "Requests of a camp over time", "idx_requests_status_urgency": "Open-request lists and dashboard counts",
        "idx_sessions_expires": "Expired-session clean-up", "idx_sessions_user": "Sessions of a user (revocation)",
        "idx_shipment_events_shipment": "Timeline of a shipment", "idx_shipment_items_request_item": "Shipments that fulfil a request line",
        "idx_shipments_camp": "Shipments to a camp by status", "idx_shipments_status": "Board of shipments by status",
        "idx_shipments_volunteer": "A volunteer’s shipments", "idx_shipments_warehouse": "Shipments from a warehouse by status",
    }
    rows = [[ix["name"], ix["table"], ix["columns"] + (f"\nWHERE {ix['where']}" if ix["where"] else ""), PURPOSE.get(ix["name"], "")] for ix in S["indexes"]]
    table_caption(doc, f"All {len(S['indexes'])} secondary indexes")
    table(doc, ["Index", "Table", "Columns", "Access path served"], rows, widths=[2.0, 1.3, 1.6, 1.6], font=8)
    para(doc, "Primary keys and UNIQUE constraints additionally create their own implicit indexes. An automated test inspects `EXPLAIN QUERY PLAN` and asserts that four hot queries use these indexes (Section 15.3). No response-time claims are made beyond the measurements reported in Chapter 15.", align="justify")

    # ---------------------------------------------------------------- 10 normalization
    h1(doc, "10. NORMALIZATION AND INTEGRITY CONSTRAINTS")
    h2(doc, "10.1 First normal form (1NF)")
    para(doc, "Every column holds an atomic value and there are no repeating groups: a request’s items are rows of `request_items`, a shipment’s contents are rows of `shipment_items`, and the sources of an allocation decision are rows of `allocation_lines`. The only structured text values are `allocation_runs.params_json` (a snapshot of the parameters in force) and `audit_log.details`; both are immutable snapshots that are never queried field by field.", align="justify")
    h2(doc, "10.2 Second normal form (2NF)")
    para(doc, "Tables with composite keys contain only attributes that depend on the whole key. In `inventory(warehouse_id, item_id)` the quantities and reorder level describe the pair; item names, units and categories live in `supply_items` and `supply_categories`, and warehouse names and coordinates in `warehouses`. `camp_stock(camp_id, item_id)` follows the same pattern. Tables with surrogate keys have no composite key, so partial dependencies cannot arise, but their functional dependencies were still checked.", align="justify")
    h2(doc, "10.3 Third normal form (3NF) and deliberate denormalisation")
    para(doc, "No non-key attribute depends on another non-key attribute. A request stores only an urgency *level*; the weight and target hours are in `urgency_levels`. Camp coordinates appear once, in `camps`; a shipment stores `warehouse_id` and `camp_id`, never copies of names or places. The exceptions below are intentional and documented; each has a mechanism that detects inconsistency.", align="justify")
    table_caption(doc, "Deliberate denormalisation and how consistency is protected")
    table(doc, ["Denormalised data", "Why", "Protection"], [
        ["request_items.quantity_allocated / quantity_delivered (derived from shipments)", "Hot path of the allocator and dashboards; avoids joins and aggregates on every read", "Changed only inside the transaction that changes shipments; view v_allocation_mismatch recomputes them and must be empty"],
        ["inventory.quantity_on_hand / quantity_reserved (derived from the ledger)", "O(1) availability checks; a place for CHECK constraints", "Views v_ledger_mismatch and v_reservation_mismatch must be empty"],
        ["requests.status (derived from lines)", "Cheap filtering and indexing", "Recomputed from the lines inside the same transaction"],
        ["allocation_decisions snapshot columns (approved, prior, need, supply, demand, factors)", "A historical record: the values change later but the decision must remain explainable", "Immutable by trigger"],
        ["shipments.status_changed_at / last_actor_id / last_note", "Lets the status trigger write the timeline row with the correct actor, time and note", "Written by the same UPDATE that changes the status"],
        ["camp_stock.quantity (derived from deliveries and distributions)", "Direct answer to “what does the camp hold?”", "View v_camp_stock_mismatch must be empty"],
    ], widths=[2.3, 2.1, 2.1], font=9)
    para(doc, "The design is therefore presented as a third-normal-form schema with explicit, test-covered exceptions rather than as an unconditional claim of 3NF for every table.", align="justify")
    h2(doc, "10.4 Integrity constraints")
    cc, uc, fc = sc["checkCount"], sc["uniqueCount"], sc["fkCount"]
    para(doc, f"Declarative integrity does most of the work. The schema declares {cc} CHECK constraints, {fc} foreign-key column references (shown as {ctx['er_edges']} connectors in Figure 3 plus six actor links to users) and {uc} UNIQUE clauses, in addition to primary keys and NOT NULL constraints.", align="justify")
    table_caption(doc, "Constraint types and project examples")
    table(doc, ["Constraint type", "Purpose", "Example in the project"], [
        ["PRIMARY KEY", "Uniquely identifies a row", "`inventory(warehouse_id, item_id)`; `requests.id`"],
        ["FOREIGN KEY", "Prevents orphan references", "`stock_movements(warehouse_id, item_id)` → `inventory`; `distributions(camp_id, item_id)` → `camp_stock`"],
        ["UNIQUE", "Prevents duplicates", "`request_items(request_id, item_id)`; `shipments.code`; case-insensitive `users.username`"],
        ["CHECK (domain)", "Valid values", "`status IN (...)`; latitude between -90 and 90; `vulnerable_count <= population`"],
        ["CHECK (stock safety)", "No negative or over-reserved stock", "`quantity_reserved >= 0 AND <= quantity_on_hand`"],
        ["CHECK (lifecycle arithmetic)", "Ordered quantities", "`delivered <= allocated <= approved <= requested`"],
        ["CHECK (record consistency)", "Decision arithmetic", "`approved_qty = prior_qty + need_qty`; `allocated_qty <= need_qty`"],
        ["CHECK (role scope)", "Users bound to the right place", "coordinator ⇒ camp_id NOT NULL and warehouse_id NULL; manager the reverse"],
        ["NOT NULL", "Mandatory facts", "`requests.camp_id`, `shipments.distance_km`"],
        ["ON DELETE", "Behaviour on parent removal", "RESTRICT by default; CASCADE only for `sessions` and `request_items`"],
    ], widths=[1.4, 1.7, 3.4], font=9)
    h2(doc, f"10.5 Triggers ({len(S['triggers'])})")
    TPURPOSE = {
        "trg_stock_movements": "Stock ledger is append-only",
        "trg_allocation_runs": "Allocation history is immutable", "trg_allocation_decisions": "Allocation history is immutable", "trg_allocation_lines": "Allocation history is immutable",
        "trg_shipment_events": "Shipment timeline is append-only", "trg_audit_log": "Audit log is append-only",
        "trg_shipments_valid_transition": "Shipment state machine: PLANNED→IN_TRANSIT/CANCELLED, IN_TRANSIT→DELIVERED only",
        "trg_shipments_event_on_insert": "Writes the first timeline row when a shipment is planned",
        "trg_shipments_event_on_status": "Writes a timeline row on every status change (actor, time, note)",
        "trg_shipment_items_immutable": "Shipment lines cannot be edited after creation",
        "trg_shipment_items_receipt_state": "Receipts can be recorded only while in transit",
        "trg_requests_camp_open": "No requests for a closed camp",
        "trg_requests_urgency_no_downgrade_when_closed": "A fulfilled or cancelled request keeps its urgency",
        "trg_inventory_no_delete_with_stock": "Inventory rows holding stock cannot be deleted",
        "trg_distribution_stock_guard": "A distribution cannot exceed stock held at the camp",
    }
    rows = []
    for t in S["triggers"]:
        key = next((k for k in TPURPOSE if t["name"].startswith(k)), None)
        rows.append([t["name"], t["table"], t["when"], TPURPOSE.get(key, "")])
    table_caption(doc, "All triggers")
    table(doc, ["Trigger", "Table", "Event", "Purpose"], rows, widths=[2.3, 1.2, 1.0, 2.0], font=8)
    h2(doc, f"10.6 Views ({len(S['views'])})")
    VPURPOSE = {
        "v_inventory_available": "Warehouse × item with available = on hand − reserved and the below-reorder flag",
        "v_open_demand": "The allocator’s work queue: request lines that still need stock in open camps and incidents",
        "v_item_supply_demand": "Network-wide supply versus open demand per item (shortage alerts)",
        "v_camp_overview": "Per-camp roll-up of open requests, most urgent level, active shipments and servings",
        "v_request_progress": "Per-request count of lines allocated and delivered",
        "v_ledger_mismatch": "Reconciliation: inventory must equal the replayed stock ledger",
        "v_reservation_mismatch": "Reconciliation: reserved stock must equal quantity on PLANNED shipments",
        "v_allocation_mismatch": "Reconciliation: request counters must equal what shipments say",
        "v_camp_stock_mismatch": "Reconciliation: camp stock must equal deliveries minus distributions",
    }
    table_caption(doc, "All views")
    table(doc, ["View", "Purpose"], [[v, VPURPOSE.get(v, "")] for v in S["views"]], widths=[2.0, 4.5], font=9, bold_first_col=True)
    h2(doc, "10.7 Nulls and optional relationships")
    para(doc, "A NULL always means “unknown or not applicable” and never zero. `shipments.volunteer_id` is NULL until a volunteer is assigned; `shipment_items.quantity_received` is NULL until the delivery is confirmed (a confirmed zero is stored as 0); `allocation_runs.disaster_id` is NULL when a run covers all incidents; `users.camp_id` and `users.warehouse_id` are NULL for roles that are not scoped. The CHECK on `users` ensures that exactly the right combination of NULLs exists for each role.", align="justify")
