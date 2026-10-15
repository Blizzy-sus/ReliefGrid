// Small dependency-free SVG charts.
import { html, raw, esc, n } from './ui.js';

const PALETTE = ['var(--accent)', 'var(--ok)', 'var(--high)', 'var(--low)', 'var(--crit)', 'var(--mod)', '#b08cff'];
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

/** Vertical grouped columns. series: [{ name, color, values: [] }], labels: [] */
export function columnChart({ labels, series, height = 220, format = n, yMax }) {
  const W = 640; const H = height; const padL = 44; const padR = 10; const padT = 10; const padB = 34;
  const max = yMax || niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const groupW = plotW / Math.max(1, labels.length);
  const barW = Math.min(34, (groupW * 0.72) / series.length);
  let out = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Column chart">`;
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i) / 4;
    out += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${esc(format((max * i) / 4))}</text>`;
  }
  labels.forEach((label, gi) => {
    const gx = padL + gi * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.values[gi] || 0;
      const h = (v / max) * plotH;
      out += `<rect x="${gx + si * barW}" y="${padT + plotH - h}" width="${barW - 2}" height="${Math.max(0, h)}" rx="3" fill="${s.color || PALETTE[si % PALETTE.length]}"><title>${esc(s.name)} · ${esc(label)}: ${esc(format(v))}</title></rect>`;
    });
    out += `<text x="${padL + gi * groupW + groupW / 2}" y="${H - 14}" text-anchor="middle">${esc(label)}</text>`;
  });
  out += '</svg>';
  const legend = series.length > 1
    ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return raw(out + legend);
}

/** Horizontal bars with labels. items: [{ label, value, color, note }] */
export function hBars({ items, max, format = n, color = 'var(--accent)' }) {
  const m = max || Math.max(1, ...items.map((i) => i.value));
  return html`<div class="stack" style="gap:10px">${items.map((it) => html`
    <div class="supply-row" style="grid-template-columns:minmax(110px,1.1fr) minmax(100px,2fr) auto">
      <div class="name">${it.label}${it.note ? html`<small>${it.note}</small>` : ''}</div>
      <div class="bar tall"><i style="width:${Math.min(100, (it.value / m) * 100)}%;background:${it.color || color}"></i></div>
      <div class="figs">${format(it.value)}</div>
    </div>`)}</div>`;
}

/** Donut. slices: [{ label, value, color }] */
export function donut({ slices, size = 150, center }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 52; const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total === 0
    ? `<circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--panel-3)" stroke-width="18"/>`
    : slices.filter((s) => s.value > 0).map((s) => {
      const len = (s.value / total) * c;
      const el = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      offset += len;
      return el;
    }).join('');
  return raw(`<div class="donut-wrap"><svg viewBox="0 0 140 140" width="${size}" height="${size}" role="img" aria-label="Donut chart">${arcs}
    <text x="70" y="68" text-anchor="middle" style="fill:var(--text);font-size:26px;font-weight:700">${total}</text>
    <text x="70" y="86" text-anchor="middle" style="font-size:10px;fill:var(--muted)">${esc(center || 'total')}</text></svg>
    <div class="stack" style="gap:8px">${slices.map((s) => `<span class="legend"><span><i style="background:${s.color}"></i>${esc(s.label)} <b style="color:var(--text)">${s.value}</b></span></span>`).join('')}</div></div>`);
}
