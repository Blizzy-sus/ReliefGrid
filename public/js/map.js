// Offline situational map: an equirectangular projection of camps and warehouses drawn as SVG.
import { esc, raw } from './ui.js';

const URG_COLOR = { 4: 'var(--crit)', 3: 'var(--high)', 2: 'var(--mod)', 1: 'var(--low)', 0: 'var(--ok)' };

export function situationMap({ camps, warehouses, routes = [] }) {
  camps = camps.filter((c) => c.status !== 'CLOSED');
  const pts = [...camps, ...warehouses];
  if (!pts.length) return raw('<div class="empty">No locations yet.</div>');
  const W = 540; const pad = 46;
  const lats = pts.map((p) => p.latitude); const lons = pts.map((p) => p.longitude);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max(0.05, (maxLon - minLon) * kx); const spanY = Math.max(0.05, maxLat - minLat);
  // Portrait or landscape depending on the geography, within sensible bounds.
  const H = Math.round(Math.min(700, Math.max(360, ((W - pad * 2) * spanY) / spanX + pad * 2)));
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const offX = (W - spanX * scale) / 2; const offY = (H - spanY * scale) / 2;
  const X = (lon) => offX + (lon - minLon) * kx * scale;
  const Y = (lat) => H - (offY + (lat - minLat) * scale);

  let g = '';
  for (let i = 0; i <= 8; i++) g += `<line x1="${(W / 8) * i}" y1="0" x2="${(W / 8) * i}" y2="${H}" stroke="var(--map-grid)" stroke-width="1" opacity=".6"/>`;
  for (let i = 0; i <= Math.round(H / (W / 8)); i++) g += `<line x1="0" y1="${(W / 8) * i}" x2="${W}" y2="${(W / 8) * i}" stroke="var(--map-grid)" stroke-width="1" opacity=".6"/>`;
  const byId = (list) => new Map(list.map((p) => [p.id, p]));
  const cm = byId(camps); const wm = byId(warehouses);
  for (const r of routes) {
    const a = wm.get(r.warehouseId); const b = cm.get(r.campId);
    if (!a || !b) continue;
    g += `<line x1="${X(a.longitude)}" y1="${Y(a.latitude)}" x2="${X(b.longitude)}" y2="${Y(b.latitude)}" stroke="var(--accent)" stroke-width="1.6" ${r.status === 'IN_TRANSIT' ? 'stroke-dasharray="7 5"' : 'stroke-dasharray="2 6" opacity=".55"'} opacity="${r.status === 'IN_TRANSIT' ? 0.95 : 0.55}"/>`;
  }
  for (const w of warehouses) {
    const x = X(w.longitude); const y = Y(w.latitude);
    const off = w.status !== 'ACTIVE';
    g += `<g class="marker-wh" data-info="${esc(`${w.name}|Warehouse · ${w.status === 'ACTIVE' ? 'active' : 'offline'}|${Math.round(w.available).toLocaleString()} units available`)}">
      <rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="4" fill="${off ? 'var(--faint)' : 'var(--low)'}" stroke="var(--map-bg)" stroke-width="2"/>
      <path d="M${x - 4} ${y + 3} V${y - 2} L${x} ${y - 5} L${x + 4} ${y - 2} V${y + 3} Z" fill="var(--map-bg)"/></g>
      <text x="${x}" y="${y + 24}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(w.name.replace(/ (Central )?(Relief )?(Depot|Warehouse|Store|Hub)$/i, ''))}</text>`;
  }
  const maxPop = Math.max(1, ...camps.map((c) => c.population));
  for (const c of camps) {
    if (c.status === 'CLOSED') continue;
    const x = X(c.longitude); const y = Y(c.latitude);
    const r = 6 + 8 * Math.sqrt(c.population / maxPop);
    const col = URG_COLOR[c.maxUrgency || 0];
    const info = `${c.name}|${c.population.toLocaleString()} people · ${c.openRequests} open request${c.openRequests === 1 ? '' : 's'}|${c.activeShipments} shipment${c.activeShipments === 1 ? '' : 's'} on the way`;
    g += `<g class="marker-camp" data-camp="${c.id}" data-info="${esc(info)}" tabindex="0" role="link" aria-label="${esc(c.name)}">
      ${c.maxUrgency === 4 ? `<circle class="pulse-ring" cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="2"/>` : ''}
      <circle cx="${x}" cy="${y}" r="${r}" fill="${col}" fill-opacity=".85" stroke="var(--map-bg)" stroke-width="2"/></g>`;
  }
  g += `<g transform="translate(${W - 30} 34)" fill="var(--faint)" font-size="11" text-anchor="middle"><path d="M0 -20 L6 4 L0 0 L-6 4 Z" fill="var(--faint)"/><text y="18">N</text></g>`;
  return raw(`<div class="map-wrap" id="situation-map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of relief camps and warehouses">${g}</svg>
    <div class="map-info" id="map-info" hidden></div></div>
    <div class="map-legend">
      <span><i style="background:var(--crit)"></i>Critical request open</span><span><i style="background:var(--high)"></i>High</span>
      <span><i style="background:var(--mod)"></i>Moderate</span><span><i style="background:var(--low)"></i>Low</span><span><i style="background:var(--ok)"></i>No open requests</span>
      <span><i class="sq" style="background:var(--low)"></i>Warehouse</span><span>Circle size = population · dashed lines = shipments</span>
    </div>`);
}

/** Wire hover/focus info and click-through after the map is in the DOM. */
export function bindMap(root, onCamp) {
  const wrap = root.querySelector('#situation-map');
  if (!wrap) return;
  const info = wrap.querySelector('#map-info');
  const show = (el) => {
    const [title, a, b] = el.dataset.info.split('|');
    info.innerHTML = `<b>${esc(title)}</b>${esc(a)}<br>${esc(b)}`;
    info.hidden = false;
  };
  wrap.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-info]'); if (el) show(el); });
  wrap.addEventListener('focusin', (e) => { const el = e.target.closest('[data-info]'); if (el) show(el); });
  wrap.addEventListener('mouseleave', () => { info.hidden = true; });
  wrap.addEventListener('click', (e) => { const el = e.target.closest('[data-camp]'); if (el) onCamp(Number(el.dataset.camp)); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const el = e.target.closest('[data-camp]'); if (el) onCamp(Number(el.dataset.camp)); } });
}
