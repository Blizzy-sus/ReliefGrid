// Collects real, reproducible facts for the report (query outputs, schema dictionary, routes, code statistics).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const OUT = path.join(here, 'data');
fs.mkdirSync(OUT, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { openDb, migrate } = await imp('server/db.js');
const { seedDatabase } = await imp('server/seed.js');
const { loadQueries } = await imp('scripts/run-queries.js');

const NOW = new Date('2026-07-15T12:00:00Z');
const db = openDb(':memory:'); migrate(db);
seedDatabase(db, { now: NOW });
const plain = (r) => ({ ...r });

// ---- query outputs
const queries = loadQueries();
const results = {};
for (const q of queries) {
  const rows = db.prepare(q.sql).all().map(plain);
  results[q.name] = { description: q.description, sql: q.sql, rowCount: rows.length, rows: rows.slice(0, 12) };
}
fs.writeFileSync(path.join(OUT, 'queries.json'), JSON.stringify(results, null, 1));

// ---- table sizes of the demo data
const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const counts = {};
for (const t of tableNames) counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
// ---- schema dictionary
const dict = {};
for (const t of tableNames) {
  dict[t] = {
    columns: db.prepare(`PRAGMA table_info(${t})`).all().map(plain),
    fks: db.prepare(`PRAGMA foreign_key_list(${t})`).all().map(plain),
    sql: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t).sql,
  };
}
const objects = {};
for (const type of ['table', 'view', 'trigger', 'index']) {
  objects[type] = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type).map((r) => r.name);
}
const checkCount = Object.values(dict).reduce((s, t) => s + (t.sql.match(/CHECK\s*\(/g) || []).length, 0);
const uniqueCount = Object.values(dict).reduce((s, t) => s + (t.sql.match(/UNIQUE/g) || []).length, 0);
const fkCount = Object.values(dict).reduce((s, t) => s + t.fks.length, 0);
fs.writeFileSync(path.join(OUT, 'schema.json'), JSON.stringify({ counts, dict, objects, checkCount, uniqueCount, fkCount }, null, 1));

// ---- routes (parsed from source)
const routes = [];
for (const file of ['server/app.js', 'server/routes/master.js', 'server/routes/ops.js']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /\b(?:r|api)\.(get|post|patch|put)\(\s*'([^']+)'((?:[^;]|\n)*?)=>/g;
  let m;
  while ((m = re.exec(src))) {
    const roles = /requireRole\(([^)]*)\)/.exec(m[3]);
    routes.push({ method: m[1].toUpperCase(), path: '/api' + m[2], roles: roles ? roles[1].replace(/\s/g, '') : (m[3].includes('admin') ? 'admin' : ''), file });
  }
}
// warehouseOps wrappers
for (const m of fs.readFileSync(path.join(ROOT, 'server/routes/ops.js'), 'utf8').matchAll(/r\.(post)\('(\/shipments\/:id\/[a-z]+)', warehouseOps/g)) routes.push({ method: 'POST', path: '/api' + m[2], roles: 'warehouse (scoped) / admin', file: 'server/routes/ops.js' });
fs.writeFileSync(path.join(OUT, 'routes.json'), JSON.stringify(routes, null, 1));

// ---- code statistics
const loc = (dir, exts) => {
  let files = 0; let lines = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === 'data' || e.name === 'report') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (exts.some((x) => e.name.endsWith(x))) { files++; lines += fs.readFileSync(p, 'utf8').split('\n').length; } } };
  walk(path.join(ROOT, dir)); return { files, lines };
};
const stats = { server: loc('server', ['.js']), frontend: loc('public', ['.js', '.css', '.html']), tests: loc('tests', ['.js']), sql: loc('db', ['.sql']), scripts: loc('scripts', ['.js']) };
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 1));
console.log(JSON.stringify({ routes: routes.length, objects: Object.fromEntries(Object.entries(objects).map(([k, v]) => [k, v.length])), checkCount, uniqueCount, fkCount, stats, counts }, null, 1));
