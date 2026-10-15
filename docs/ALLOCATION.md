# The allocation methodology

**Goal:** when requests exceed stock, decide who gets what in a way that is *fair*, *repeatable* and *explainable* to the people on the receiving end, and that stays fair across successive rounds as new stock and new requests arrive.

The implementation is `server/allocation/engine.js` (pure functions, no I/O), wrapped by `server/services/allocation.js` (reads the database, writes the result in one transaction).

## 1. Inputs

For every open request line *i* (a request for one item from one camp):

| Symbol | Meaning | Source |
|---|---|---|
| A<sub>i</sub> | **approved** quantity | request line, after the planning-standard cap |
| P<sub>i</sub> | already allocated to this line by earlier runs (reserved, in transit or delivered) | `quantity_allocated` |
| d<sub>i</sub> = A<sub>i</sub> − P<sub>i</sub> | remaining need | derived |
| u<sub>i</sub> | urgency weight | `urgency_levels.weight` (Low 1 · Moderate 2 · High 3.5 · Critical 6) |
| v<sub>i</sub> | share of the camp's residents who are at-risk (children under 5, elderly, pregnant women, people with disabilities) | `vulnerable_count / population` |
| h<sub>i</sub> | hours the request has been waiting | now − `created_at` |
| S | stock available for the item across active warehouses | `on_hand − reserved` |

Parameters (editable by administrators, snapshotted into every run): vulnerability weight *k<sub>v</sub>* = 1, aging window *W* = 48 h, aging bonus *k<sub>a</sub>* = 0.5.

### Approval: a planning standard keeps claims honest

For items with a per-person standard (rice 0.5 kg, water 5 L, ORS 0.2 sachet, soap 0.1 bar … per person per day), a camp's request is **approved up to `standard × population × planning_horizon_days`** (3 days by default). Anything above is trimmed and the line records why. Items with no meaningful standard (tarpaulins, insulin) are approved as requested. Administrators can override a line's approval (never above what was requested). This stops over-claiming from distorting shares.

## 2. Priority score

```
score_i = u_i × (1 + k_v × v_i) × (1 + k_a × min(1, h_i / W))
```

* **Urgency** is the dominant factor, chosen by the camp (coordinators may only *raise* urgency; only administrators lower it).
* **Vulnerability** lifts camps with more at-risk residents, up to ×2.
* **Aging** lifts requests that have waited, up to ×1.5 after 48 h, so low-urgency requests cannot be postponed forever.

Every factor is stored with the decision, so the score can be reproduced from the database. (`q16_priority_score_in_sql` in [`db/queries.sql`](../db/queries.sql) recomputes it in pure SQL.)

## 3. Rationing one item

Each item is rationed independently: stock of rice says nothing about tarpaulins.

**Case 1: stock covers all remaining need (S ≥ Σd<sub>i</sub>).** Everyone receives d<sub>i</sub>. Priority is irrelevant.

**Case 2: stock is short.** Define each line's *cumulative coverage* as (P<sub>i</sub> + x<sub>i</sub>) / A<sub>i</sub>, where x<sub>i</sub> is what it receives now. ReliefGrid finds the single **fair level λ** for which

```
x_i = clamp( A_i · λ · score_i − P_i , 0 , d_i )      and      Σ x_i = S
```

In words: *every line is brought up to a cumulative coverage of min(100%, λ × its priority score).*

* Coverage is **proportional to priority** and **capped at 100%**; a line that reaches 100% releases the surplus to the rest.
* A line that already holds **more than its fair level** (because an earlier run served it) receives nothing until the others catch up: the method is *deficit-aware*, which is what keeps it fair over multiple rounds.
* Nobody below the fair level is starved: before rounding, every such line receives a strictly positive share.

Total allocation Σx<sub>i</sub>(λ) is a non-decreasing, piecewise-linear function of λ whose breakpoints are where a line starts to receive (λ = P<sub>i</sub>/(A<sub>i</sub>·score<sub>i</sub>)) or becomes capped (λ = 1/score<sub>i</sub>). The engine sorts the breakpoints, finds the interval containing S and interpolates, so the answer is **exact**, not iterative or approximate.

### Rounding

Quantities are whole units. Each x<sub>i</sub> is floored; the leftover units go one at a time to the lines with the largest fractional parts (ties: higher priority, then lower id). The integer result sums exactly to S, never exceeds any line's need, and is within one unit of the exact solution (tested against an independent bisection solver on 600 random cases).

### Worked example

Two lines, equal size 100, priorities 6 (Critical) and 1 (Low), stock 100:
100·6λ + 100·λ = 100 ⇒ λ = 1/7 ⇒ coverages 6/7 and 1/7 ⇒ **86 and 14 units**.

A multi-round example: camp A already holds 400 of 1,000; camp B holds nothing; equal priority; 600 more units arrive. A naive method splits 600 by remaining need (225 to A, 375 to B: A ends at 63%, B at 38%). ReliefGrid solves (1000λ − 400) + 1000λ = 600 ⇒ λ = 0.5 and gives **A 100, B 500: both at 50%**. See [RESULTS.md](RESULTS.md) scenario 5.

## 4. Choosing source warehouses

After shares are fixed, lines are served **in priority order**, each from the **nearest warehouses that still have stock** (road distance = straight-line × detour factor), splitting across warehouses when needed. Active (not offline) warehouses only. All lines going from one warehouse to one camp are bundled into one **shipment**; stock for every shipment is **reserved** in the same transaction.

Because stock is pooled per item first, an item can always be sourced completely (the engine asserts this). The greedy source choice is not a minimum-cost flow, so total kilometres are not globally optimal (see limitations).

## 5. Explainability

Each decision stores a sentence such as:

> Priority 8.02 = urgency 6 (Critical) × vulnerability 1.3 (30% at-risk) × waiting 1.03 (3h). Packaged drinking water is scarce: 21,000 L available for 58,535 L of open demand (36%). Every line is brought up to a coverage proportional to its priority (capped at 100%); this line's fair coverage is 91%. It receives 5,228 of 5,750 L (cumulative coverage 91%); the remaining 522 L stays queued.

Camp coordinators see the history of these sentences on their request page, administrators see them (with the score breakdown and sources) in the preview and in every historical run. Together with the parameter snapshot stored on each run, any past decision can be audited.

## 6. Properties and how they are tested

| Property | Test |
|---|---|
| Never allocates more than the stock or more than a line needs; integer results | `tests/engine.test.js` property test (600 random scenarios) |
| Uses every available unit when stock is short | same |
| Matches an exact solver within one unit | same, against bisection |
| Higher priority ⇒ at least the coverage of lower priority (among lines that receive stock) | property test (200 random scenarios) + demo-data test |
| Deterministic regardless of input order | `determinism` test |
| Deficit awareness (already-served lines wait; lines are levelled) | two dedicated tests |
| Abundance gives everyone their full need | abundance test |
| Reservation can never exceed stock, even with 8 concurrent runs; a failure mid-run rolls everything back | `tests/api.test.js` |

## 7. Why not something simpler?

[RESULTS.md](RESULTS.md) compares ReliefGrid with three common rules on the same data. In short:

* **First come, first served** rewards whoever asked first, not who needs it: in the demo case the Critical camp that asked last received nothing.
* **Equal share of need** ignores the emergency entirely (every camp 39%).
* **Strict priority** serves the top request completely and leaves the three lowest camps with nothing.
* **ReliefGrid:** Critical 64%, High 40–44%, Moderate 21–26%, Low 14%, nobody at zero (scenario 2).

## 8. Tuning

| Setting | Effect |
|---|---|
| Urgency weights | The main lever. A Critical:Low ratio of 6 gives a Critical line ~6× the coverage of an identical Low line until the Critical line reaches 100% |
| `vulnerability_weight` | 0 ignores at-risk residents; 1 (default) can double a score |
| `aging_max_bonus`, `aging_window_hours` | How quickly waiting overcomes a lower urgency |
| `planning_horizon_days` | How much a camp may claim per person |
| `road_detour_factor`, `travel_speed_kmh` | Distance and ETA estimates only; they do not affect shares |

## 9. Limitations

* The method decides *how much*, using the camp's declared urgency and census. It cannot detect dishonest declarations; the audit trail, administrator override and planning cap are the safeguards.
* Items are independent: a camp's very high priority for water does not trade against its need for blankets.
* Source selection is greedy (priority order, nearest first), not globally distance-minimising, and there are no vehicle capacities or road closures.
* Aging and vulnerability use simple linear forms; they are parameters, not learned from outcomes.
* Population and vulnerability counts are whatever coordinators last entered; the planning cap uses the population at the time of the request.
