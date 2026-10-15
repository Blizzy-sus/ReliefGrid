// ER diagram generated from the live SQLite schema, with orthogonal routing through column gaps and bus lanes.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const OUT = path.join(here, '..', 'assets', 'diagrams');
const { openDb, migrate } = await import(pathToFileURL(path.join(ROOT, 'server/db.js')).href);
const FONT = "'Segoe UI', Arial, sans-serif";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const db = openDb(':memory:'); migrate(db);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all().map((r) => r.name);
const info = {};
for (const t of tables) info[t] = { cols: db.prepare(`PRAGMA table_info(${t})`).all().map((c) => ({ ...c })), fks: db.prepare(`PRAGMA foreign_key_list(${t})`).all().map((f) => ({ ...f })) };

const EXTRA = {
  disasters: ['name', 'type', 'status', 'started_at'], camps: ['name', 'district', 'capacity', 'population', 'vulnerable_count', 'status'],
  warehouses: ['name', 'district', 'latitude', 'longitude', 'status'], users: ['username', 'role', 'active'], sessions: ['expires_at'],
  urgency_levels: ['label', 'weight', 'sla_hours'], requests: ['status', 'notes', 'created_at'],
  request_items: ['quantity_requested', 'quantity_approved', 'quantity_allocated', 'quantity_delivered'], supply_categories: ['name'],
  supply_items: ['name', 'unit', 'standard_per_person_per_day'], allocation_settings: ['value', 'description'],
  inventory: ['quantity_on_hand', 'quantity_reserved', 'reorder_level'], stock_movements: ['movement_type', 'delta_on_hand', 'delta_reserved'],
  allocation_runs: ['created_at', 'requests_considered', 'units_allocated'], allocation_decisions: ['approved_qty', 'prior_qty', 'need_qty', 'priority_score', 'allocated_qty', 'explanation'],
  allocation_lines: ['quantity', 'distance_km'], shipments: ['code', 'status', 'distance_km', 'eta'], shipment_items: ['quantity', 'quantity_received'],
  shipment_events: ['status', 'note', 'created_at'], camp_stock: ['quantity'], distributions: ['quantity', 'people_served'], audit_log: ['action', 'entity_type', 'created_at'],
};
const DOMAIN = {
  reference: ['urgency_levels', 'supply_categories', 'supply_items', 'allocation_settings'], places: ['disasters', 'camps', 'warehouses', 'users', 'sessions'],
  demand: ['requests', 'request_items'], stock: ['inventory', 'stock_movements'], decisions: ['allocation_runs', 'allocation_decisions', 'allocation_lines'],
  logistics: ['shipments', 'shipment_items', 'shipment_events', 'camp_stock', 'distributions'], audit: ['audit_log'],
};
const COLORS = { reference: '#475569', places: '#0f766e', demand: '#c2410c', stock: '#15803d', decisions: '#7e22ce', logistics: '#1d4ed8', audit: '#64748b' };
const SOFT = { reference: '#f1f5f9', places: '#f0fdfa', demand: '#fff7ed', stock: '#f0fdf4', decisions: '#faf5ff', logistics: '#eff6ff', audit: '#f8fafc' };
const EDGE_COLOR = { camps: '#0f766e', supply_items: '#7c3aed', warehouses: '#b45309', users: '#be123c', requests: '#c2410c', request_items: '#ea580c', shipments: '#1d4ed8', allocation_decisions: '#a21caf', allocation_runs: '#6d28d9', inventory: '#15803d', disasters: '#0e7490', urgency_levels: '#475569', supply_categories: '#64748b', camp_stock: '#0369a1' };
const domainOf = (t) => Object.keys(DOMAIN).find((d) => DOMAIN[d].includes(t));
const OMIT = new Set(['audit_log.user_id', 'stock_movements.user_id', 'shipment_events.actor_id', 'distributions.distributed_by', 'allocation_runs.run_by', 'shipments.last_actor_id']);
const COLS = [
  ['disasters', 'camps', 'users', 'sessions', 'audit_log'],
  ['urgency_levels', 'requests', 'request_items', 'allocation_settings'],
  ['allocation_runs', 'allocation_decisions', 'allocation_lines'],
  ['shipments', 'shipment_items', 'shipment_events'],
  ['warehouses', 'inventory', 'stock_movements'],
  ['supply_categories', 'supply_items', 'camp_stock', 'distributions'],
];

const BW = 214; const GAPX = 86; const ROW = 21.5; const HEAD = 32; const GAPY = 26; const PADX = 40; const TOPLANES = 128;
const rows = {};
for (const t of tables) {
  const { cols, fks } = info[t]; const fkCols = new Set(fks.map((f) => f.from)); const list = [];
  for (const c of cols) if (c.pk > 0) list.push({ name: c.name, tag: fkCols.has(c.name) ? 'PK,FK' : 'PK' });
  for (const c of cols) if (c.pk === 0 && fkCols.has(c.name)) list.push({ name: c.name, tag: 'FK' });
  for (const n of EXTRA[t] || []) if (!list.some((l) => l.name === n)) list.push({ name: n, tag: '' });
  rows[t] = list;
}
const pos = {}; let maxY = 0;
COLS.forEach((col, ci) => {
  let y = TOPLANES;
  for (const t of col) { const h = HEAD + rows[t].length * ROW + 8; pos[t] = { x: PADX + ci * (BW + GAPX), y, w: BW, h, col: ci }; y += h + GAPY; }
  maxY = Math.max(maxY, y);
});
const BOTLANES = 66;
const W = PADX * 2 + COLS.length * BW + (COLS.length - 1) * GAPX; const H = Math.ceil(maxY + BOTLANES + 60);
const chanX = (k) => (k < 0 ? PADX / 2 : k >= COLS.length - 1 ? W - PADX / 2 : PADX + (k + 1) * BW + k * GAPX + GAPX / 2);
const rowY = (t, name) => { const i = rows[t].findIndex((r) => r.name === name); return pos[t].y + HEAD + 10 + Math.max(0, i) * ROW; };

const edges = [];
for (const t of tables) for (const f of info[t].fks) {
  if (OMIT.has(`${t}.${f.from}`)) continue;
  const col = info[t].cols.find((c) => c.name === f.from);
  edges.push({ child: t, parent: f.table, fk: f.from, optional: !col.notnull });
}
// routing
const laneUse = new Map(); const lane = (k) => { const n = laneUse.get(k) || 0; laneUse.set(k, n + 1); return n; };
let topN = 0; let botN = 0; const pUse = new Map(); const cUse = new Map();
let svg = '';
const marks = [];
const midY = (TOPLANES + maxY) / 2;
for (const e of edges.sort((a, b) => pos[a.child].col - pos[b.child].col || pos[a.child].y - pos[b.child].y)) {
  const c = pos[e.child]; const p = pos[e.parent];
  const parentPk = rows[e.parent].find((r) => r.tag.startsWith('PK')).name;
  let cSide; let pSide; let cK; let pK;
  if (p.col > c.col) { cSide = 1; pSide = -1; cK = c.col; pK = p.col - 1; }
  else if (p.col < c.col) { cSide = -1; pSide = 1; cK = c.col - 1; pK = p.col; }
  else { cSide = 1; pSide = 1; cK = c.col; pK = c.col; }
  const cx = cSide === 1 ? c.x + c.w : c.x; const px = pSide === 1 ? p.x + p.w : p.x;
  const ck = `${e.child}.${e.fk}`; const pk = e.parent + (pSide === 1 ? 'R' : 'L');
  const sy = rowY(e.child, e.fk) + ((cUse.get(ck) || 0) * 3); cUse.set(ck, 1);
  const pi = pUse.get(pk) || 0; pUse.set(pk, pi + 1);
  const ey = rowY(e.parent, parentPk) + ((pi % 6) - 2) * 3;
  const color = EDGE_COLOR[e.parent] || '#64748b';
  const LANE = 7;
  let d;
  if (cK === pK) {
    const x = chanX(cK) - 36 + lane(cK) * LANE;
    d = `M${cx} ${sy} H${x} V${ey} H${px}`;
  } else {
    const xc = chanX(cK) - 36 + lane(cK) * LANE; const xp = chanX(pK) - 36 + lane(pK) * LANE;
    const top = topN <= botN; // balance the two bus areas
    const hy = top ? 66 + (topN++) * 6 : maxY + 12 + (botN++) * 6;
    d = `M${cx} ${sy} H${xc} V${hy} H${xp} V${ey} H${px}`;
  }
  svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.7" opacity=".85" stroke-linejoin="round"/>`;
  // child end: crow's foot
  const o = cSide;
  marks.push(`<path d="M${cx + o * 13} ${sy} L${cx} ${sy - 6} M${cx + o * 13} ${sy} L${cx} ${sy + 6}" stroke="${color}" stroke-width="1.7" fill="none"/>`);
  // parent end: one / optional
  const q = pSide;
  marks.push(`<path d="M${px + q * 8} ${ey - 6} V${ey + 6}" stroke="${color}" stroke-width="2"/>`);
  marks.push(e.optional ? `<circle cx="${px + q * 17}" cy="${ey}" r="4.5" fill="#fff" stroke="${color}" stroke-width="1.7"/>` : `<path d="M${px + q * 14} ${ey - 6} V${ey + 6}" stroke="${color}" stroke-width="2"/>`);
}
let g = `<text x="${PADX}" y="34" font-size="26" font-weight="700" fill="#0f172a">ReliefGrid: entity-relationship diagram</text>
<text x="${PADX}" y="54" font-size="14.5" fill="#475569">22 tables and ${edges.length} foreign-key relationships, generated from the live SQLite schema (PRAGMA table_info / foreign_key_list). Each connector is coloured by the table it references.</text>`;
g += svg;
for (const t of tables) {
  const p = pos[t]; const d = domainOf(t);
  g += `<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="${SOFT[d]}" stroke="${COLORS[d]}" stroke-width="2"/>
  <path d="M${p.x} ${p.y + HEAD} V${p.y + 8} Q${p.x} ${p.y} ${p.x + 8} ${p.y} H${p.x + p.w - 8} Q${p.x + p.w} ${p.y} ${p.x + p.w} ${p.y + 8} V${p.y + HEAD} Z" fill="${COLORS[d]}"/>
  <text x="${p.x + 12}" y="${p.y + 20}" font-size="15.5" font-weight="700" fill="#fff">${t}</text>`;
  rows[t].forEach((r, i) => {
    const y = p.y + HEAD + 10 + i * ROW; const isKey = r.tag.includes('PK');
    g += `<text x="${p.x + 12}" y="${y + 5}" font-size="13.5" font-weight="${isKey ? 700 : 400}" fill="${isKey ? '#0f172a' : '#334155'}">${esc(r.name)}</text>`;
    if (r.tag) g += `<text x="${p.x + p.w - 10}" y="${y + 5}" font-size="11.5" font-weight="700" text-anchor="end" fill="${r.tag === 'FK' ? '#b45309' : '#1d4ed8'}">${r.tag}</text>`;
  });
  g += '</g>';
}
g += marks.join('');
// legend
const ly = H - 70; let lx = PADX;
for (const [d, label] of [['reference', 'Reference data'], ['places', 'Places and people'], ['demand', 'Demand'], ['stock', 'Warehouse stock'], ['decisions', 'Allocation decisions'], ['logistics', 'Logistics'], ['audit', 'Audit']]) {
  g += `<rect x="${lx}" y="${ly}" width="16" height="16" rx="3" fill="${COLORS[d]}"/><text x="${lx + 24}" y="${ly + 13}" font-size="13" fill="#0f172a">${label}</text>`;
  lx += 24 + label.length * 7.4 + 28;
}
g += `<text x="${PADX}" y="${ly + 40}" font-size="12.5" fill="#475569">Notation: crow\u2019s foot = many (child end);  | = exactly one parent;  \u25cb = optional parent (nullable foreign key);  PK = primary key;  FK = foreign key.  Actor columns (user_id, actor_id, run_by, distributed_by, last_actor_id) also reference users and are not drawn.</text>`;
const full = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="#fff"/>${g}</svg>`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await page.setContent(`<html><body style="margin:0">${full}</body></html>`);
await page.screenshot({ path: path.join(OUT, 'er_diagram.png'), clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
fs.writeFileSync(path.join(OUT, 'er_meta.json'), JSON.stringify({ tables: tables.length, edges: edges.length, W, H }));
console.log('ER done', W, H, 'edges', edges.length);

