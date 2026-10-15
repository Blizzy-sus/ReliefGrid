"""Loads verified facts for the report: schema (by running the real migrations), query results, results tables, test output."""
import json
import os
import re
import sqlite3

BUILD = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BUILD, "..", ".."))
ASSETS = os.path.join(BUILD, "..", "assets")
DATA = os.path.join(BUILD, "data")


def load_json(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def schema_db():
    """In-memory database built from the project's own migration files."""
    con = sqlite3.connect(":memory:")
    mig = os.path.join(ROOT, "db", "migrations")
    for fn in sorted(os.listdir(mig)):
        if fn.endswith(".sql"):
            with open(os.path.join(mig, fn), encoding="utf-8") as f:
                con.executescript(f.read())
    return con


def schema_info():
    con = schema_db()
    cur = con.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    info = {}
    for t in tables:
        cols = [dict(cid=r[0], name=r[1], type=r[2], notnull=r[3], default=r[4], pk=r[5]) for r in cur.execute(f"PRAGMA table_info({t})")]
        fks = [dict(id=r[0], seq=r[1], table=r[2], from_=r[3], to=r[4], on_delete=r[6]) for r in cur.execute(f"PRAGMA foreign_key_list({t})")]
        info[t] = dict(cols=cols, fks=fks)
    indexes = []
    for name, tbl, sql in cur.execute("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name"):
        m = re.search(r"\((.*?)\)(\s+WHERE\s+(.*))?$", sql.strip(), re.S)
        indexes.append(dict(name=name, table=tbl, columns=m.group(1).strip(), where=(m.group(3) or "").strip()))
    triggers = []
    for name, tbl, sql in cur.execute("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name"):
        m = re.match(r"CREATE TRIGGER \w+\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)(?:\s+OF\s+([\w, ]+?))?\s+ON", sql.strip().replace("\n", " "))
        triggers.append(dict(name=name, table=tbl, when=(m.group(1) + " " + m.group(2) + (f" OF {m.group(3)}" if m.group(3) else "")) if m else ""))
    views = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")]
    sqlite_version = cur.execute("SELECT sqlite_version()").fetchone()[0]
    con.close()
    return dict(tables=tables, info=info, indexes=indexes, triggers=triggers, views=views, sqlite_version=sqlite_version)


def parse_results_md():
    """Parse docs/RESULTS.md into {section_number: [table, ...]} where each table is {head:[...], rows:[[...]]}."""
    path = os.path.join(ROOT, "docs", "RESULTS.md")
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    sections = {}
    cur = 0
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^## (\d+)\.", ln)
        if m:
            cur = int(m.group(1))
            sections.setdefault(cur, [])
        if ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1]):
            head = [c.strip() for c in ln.strip().strip("|").split("|")]
            rows = []
            i += 2
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            sections.setdefault(cur, []).append(dict(head=head, rows=rows))
            continue
        i += 1
    return sections


def parse_tests():
    """Group the real `npm test` spec output by test file (the runner prints files in this order)."""
    path = os.path.join(DATA, "test_output.txt")
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    tests = []
    for m in re.finditer(r"^\u2714 (.+?) \(([\d.]+)ms\)$", text, re.M):
        tests.append((m.group(1), float(m.group(2))))
    summary = {k: float(v) for k, v in re.findall(r"^\u2139 (tests|pass|fail|duration_ms) ([\d.]+)", text, re.M)}
    groups = [("tests/api.test.js", 13), ("tests/database.test.js", 14), ("tests/engine.test.js", 18), ("tests/queries.test.js", 21), ("tests/scenarios.test.js", 5)]
    out = []
    i = 0
    for name, n in groups:
        out.append((name, tests[i:i + n]))
        i += n
    return out, summary


def sql_snippet(path_in_root, start_marker, end_marker=None):
    with open(os.path.join(ROOT, path_in_root), encoding="utf-8") as f:
        text = f.read()
    s = text.index(start_marker)
    e = text.index(end_marker, s) if end_marker else len(text)
    return text[s:e].rstrip()
