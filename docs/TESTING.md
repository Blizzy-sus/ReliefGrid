# Testing and verification

```bash
npm test            # 71 tests, about 4-5 seconds, uses in-memory databases (never touches data/)
npm run scenarios   # regenerates docs/RESULTS.md from fixed inputs
```

Last full run: **71 passed, 0 failed** (Node 22.19, Windows 11).

## Automated tests (`node:test`, no extra dependencies)

| File | Tests | What it proves |
|---|---:|---|
| `tests/engine.test.js` | 18 | **Algorithm.** Exact closed-form cases (86/14 split, capping and redistribution, deficit-awareness); a 600-scenario randomised property test (bounds, integers, stock fully used, within one unit of an independent bisection solver); 200-scenario priority-monotonicity test; determinism under input reordering; priority-score components and aging cap; planning-standard cap; nearest-warehouse sourcing and splitting; zero-stock explanation; haversine distance |
| `tests/database.test.js` | 14 | **Schema.** Migration idempotency and checksum tamper detection; foreign keys enforced; every `CHECK` that guards stock and quantities; role/scope constraint; case-insensitive usernames; append-only tables; shipment state machine and automatic timeline; receipt-state trigger; closed-camp, distribution and inventory-delete guards; views; reconciliation views detecting tampering; `EXPLAIN QUERY PLAN` index usage; `tx()` commit/rollback/nesting; **real two-connection isolation test** (a second connection cannot open a write transaction, sees only committed data, and cannot over-reserve) |
| `tests/api.test.js` | 13 | **HTTP behaviour, end to end.** Login/logout/token hashing/deactivation/rate limiting; role and scope matrix; request validation and approval caps; preview changes nothing; commit is atomic and explainable; second run cannot over-allocate; **8 concurrent runs reserve each unit exactly once**; **fault injected at the last step rolls everything back**; full lifecycle (request → allocation → dispatch → partial delivery → re-allocation of the shortfall → distribution, with integrity checked at each stage); cancel releases reservations; stock adjustments respect the reserved floor; dashboard/alerts/analytics; malformed JSON, bad ids, SQL-injection attempt |
| `tests/scenarios.test.js` | 5 | **Realistic data.** The seeded 3-day incident is internally consistent; scarce items are rationed by priority and abundant items met in full; Critical > High > Moderate > Low coverage and nobody starved; committing through the API reserves every unit exactly once; role journeys on the demo accounts |
| `tests/queries.test.js` | 21 | Every showcase SQL query in `db/queries.sql` runs on the demo data; the integrity report is clean; the running ledger ends at the inventory balance; coverage by urgency is ordered |

Invariants checked repeatedly by `checkIntegrity()`: inventory equals the replayed ledger; reserved stock equals planned shipments; request `allocated`/`delivered` counters equal what shipments say; camp stock equals deliveries minus distributions.

### On concurrency testing

Node runs the application in one thread and `node:sqlite` is synchronous, so the "8 concurrent runs" test demonstrates correctness of the *logic* under interleaved requests rather than true parallelism. True multi-connection isolation is covered by the dedicated database test above, which holds a write transaction open on one connection and verifies the behaviour of a second.

## Scenario harness

`npm run scenarios` runs the engine against hand-built situations and three baseline rules (first-come-first-served, equal share of need, strict priority), then on the seeded demo incident, and measures speed. Output: [RESULTS.md](RESULTS.md). Highlights:

- Moderate scarcity (19,000 L for 48,400 L): ReliefGrid gives the Critical camp 64% and every camp something (worst-off 14%); FCFS gives it 0%; strict priority leaves three camps empty.
- Multi-round fairness: both camps end at 50% cumulative coverage; the naive method leaves 63% vs 38%.
- Commit of a full 91-line run: ~5 ms in one transaction; engine time for 5,000 request lines across 12 warehouses: ~43 ms.

## Manual end-to-end verification in a browser

Performed in the desktop app's embedded browser against `npm start` on the seeded database:

| Area | Checked |
|---|---|
| Sign-in | all four roles via the demo shortcuts; sign-out |
| Dashboard | KPIs, situation map with routes and pulsing critical markers, alerts, supply-versus-demand bars, urgency donut, activity feed |
| Allocation | preview (91 lines, 5 scarce items); expand an explanation; commit through the confirmation dialog; run-detail page with shipment codes |
| Shipments | warehouse manager dispatches (stock decrements, status and ETA update); volunteer claims and confirms a **partial delivery** (toast reports the shortfall); admin cancels a planned shipment with a reason; detail page shows the trigger-written timeline |
| Requests | coordinator creates a request, the planning cap hint appears per line and the detail page shows the trimmed quantity with the reason; request list and detail |
| Camps / Distribution | camp grid sorted by urgency; camp detail; record a distribution; over-stock attempt shows the server's message inside the dialog |
| Inventory / Analytics / Admin | warehouse tabs and ledger controls; charts; users table; changing the Critical urgency weight to 10 immediately changes the next preview (Critical lines served in full); integrity check passes after all of the above |
| Responsive | 375 px viewport: off-canvas navigation, **no horizontal overflow on any of the 9 pages** (measured), light theme |

Defects found this way and fixed: card grids rendering stray commas; map bounds distorted by a closed camp in another district; misaligned supply bars; a "Low" badge on items with no reorder level; a misleading "people served" label (now "aid servings"); two charts mixing incompatible units. Testing the algorithm against multi-round scenarios also exposed a real flaw (a request already well served competed again as if it had nothing); the method was made deficit-aware and is now covered by tests.

## What is not covered

- **No automated browser tests.** The UI was verified by hand, as above. The front end's pure helpers and every API behaviour it relies on are covered; DOM behaviour is not.
- **Not exercised in the UI:** the add-camp / add-warehouse / add-user / reset-password dialogs and the assign-volunteer dialog (their API endpoints are tested); light theme on every page individually; Firefox/Safari; a physical phone; screen-reader and keyboard-only passes (focus styles, labels and semantic markup are in place but not audited).
- **No load testing** beyond the engine benchmark; SQLite's single writer is the expected ceiling.
- **No test of power-loss durability** (SQLite WAL with `synchronous = NORMAL` is used; durability on abrupt power loss is the engine's documented behaviour, not verified here).
