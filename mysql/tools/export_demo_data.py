"""
Exports the ReliefGrid demo incident from the SQLite database into MySQL INSERT statements.

    python mysql/tools/export_demo_data.py [path-to-sqlite-db]      (default: data/reliefgrid.db)

Writes mysql/03_demo_data.sql and mysql/reliefgrid_mysql_full.sql (01..05 concatenated).
Reference tables (urgency_levels, supply_categories, allocation_settings) are loaded by 02_reference_data.sql.
"""
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MYSQL_DIR = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(MYSQL_DIR, ".."))
DB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "reliefgrid.db")

# dependency order (parents first); reference tables and empty `sessions` are not exported
TABLES = [
    "supply_items", "disasters", "warehouses", "camps", "users", "inventory", "stock_movements",
    "requests", "request_items", "allocation_runs", "allocation_decisions", "shipments", "shipment_items",
    "allocation_lines", "shipment_events", "camp_stock", "distributions", "audit_log",
]
ISO = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$")


def literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    s = str(v)
    m = ISO.match(s)
    if m:
        frac = (m.group(3) or "0").ljust(3, "0")[:3]
        return f"'{m.group(1)} {m.group(2)}.{frac}'"
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'"


def main():
    con = sqlite3.connect(DB)
    out = [
        "-- ReliefGrid demo incident (fictional data) exported from SQLite for MySQL.",
        "-- Load after 01_schema.sql and 02_reference_data.sql, and BEFORE 05_triggers.sql.",
        "USE reliefgrid;",
        "SET NAMES utf8mb4;",
        "START TRANSACTION;",
        "",
    ]
    total = 0
    for t in TABLES:
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({t})")]
        rows = con.execute(f"SELECT {', '.join(cols)} FROM {t} ORDER BY rowid").fetchall()
        if not rows:
            continue
        out.append(f"-- {t}: {len(rows)} rows")
        head = f"INSERT INTO {t} ({', '.join(cols)}) VALUES"
        for i in range(0, len(rows), 100):
            chunk = rows[i:i + 100]
            out.append(head)
            out.append(",\n".join("  (" + ", ".join(literal(v) for v in r) + ")" for r in chunk) + ";")
        out.append("")
        total += len(rows)
    out.append("COMMIT;")
    out.append(f"-- {total} rows in total")
    with open(os.path.join(MYSQL_DIR, "03_demo_data.sql"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")

    parts = ["01_schema.sql", "02_reference_data.sql", "03_demo_data.sql", "04_views.sql", "05_triggers.sql"]
    with open(os.path.join(MYSQL_DIR, "reliefgrid_mysql_full.sql"), "w", encoding="utf-8", newline="\n") as f:
        f.write("-- ReliefGrid: complete MySQL 8.0 script (schema + reference data + demo data + views + triggers).\n")
        f.write("-- Equivalent to running 01..05 in order. Safe to re-run: it recreates the `reliefgrid` tables.\n\n")
        for p in parts:
            f.write(f"-- ======================================================================== {p}\n")
            with open(os.path.join(MYSQL_DIR, p), encoding="utf-8") as src:
                f.write(src.read().rstrip() + "\n\n")
    print(f"exported {total} rows from {DB}")


if __name__ == "__main__":
    main()
