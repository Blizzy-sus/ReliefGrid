# Demo script (about 10 minutes)

Server: `npm start` → http://localhost:3000. Every demo account's password is `ReliefGrid@2026`; the sign-in page has one-click buttons. To reset the data afterwards: stop the server, then `npm run seed`.

**The story:** a flood has displaced ~6,900 people into 12 relief camps. Four warehouses hold supplies, but water, ORS, insulin and tarpaulins are running short. Twelve camps have open requests. Who gets what?

---

## 1. The control room (sign in as `admin`) · 2 min

1. **Dashboard.** Point out, left to right:
   - KPI cards: 28 open requests (8 critical), shipments active, 6,920 people in camps.
   - **Situation map:** circles are camps, coloured by their most urgent open request (red = Critical, pulsing). Squares are warehouses. Dashed lines are shipments on the way. Hover a circle for its details.
   - **Alerts:** "Insulin vials: shortage, 30 available for 116 requested", water, ORS, tarpaulins, plus requests past their response target.
   - **Supply versus open demand** bars: green = enough stock, orange/red = shortage.
2. Click **Requests** → click any row (e.g. a Critical one). Show the line table: *requested → approved → allocated → delivered*. Nothing has been allocated yet for the newest requests.

> Say: "The problem is not a lack of data, it is deciding fairly when there isn't enough for everyone."

## 2. The allocation engine · 3 min (the centrepiece)

1. Click **Allocation**. Read the formula panel aloud: **priority = urgency weight × vulnerability × waiting time**, then coverage proportional to priority, capped at 100%, surplus redistributed.
2. Click **Preview allocation**. Nothing is saved yet. Show the four tiles: 91 request lines, 5 scarce items, units, shipments.
3. Open **Packaged drinking water** (already expanded if scarce). Show the table:
   - **Critical** camps (Kodiyakarai, Marudhur, Thalaignayar) ≈ 91–97% covered.
   - **High** ≈ 57%, **Moderate** ≈ 31–35%, **Low** ≈ 14–16%.
   - Nobody is at zero. Critical gets most, but Low is not abandoned.
4. **Click a row** → a "Why:" box appears in plain language (score breakdown, stock situation, final coverage). This is what each camp can read on its own request page.
5. Scroll to **Insulin vials** and click a row that says *"already holds 27 of 40"* with 0 allocated. Explain **deficit awareness:** that camp was already served in an earlier run, so it waits while others catch up. A naive method would give it more.
6. Click **Commit allocation…** → read the confirmation → **Commit**. You land on **run #3**: every decision, its score and the warehouse it will ship from (nearest first), with shipment codes.

> Say: "Preview is a plan. Commit does one database transaction: it reserves stock, writes an unchangeable decision record, and creates shipments. Two people can never reserve the same unit."

## 3. Warehouse to camp (switch accounts: **Sign out** each time) · 3 min

1. **`wm_thanjavur`** → **Shipments**. It starts on "My warehouse only". Click **Dispatch** on a Planned shipment, type a vehicle (e.g. `TN-45-AB-1234`) → Dispatch. Explain: the reserved stock now physically leaves the warehouse. Click **Details** to see the timeline, written automatically by a database trigger.
2. **`vol_asha`** → **Shipments** → find the In transit card → **Claim**, then **Confirm delivery**. In the dialog, lower one "Received" number (say 10 fewer) → **Confirm receipt**. The toast says how many units were short. Explain: the shortfall goes **back into the request** and will be allocated again next run.
3. **`coord_thalaignayar`** → **Requests** → **+ New request**:
   - pick urgency *High*, add item *Packaged drinking water*, quantity **40000**. Note the hint "Planning cap: 17,250 L…"; submit.
   - On the request page show *Requested 40,000 → Approved 17,250* with the reason. Explain: camps cannot inflate their share.
   - **Distribution** → **+ Record distribution**: record some items handed out. Then try an enormous quantity: the dialog refuses ("The camp holds only … units").

## 4. Proof it is trustworthy (back to `admin`) · 2 min

1. **Inventory** → pick a warehouse tab → **Ledger** on any item: every receipt, reservation and dispatch, append-only.
2. **Analytics:** coverage by urgency, time to first delivery, shortages.
3. **Administration → Data integrity:** "All 4 checks passed". Explain: inventory equals the replayed ledger, reservations equal planned shipments, and so on.
4. **Administration → Audit trail:** every action by every user.
5. **Administration → Allocation settings:** show the urgency weights (editable). Optional live demo: edit *Critical* to 10, then **Allocation → Preview**; Critical lines now get 100%. **Set it back to 6 afterwards.**

## 5. The database talking points (for a viva)

- 22 tables in third normal form, with the few deliberate denormalisations documented in `docs/DATABASE.md`.
- `CHECK (quantity_reserved <= quantity_on_hand)` makes over-allocation impossible even if the code is wrong.
- Triggers: append-only history, shipment state machine, automatic timeline.
- Transaction: `BEGIN IMMEDIATE` → re-read stock → conditional `UPDATE` reserve → commit; a fault at the last step rolls everything back (tested).
- Show SQL live in a terminal:

```bash
node --disable-warning=ExperimentalWarning scripts/run-queries.js q06 q11 --limit 6
```

`q06` shows coverage by urgency per run (Critical 92% → Low 14%); `q11` finds camps with an open Critical request and nothing on the way.
- `npm test` (71 tests) and `docs/RESULTS.md` (comparison against first-come-first-served, equal share and strict priority).

## If something looks different

- Counts change after you commit or deliver; `npm run seed` (server stopped) restores the starting state.
- A dialog that refuses an action is intentional: those are the integrity rules working.
