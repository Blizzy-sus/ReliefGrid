// ER diagram via Mermaid auto-layout, generated from the live schema (PRAGMA introspection).
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const OUT = path.join(here, '..', 'assets', 'diagrams');
const { openDb, migrate } = await import(pathToFileURL(path.join(ROOT, 'server/db.js')).href);

const db = openDb(':memory:'); migrate(db);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all().map((r) => r.name);
const EXTRA = {
  disasters: ['name', 'type', 'status'], camps: ['name', 'capacity', 'population', 'vulnerable_count', 'status'], warehouses: ['name', 'latitude', 'longitude', 'status'],
  users: ['username', 'role'], sessions: ['expires_at'], urgency_levels: ['label', 'weight', 'sla_hours'], requests: ['status', 'created_at'],
  request_items: ['quantity_requested', 'quantity_approved', 'quantity_allocated', 'quantity_delivered'], supply_categories: ['name'], supply_items: ['name', 'unit', 'standard_per_person_per_day'],
  allocation_settings: ['value'], inventory: ['quantity_on_hand', 'quantity_reserved', 'reorder_level'], stock_movements: ['movement_type', 'delta_on_hand', 'delta_reserved'],
  allocation_runs: ['created_at', 'units_allocated'], allocation_decisions: ['approved_qty', 'prior_qty', 'need_qty', 'priority_score', 'allocated_qty'], allocation_lines: ['quantity', 'distance_km'],
  shipments: ['code', 'status', 'distance_km'], shipment_items: ['quantity', 'quantity_received'], shipment_events: ['status', 'created_at'], camp_stock: ['quantity'],
  distributions: ['quantity', 'people_served'], audit_log: ['action', 'created_at'],
};
const OMIT = new Set(['audit_log.user_id', 'stock_movements.user_id', 'shipment_events.actor_id', 'distributions.distributed_by', 'allocation_runs.run_by', 'shipments.last_actor_id']);
let def = 'erDiagram\n';
const rels = [];
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => ({ ...c }));
  const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all().map((f) => ({ ...f }));
  const fkSet = new Set(fks.map((f) => f.from));
  const pick = [];
  for (const c of cols) if (c.pk > 0) pick.push(c);
  for (const c of cols) if (c.pk === 0 && fkSet.has(c.name)) pick.push(c);
  for (const n of EXTRA[t] || []) { const c = cols.find((x) => x.name === n); if (c && !pick.includes(c)) pick.push(c); }
  def += `  ${t} {\n`;
  for (const c of pick) {
    const tags = [c.pk > 0 ? 'PK' : null, fkSet.has(c.name) ? 'FK' : null].filter(Boolean).join(',');
    def += `    ${(c.type || 'TEXT').split('(')[0].toLowerCase()} ${c.name}${tags ? ' ' + tags : ''}\n`;
  }
  def += '  }\n';
  for (const f of fks) {
    if (OMIT.has(`${t}.${f.from}`)) continue;
    const nullable = !cols.find((c) => c.name === f.from).notnull;
    rels.push(`  ${f.table} ${nullable ? '|o' : '||'}--o{ ${t} : "${f.from}"`);
  }
}
def += rels.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'er.mmd'), def);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 2600, height: 1800, deviceScaleFactor: 2 });
const html = `<html><body style="margin:0;background:#fff"><div id="g" style="padding:20px;display:inline-block"><pre class="mermaid">${def.replace(/</g, '&lt;')}</pre></div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'base',er:{useMaxWidth:false,layoutDirection:'LR',minEntityWidth:150,entityPadding:12,fontSize:13},
 themeVariables:{fontFamily:'Segoe UI, Arial',primaryColor:'#eff6ff',primaryBorderColor:'#1d4ed8',primaryTextColor:'#0f172a',lineColor:'#475569',tertiaryColor:'#ffffff',fontSize:'13px'}});</script></body></html>`;
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.waitForSelector('svg', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
const el = await page.$('#g');
const box = await el.boundingBox();
console.log('size', box.width, box.height);
await el.screenshot({ path: path.join(OUT, 'er_mermaid.png') });
await browser.close();
