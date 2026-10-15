// Report diagrams, designed on ~1000 px canvases so that text prints at >= 6.5 pt on a portrait page.
// Architecture, allocation flow, shipment states, commit sequence, and two result charts computed with the real engine.
// (The ER diagram is generated separately by er_diagram.mjs.)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const OUT = path.join(here, '..', 'assets', 'diagrams');
fs.mkdirSync(OUT, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { openDb, migrate } = await imp('server/db.js');
const { seedDatabase } = await imp('server/seed.js');
const { previewAllocation } = await imp('server/services/allocation.js');
const { fairShare, priorityScore } = await imp('server/allocation/engine.js');
const { fifo, proportionalToNeed, strictPriority } = await imp('scripts/baselines.js');

const FONT = "'Segoe UI', Arial, sans-serif";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svgWrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker>
  <marker id="arrowB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1d4ed8"/></marker>
</defs><rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
const rect = (x, y, w, h, { fill = '#fff', stroke = '#94a3b8', r = 8, sw = 1.6, dash } = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
const text = (x, y, s, { size = 14, weight = 400, fill = '#0f172a', anchor = 'start' } = {}) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const line = (x1, y1, x2, y2, { stroke = '#475569', sw = 1.8, arrow, dash } = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${arrow ? `marker-end="url(#${arrow})"` : ''} ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
function lines(x, y, arr, { size = 13.5, gap = 5, fill = '#334155', anchor = 'start', bullet = '' } = {}) {
  return arr.map((l, i) => text(x, y + i * (size + gap), bullet + l, { size, fill, anchor })).join('');
}

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'] });
async function render(name, svg, w, h, scale = 2.4) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log('diagram', name);
}

// ============================================================== 1. architecture
{
  const W = 1000; const H = 880;
  let g = text(30, 34, 'ReliefGrid: system architecture', { size: 21, weight: 700 });
  const roles = [['Administrator', 'runs allocation'], ['Warehouse manager', 'stock and dispatch'], ['Camp coordinator', 'requests, receipts'], ['Volunteer', 'delivers shipments']];
  roles.forEach(([t, s], i) => { const x = 30 + i * 240; g += rect(x, 52, 225, 56, { fill: '#f8fafc', stroke: '#94a3b8' }) + text(x + 112, 77, t, { size: 15, weight: 700, anchor: 'middle' }) + text(x + 112, 97, s, { size: 12.5, anchor: 'middle', fill: '#475569' }); });
  roles.forEach((_, i) => { g += line(142 + i * 240, 108, 142 + i * 240, 124); });
  g += line(142, 124, 142 + 3 * 240, 124) + line(500, 124, 500, 146, { arrow: 'arrow' });
  const layer = (y, h, title, color, soft) => rect(20, y, 960, h, { fill: soft, stroke: color, sw: 2.6, r: 12 }) + text(40, y + 28, title, { size: 15.5, weight: 700, fill: color });
  // presentation
  g += layer(148, 160, 'PRESENTATION: single-page web app (ES modules, no build step)', '#1d4ed8', '#eff6ff');
  const ui = [['Router + session', ['hash routes,', 'role-aware navigation']], ['9 page modules', ['dashboard, requests,', 'allocation, shipments,', 'inventory, camps,', 'distribution, analytics,', 'administration']], ['api.js', ['fetch wrapper with', 'bearer token and', 'uniform errors']], ['ui.js, charts, map', ['auto-escaping HTML', 'templates, SVG charts,', 'schematic map']]];
  ui.forEach(([t, ls], i) => { const x = 40 + i * 235; g += rect(x, 184, 215, 114, { fill: '#fff', stroke: '#93c5fd' }) + text(x + 12, 206, t, { size: 14.5, weight: 700 }) + lines(x + 12, 226, ls, { size: 12.5, gap: 3 }); });
  g += line(500, 310, 500, 332, { arrow: 'arrowB', stroke: '#1d4ed8', sw: 2.4 }) + text(516, 326, 'JSON over HTTP, bearer token', { size: 13, fill: '#1d4ed8' });
  // application
  g += layer(334, 206, 'APPLICATION: Node.js 22 and Express 5', '#15803d', '#f0fdf4');
  const sv = [['Middleware', ['security headers, CSP', 'JSON limit 100 KB', 'hashed-session auth', 'login rate limiter']], ['Routes', ['master.js, ops.js', 'role gates + scope', 'input validation', 'uniform errors']], ['Services', ['one per operation', 'tx(): BEGIN IMMEDIATE', 'ledger + audit writes', 'reports and alerts']], ['Allocation engine', ['pure functions, no I/O', 'priorityScore()', 'fairShare(): exact solver', 'allocate(): sourcing']]];
  sv.forEach(([t, ls], i) => { const x = 40 + i * 235; g += rect(x, 372, 215, 152, { fill: '#fff', stroke: '#86efac' }) + text(x + 12, 396, t, { size: 14.5, weight: 700 }) + lines(x + 12, 420, ls, { size: 13, gap: 12, bullet: '\u2022 ' }); if (i < 3) g += line(x + 215, 448, x + 235, 448, { arrow: 'arrow' }); });
  g += line(500, 542, 500, 572, { arrow: 'arrow', sw: 2.4 }) + text(516, 562, 'prepared statements, bound parameters', { size: 13, fill: '#475569' });
  // data
  g += layer(574, 176, 'DATA: SQLite (node:sqlite), WAL journal, foreign keys ON', '#7e22ce', '#faf5ff');
  const db = [['22 tables', ['normalised (3NF),', 'documented', 'exceptions']], ['Constraints', ['PK, FK, UNIQUE,', 'CHECK: stock never', 'negative or over-', 'reserved']], ['21 triggers', ['append-only history,', 'shipment state', 'machine, timeline']], ['9 views', ['reporting views', 'and 4 reconciliation', 'views']], ['24 indexes', ['including a partial', 'index on open', 'demand']]];
  db.forEach(([t, ls], i) => { const x = 40 + i * 185; g += rect(x, 610, 172, 126, { fill: '#fff', stroke: '#d8b4fe' }) + text(x + 10, 633, t, { size: 14.5, weight: 700 }) + lines(x + 10, 654, ls, { size: 12.5, gap: 4 }); });
  // supporting
  g += rect(20, 770, 960, 92, { fill: '#f8fafc', stroke: '#94a3b8', dash: '6 4' }) + text(40, 797, 'Supporting artefacts', { size: 14.5, weight: 700, fill: '#475569' });
  g += text(40, 822, '4 checksum-verified migrations  \u2022  seed script replaying three days of operations through the real services', { size: 13 });
  g += text(40, 844, '71 automated tests  \u2022  scenario harness with baselines  \u2022  17 showcase SQL queries', { size: 13 });
  await render('architecture', svgWrap(W, H, g), W, H);
}

// ============================================================== 2. allocation flow
{
  const W = 1000; const H = 930;
  let g = text(30, 34, 'Allocation procedure for one run (single transaction)', { size: 21, weight: 700 });
  const step = (x, y, w, h, title, sub, color, soft) => {
    let s = rect(x, y, w, h, { fill: soft, stroke: color, sw: 2.2, r: 10 });
    s += text(x + w / 2, y + 26, title, { size: 15.5, weight: 700, anchor: 'middle', fill: color });
    sub.forEach((l, i) => { s += text(x + w / 2, y + 48 + i * 19, l, { size: 13.5, anchor: 'middle', fill: '#334155' }); });
    return s;
  };
  const cx = 300; const bw = 480; const bx = cx - bw / 2;
  g += step(bx, 56, bw, 84, '1. BEGIN IMMEDIATE, then re-read inputs', ['open demand, stock per warehouse, camps,', 'parameters and urgency weights'], '#0f766e', '#f0fdfa');
  g += line(cx, 140, cx, 164, { arrow: 'arrow' });
  g += step(bx, 164, bw, 84, '2. Group by supply item and score every line', ['score = urgency weight × (1 + at-risk share)', '× (1 + aging bonus)'], '#c2410c', '#fff7ed');
  g += line(cx, 248, cx, 276, { arrow: 'arrow' });
  g += `<polygon points="${cx},276 ${cx + 220},336 ${cx},396 ${cx - 220},336" fill="#fefce8" stroke="#a16207" stroke-width="2.2"/>`;
  g += text(cx, 330, 'Stock S ≥ total', { size: 15, weight: 700, anchor: 'middle', fill: '#854d0e' }) + text(cx, 352, 'remaining need?', { size: 15, weight: 700, anchor: 'middle', fill: '#854d0e' });
  g += line(cx + 220, 336, 650, 336, { arrow: 'arrow' }) + text(cx + 240, 326, 'yes', { size: 14, weight: 700, fill: '#15803d' });
  g += step(650, 296, 330, 80, 'Everyone gets full need', ['no rationing needed'], '#15803d', '#f0fdf4');
  g += line(cx, 396, cx, 430, { arrow: 'arrow' }) + text(cx + 12, 418, 'no (scarce)', { size: 14, weight: 700, fill: '#b91c1c' });
  g += step(bx, 430, bw, 112, '3. Solve the fair level λ', ['x = clamp(A·λ·score − P, 0, need) with Σx = S', 'exact: piecewise-linear over sorted breakpoints'], '#7e22ce', '#faf5ff');
  g += line(cx, 542, cx, 568, { arrow: 'arrow' });
  g += step(bx, 568, bw, 84, '4. Largest-remainder rounding', ['whole units; total equals S exactly;', 'nobody exceeds their need'], '#7e22ce', '#faf5ff');
  g += line(cx, 652, cx, 678, { arrow: 'arrow' });
  g += step(bx, 678, bw, 84, '5. Choose source warehouses', ['highest priority first, nearest warehouse', 'first, split across warehouses if needed'], '#1d4ed8', '#eff6ff');
  g += `<path d="M815 376 V720 H${bx + bw}" fill="none" stroke="#475569" stroke-width="1.8" marker-end="url(#arrow)"/>`;
  g += line(cx, 762, cx, 788, { arrow: 'arrow' });
  g += step(bx, 788, bw, 110, '6. Write the result, then COMMIT', ['run, decisions, lines, shipments, reservations,', 'ledger rows, counters and audit rows;', 'any failure rolls everything back'], '#475569', '#f1f5f9');
  g += rect(650, 56, 330, 186, { fill: '#fff', stroke: '#cbd5e1', dash: '6 4' }) + text(666, 84, 'Where each input comes from', { size: 15, weight: 700 });
  g += lines(666, 112, ['urgency weight: urgency_levels', 'at-risk share: camps', 'aging: now − requests.created_at', 'A and P: request_items', 'stock S: inventory'], { size: 13.5, gap: 10, bullet: '• ' });
  await render('allocation_flow', svgWrap(W, H, g), W, H);
}

// ============================================================== 3. shipment state machine
{
  const W = 1000; const H = 560;
  let g = text(30, 34, 'Shipment life-cycle', { size: 21, weight: 700 });
  g += text(30, 62, 'Enforced by trigger trg_shipments_valid_transition; every legal change writes a shipment_events row.', { size: 13.5, fill: '#334155' });
  const st = (x, y, name, sub, color, soft) => rect(x, y, 210, 98, { fill: soft, stroke: color, sw: 2.6, r: 49 }) + text(x + 105, y + 44, name, { size: 19, weight: 700, anchor: 'middle', fill: color }) + text(x + 105, y + 68, sub, { size: 13.5, anchor: 'middle', fill: '#475569' });
  g += st(30, 130, 'PLANNED', 'stock reserved', '#1d4ed8', '#eff6ff');
  g += st(395, 130, 'IN_TRANSIT', 'left the warehouse', '#7e22ce', '#faf5ff');
  g += st(760, 130, 'DELIVERED', 'camp stock updated', '#15803d', '#f0fdf4');
  g += st(395, 330, 'CANCELLED', 'reservation released', '#b91c1c', '#fef2f2');
  g += line(240, 179, 393, 179, { arrow: 'arrow', sw: 2.4 }) + text(316, 160, 'dispatch', { size: 15, weight: 700, anchor: 'middle' }) + text(316, 205, 'manager or admin', { size: 12.5, anchor: 'middle', fill: '#475569' });
  g += line(605, 179, 758, 179, { arrow: 'arrow', sw: 2.4 }) + text(681, 160, 'confirm delivery', { size: 15, weight: 700, anchor: 'middle' }) + text(681, 205, 'volunteer, camp, admin', { size: 12.5, anchor: 'middle', fill: '#475569' });
  g += `<path d="M135 228 C135 330, 260 379, 393 379" fill="none" stroke="#475569" stroke-width="2.4" marker-end="url(#arrow)"/>` + text(150, 322, 'cancel', { size: 15, weight: 700 }) + text(150, 342, '(only before dispatch)', { size: 12.5, fill: '#475569' });
  g += rect(30, 450, 940, 92, { fill: '#fffbeb', stroke: '#fcd34d' });
  g += lines(46, 476, ['Delivery: units reported short are subtracted from request_items.quantity_allocated, so the', 'shortfall returns to the open-demand queue for the next run.', 'Dispatch reduces on-hand and reserved stock together; cancel reduces only reserved stock.'], { size: 13.5, gap: 6, fill: '#78350f' });
  await render('shipment_states', svgWrap(W, H, g), W, H);
}

// ============================================================== 4. sequence diagram
{
  const W = 1000; const H = 860;
  let g = text(30, 34, 'Committing an allocation run: sequence', { size: 21, weight: 700 });
  const lanes = [['Admin UI', 100], ['Express route', 300], ['Allocation service', 500], ['Engine (pure)', 700], ['SQLite', 900]];
  lanes.forEach(([n, x]) => { g += rect(x - 82, 56, 164, 40, { fill: '#eff6ff', stroke: '#1d4ed8' }) + text(x, 82, n, { size: 14.5, weight: 700, anchor: 'middle', fill: '#1d4ed8' }) + line(x, 96, x, 790, { stroke: '#94a3b8', dash: '6 5', sw: 1.4 }); });
  const X = Object.fromEntries(lanes);
  const msg = (from, to, y, label, { dashed, self } = {}) => {
    const a = X[from]; const b = X[to];
    if (self) return `<path d="M${a} ${y} h54 v26 h-54" fill="none" stroke="#475569" stroke-width="1.8" marker-end="url(#arrow)"/>` + text(a + 64, y + 17, label, { size: 13 });
    return line(a, y, b, y, { arrow: 'arrow', dash: dashed ? '6 4' : undefined }) + text((a + b) / 2, y - 7, label, { size: 13, anchor: 'middle' });
  };
  let y = 134; const step = 46;
  const M = [
    ['Admin UI', 'Express route', '1  POST /api/allocation/run'],
    ['Express route', 'Express route', '2  authenticate, requireRole(admin)', { self: true }],
    ['Express route', 'Allocation service', '3  commitAllocation(user)'],
    ['Allocation service', 'SQLite', '4  BEGIN IMMEDIATE'],
    ['Allocation service', 'SQLite', '5  read demand, stock, settings'],
    ['SQLite', 'Allocation service', 'rows', { dashed: true }],
    ['Allocation service', 'Engine (pure)', '6  allocate(inputs)'],
    ['Engine (pure)', 'Allocation service', 'decisions, sources', { dashed: true }],
    ['Allocation service', 'SQLite', '7  INSERT run, decisions, shipments'],
    ['Allocation service', 'SQLite', '8  reserve: UPDATE ... WHERE avail. >= q'],
    ['Allocation service', 'SQLite', '9  INSERT ledger, UPDATE counters, audit'],
    ['Allocation service', 'SQLite', '10  COMMIT (any error: ROLLBACK)'],
    ['Allocation service', 'Express route', 'run id and plan', { dashed: true }],
    ['Express route', 'Admin UI', '201 Created', { dashed: true }],
  ];
  M.forEach(([f, t, l, o], i) => { g += msg(f, t, y, l, o || {}); y += o && o.self ? 56 : step; });
  g += rect(20, 780, 960, 62, { fill: '#fef2f2', stroke: '#fca5a5' });
  g += lines(34, 804, ['If step 8 changes zero rows (stock changed) the service raises INSUFFICIENT_STOCK and everything rolls back;', 'CHECK (reserved <= on hand) is the final safeguard.'], { size: 13, gap: 6, fill: '#7f1d1d' });
  await render('commit_sequence', svgWrap(W, H, g), W, H);
}

// ============================================================== 5. chart: method comparison (real engine output)
{
  const NOW = new Date('2026-07-15T12:00:00Z');
  const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  const W8 = { Critical: 6, High: 3.5, Moderate: 2, Low: 1 };
  const camps = [
    { name: 'Riverside', pop: 800, vul: 0.28, urgency: 'Critical', wait: 5, need: 12000 },
    { name: 'Temple Hall', pop: 300, vul: 0.32, urgency: 'High', wait: 20, need: 4500 },
    { name: 'Stadium', pop: 950, vul: 0.27, urgency: 'High', wait: 12, need: 14000 },
    { name: 'Town Hall', pop: 270, vul: 0.22, urgency: 'Moderate', wait: 30, need: 4000 },
    { name: 'Polytechnic', pop: 700, vul: 0.21, urgency: 'Moderate', wait: 8, need: 10500 },
    { name: 'Youth Hostel', pop: 230, vul: 0.2, urgency: 'Low', wait: 44, need: 3400 },
  ];
  const entries = camps.map((c, i) => { const p = priorityScore({ urgencyWeight: W8[c.urgency], population: c.pop, vulnerableCount: Math.round(c.pop * c.vul), createdAt: hoursAgo(c.wait), now: NOW }); return { id: i, approved: c.need, prior: 0, need: c.need, score: p.score, createdAt: hoursAgo(c.wait) }; });
  const supply = 19000;
  const methods = [['ReliefGrid', fairShare(entries, supply).shares, '#1d4ed8'], ['First come, first served', fifo(entries, supply), '#94a3b8'], ['Equal share of need', proportionalToNeed(entries, supply), '#f59e0b'], ['Strict priority', strictPriority(entries, supply), '#b91c1c']];
  const W = 1000; const H = 560; const pl = 56; const pt = 74; const pw = W - pl - 20; const ph = 340;
  let g = text(30, 32, 'Coverage by allocation method: 19,000 L of water for 48,400 L demanded', { size: 18.5, weight: 700 });
  for (let i = 0; i <= 4; i++) { const yy = pt + ph - (ph * i) / 4; g += line(pl, yy, pl + pw, yy, { stroke: '#e2e8f0', sw: 1 }) + text(pl - 8, yy + 4, `${i * 25}%`, { size: 12.5, anchor: 'end', fill: '#64748b' }); }
  const gw = pw / camps.length; const bw = 31;
  camps.forEach((c, gi) => {
    const gx = pl + gi * gw + (gw - bw * 4) / 2;
    methods.forEach(([, m, col], mi) => { const v = m.get(gi) / camps[gi].need; const h = v * ph; g += `<rect x="${gx + mi * bw}" y="${pt + ph - h}" width="${bw - 3}" height="${h}" rx="3" fill="${col}"/>`; g += text(gx + mi * bw + (bw - 3) / 2, v > 0.02 ? pt + ph - h - 5 : pt + ph - 5, v > 0.02 ? `${Math.round(v * 100)}` : '0', { size: 12, anchor: 'middle', fill: v > 0.02 ? '#334155' : '#b91c1c', weight: 600 }); });
    g += text(pl + gi * gw + gw / 2, pt + ph + 24, c.name, { size: 13.5, weight: 700, anchor: 'middle' }) + text(pl + gi * gw + gw / 2, pt + ph + 43, `${c.urgency}, ${c.wait} h`, { size: 12, anchor: 'middle', fill: '#64748b' });
  });
  let lx = pl; const legY = 478;
  methods.forEach(([n, , col], i) => { const x = i < 2 ? pl + i * 260 : pl + (i - 2) * 260; const y = i < 2 ? legY : legY + 26; g += rect(x, y, 16, 16, { fill: col, stroke: col, r: 3 }) + text(x + 24, y + 13, n, { size: 13.5 }); });
  g += text(pl + 540, legY + 13, 'Waiting time shown after the urgency label.', { size: 12, fill: '#64748b' });
  g += text(pl, 545, 'Percent of each camp\u2019s approved quantity. Computed with the project\u2019s engine and baselines, fixed clock.', { size: 12, fill: '#64748b' });
  await render('chart_methods', svgWrap(W, H, g), W, H);
}

// ============================================================== 6. chart: seeded water allocation by urgency
{
  const db = openDb(':memory:'); migrate(db);
  const NOW = new Date('2026-07-15T12:00:00Z');
  seedDatabase(db, { now: NOW });
  const plan = previewAllocation(db, {}, NOW);
  const water = plan.decisions.filter((d) => d.itemName === 'Packaged drinking water' && d.prior === 0).sort((a, b) => b.score - a.score);
  const COL = { Critical: '#dc2626', High: '#ea580c', Moderate: '#ca8a04', Low: '#2563eb' };
  const W = 1000; const rowH = 34; const H = 120 + water.length * rowH + 30;
  let g = text(30, 32, 'Seeded incident: drinking-water coverage by camp', { size: 19, weight: 700 });
  g += text(30, 56, '21,000 L in stock for 58,535 L of open demand; lines that started from zero, sorted by priority score.', { size: 13, fill: '#64748b' });
  const pl = 300; const pw = 440;
  for (let i = 0; i <= 4; i++) { const xx = pl + (pw * i) / 4; g += line(xx, 84, xx, 90 + water.length * rowH, { stroke: '#e2e8f0', sw: 1 }) + text(xx, 78, `${i * 25}%`, { size: 12, anchor: 'middle', fill: '#64748b' }); }
  water.forEach((d, i) => {
    const y = 92 + i * rowH;
    g += text(pl - 12, y + 18, d.campName.length > 36 ? d.campName.slice(0, 35) + '\u2026' : d.campName, { size: 13, anchor: 'end', weight: 600 });
    g += rect(pl, y + 3, pw, 22, { fill: '#f1f5f9', stroke: '#f1f5f9', r: 4, sw: 0 });
    g += rect(pl, y + 3, Math.max(2, pw * d.cumulativeCoverage), 22, { fill: COL[d.urgencyLabel], stroke: COL[d.urgencyLabel], r: 4, sw: 0 });
    g += text(pl + pw + 10, y + 20, `${Math.round(d.cumulativeCoverage * 100)}%`, { size: 13.5, weight: 700 });
    g += text(pl + pw + 54, y + 20, `${d.urgencyLabel}, score ${d.score.toFixed(2)}`, { size: 12.5, fill: '#64748b' });
  });
  await render('chart_water', svgWrap(W, H, g), W, H);
}

await browser.close();
console.log('all diagrams done');
