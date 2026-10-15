"""Builds report/ReliefGrid_DBMS_Report.docx. Run: python build_report.py"""
import json
import os
import sys
from PIL import Image
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK

import report_data as rd
from docx_helpers import *  # noqa
import ch_front_and_design as A
import ch_method_and_results as B

OUT_DOCX = os.path.abspath(os.path.join(rd.BUILD, "..", "ReliefGrid_DBMS_Report.docx"))
SCREENS = os.path.join(rd.ASSETS, "screens")
DIAGS = os.path.join(rd.ASSETS, "diagrams")


def shrink(src_dir, dst_dir, max_w, jpeg=False):
    os.makedirs(dst_dir, exist_ok=True)
    for fn in os.listdir(src_dir):
        if not fn.lower().endswith(".png"):
            continue
        with Image.open(os.path.join(src_dir, fn)) as im:
            im = im.convert("RGB")
            if im.width > max_w:
                im = im.resize((max_w, int(im.height * max_w / im.width)), Image.LANCZOS)
            if jpeg:
                im.save(os.path.join(dst_dir, fn[:-4] + ".jpg"), "JPEG", quality=90, optimize=True)
            else:
                im.save(os.path.join(dst_dir, fn), optimize=True)


SHOT_GROUPS = [
    ("A.1 Sign-in", [("01_login", "Sign-in page with the local demo-account shortcuts")]),
    ("A.2 Operations dashboard", [
        ("02_dashboard", "Dashboard: KPI cards, situation map (camps coloured by most urgent open request, shipment routes) and live alerts"),
        ("02b_dashboard_lower", "Dashboard (lower part): supply versus open demand, open requests by urgency and recent activity from the audit trail")]),
    ("A.3 Supply requests", [
        ("03_requests", "Requests list with status filters, urgency filter and search"),
        ("04_request_detail", "Request page: requested → approved → allocated → delivered, and the allocation decisions that were made for this request in plain language"),
        ("18_new_request_dialog", "New-request dialog (camp coordinator): urgency, items, and the live planning-cap hint per item"),
        ("19_request_capped", "Request page after submission: 40,000 L of water requested, 17,250 L approved with the reason recorded")]),
    ("A.4 Allocation engine", [
        ("05_allocation_method", "Allocation page: the priority formula and the four steps used to share a shortage"),
        ("06_allocation_preview_water", "Allocation preview for drinking water: priority-score breakdown, still-needs, allocated quantity, coverage bar and source warehouses"),
        ("07_allocation_explanation", "A line expanded to show its plain-language explanation"),
        ("08_allocation_insulin_deficit", "Insulin: lines that already hold more than their fair level wait (“already holds 27 of 40”, 0 allocated)"),
        ("09_commit_dialog", "Confirmation dialog before committing a run"),
        ("10_run_detail", "Committed run: every decision, its score and the warehouse it is sourced from"),
        ("10b_run_shipments", "Shipments planned by the committed run"),
        ("11_allocation_history", "Allocation history: immutable record of all committed runs")]),
    ("A.5 Shipments and deliveries", [
        ("12_shipments_manager", "Shipments board as seen by a warehouse manager (own warehouse only)"),
        ("13_dispatch_dialog", "Dispatch dialog"),
        ("14_shipment_detail", "Shipment detail with the timeline written by a database trigger"),
        ("16_delivery_dialog", "Confirm-delivery dialog (volunteer): per-line received quantities; a smaller number records a shortfall"),
        ("17_volunteer_shipments", "Volunteer view after confirming a delivery")]),
    ("A.6 Inventory", [
        ("23_inventory", "Warehouse inventory: on hand, reserved, available, reorder level"),
        ("15_inventory_ledger", "Stock ledger viewer: append-only history of one stock line")]),
    ("A.7 Camps and distribution", [
        ("21_camps", "Relief camps sorted by urgency"),
        ("22_camp_detail", "Camp detail: requests, stock held, shipments and distributions"),
        ("20_distribution_refused", "Distribution dialog refusing a quantity larger than the camp holds")]),
    ("A.8 Analytics", [("24_analytics", "Analytics: coverage by urgency, time to first delivery, deliveries per day and committed stock"),
        ("24b_analytics_lower", "Analytics (lower part): largest shortages, camp coverage, allocation runs and losses in transit")]),
    ("A.9 Administration", [
        ("25_admin_users", "User administration with role and scope"),
        ("26_admin_settings", "Allocation settings: urgency weights and parameters (editable by administrators)"),
        ("27_admin_audit", "Append-only audit trail"),
        ("28_admin_integrity", "Data-integrity self-check: all four reconciliation views report no problems")]),
]


def appendices(doc, ctx, shots_dir):
    h1(doc, "APPENDIX A — APPLICATION SCREENSHOTS").paragraph_format.page_break_before = True
    para(doc, "All screenshots were captured from the running application by a script that signs in as each role in turn and operates the real interface (`report/build/screens.mjs`). The database was freshly seeded, so allocation, dispatch, delivery and request actions shown here are the genuine results of those operations. The light theme is used for print; the application also has a dark theme.", align="justify")
    for title, shots in SHOT_GROUPS:
        h2(doc, title)
        for key, cap in shots:
            figure(doc, os.path.join(shots_dir, key + ".jpg"), cap, width=6.2, max_height=4.3, label="Figure")
    h2(doc, "A.10 Mobile layout")
    t = doc.add_table(rows=1, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (key, cap) in enumerate((("29_mobile_dashboard", "Dashboard on a 390 px wide screen"), ("30_mobile_navigation", "Off-canvas navigation menu"))):
        c = t.rows[0].cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(os.path.join(shots_dir, key + ".jpg"), width=Inches(2.5))
        p2 = c.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p2.add_run(cap)
        r.italic = True
        r.font.size = Pt(9.5)
    doc.add_paragraph()

    h1(doc, "APPENDIX B — REPRODUCING THE RESULTS").paragraph_format.page_break_before = True
    para(doc, "All verified results in this report can be regenerated with the commands below, run from the project directory (`reliefgrid/`) on Node.js 22.13 or newer. No database server is required.", align="justify")
    code_block(doc, """npm install                  # installs the only runtime dependency (express)
npm run seed                 # creates data/reliefgrid.db with the fictional demo incident
npm start                    # serves the application at http://localhost:3000
npm test                     # 71 automated tests (about 4-5 seconds, in-memory databases)
npm run scenarios            # allocation scenarios and baselines -> docs/RESULTS.md
npm run queries              # prints the showcase SQL queries from db/queries.sql""", font=8.5)
    table_caption(doc, "Project size (non-blank files in each area)")
    s = ctx["stats"]
    table(doc, ["Area", "Files", "Lines"], [
        ["Server (JavaScript)", str(s["server"]["files"]), f"{s['server']['lines']:,}"],
        ["Frontend (JS, CSS, HTML)", str(s["frontend"]["files"]), f"{s['frontend']['lines']:,}"],
        ["Tests", str(s["tests"]["files"]), f"{s['tests']['lines']:,}"],
        ["SQL (4 migrations + showcase queries)", str(s["sql"]["files"]), f"{s['sql']['lines']:,}"],
        ["Scripts", str(s["scripts"]["files"]), f"{s['scripts']['lines']:,}"],
    ], widths=[3.5, 1.2, 1.5], font=9.5, align=["l", "r", "r"])
    para(doc, "Line counts include blank lines and comments. Demo accounts (local builds only) all use the password documented in the README; sign-in shortcuts are disabled when `NODE_ENV=production`.", size=10)

    h1(doc, "APPENDIX C — AUTOMATED TEST RESULTS").paragraph_format.page_break_before = True
    para(doc, f"Output of `npm test` (spec reporter), reproduced from the verification run: {int(ctx['test_summary']['pass'])} passed, {int(ctx['test_summary']['fail'])} failed, total duration {ctx['test_summary']['duration_ms'] / 1000:.1f} s. Per-test durations are in milliseconds.", align="justify")
    rows = []
    for fname, items in ctx["tests"]:
        for name, ms in items:
            rows.append([fname.replace("tests/", ""), name, "Passed", f"{ms:.1f}"])
    table(doc, ["File", "Test", "Result", "ms"], rows, widths=[1.15, 4.3, 0.6, 0.45], font=7.5, align=["l", "l", "c", "r"], pad=18)


def main():
    shots_small = os.path.join(rd.ASSETS, "screens_small")
    diags_small = os.path.join(rd.ASSETS, "diagrams_small")
    shrink(SCREENS, shots_small, 1700, jpeg=True)
    shrink(DIAGS, diags_small, 3200)

    schema = rd.schema_info()
    routes = rd.load_json("routes.json")
    ctx = dict(
        schema=schema,
        schema_json=rd.load_json("schema.json"),
        stats=rd.load_json("stats.json"),
        routes=routes,
        route_count=len({(r["method"], r["path"]) for r in routes}),
        results=rd.parse_results_md(),
        queries=rd.load_json("queries.json"),
        negative=B.negative_tests(),
        er_edges=json.load(open(os.path.join(DIAGS, "er_meta.json")))["edges"],
    )
    ctx["tests"], ctx["test_summary"] = rd.parse_tests()
    ctx["n_tests"] = int(ctx["test_summary"]["tests"])

    doc = new_document()
    doc.core_properties.title = "ReliefGrid — Disaster Relief Resource Allocation System (Database Systems DA-II)"
    doc.core_properties.author = "Abhishek Kandavel"
    doc.core_properties.subject = "BCSE302L Database Systems — Digital Assignment II"

    # Section 1: cover (no page number)
    s1 = doc.sections[0]
    configure_section(s1, border=True)
    set_header_footer(s1, with_page_number=False, with_header=False)
    A.cover(doc, ctx)

    # Section 2: front matter, roman numerals
    s2 = new_section(doc, border=True, num_fmt="lowerRoman", num_start=1)
    set_header_footer(s2, with_page_number=True, with_header=True)
    A.front_matter(doc, ctx)
    A.toc_page(doc)

    # Section 3: body, arabic numerals restart at 1
    new_section(doc, border=True, num_fmt="decimal", num_start=1)
    A.chapters_1_to_5(doc, ctx)
    A.chapters_6_to_10(doc, ctx)
    # landscape page for the ER diagram
    new_section(doc, landscape=True, border=True, num_fmt="decimal")
    A.er_section(doc, ctx)
    # back to portrait
    new_section(doc, border=True, num_fmt="decimal")
    A.er_cardinality(doc, ctx)
    A.chapters_9_10(doc, ctx)
    B.ch11_allocation(doc, ctx)
    B.ch12_transactions(doc, ctx)
    B.ch13_sql(doc, ctx)
    B.ch14_modules(doc, ctx)
    B.ch15_testing(doc, ctx)
    B.ch16_limitations(doc, ctx)
    B.ch17_conclusion(doc, ctx)
    B.references(doc, ctx)
    appendices(doc, ctx, shots_small)

    doc.save(OUT_DOCX)
    print("saved", OUT_DOCX)


if __name__ == "__main__":
    main()
