import { html, n, pct, dateTime, meter, coverageClass, empty } from '../ui.js';
import { columnChart, hBars } from '../charts.js';

const URG_COLOR = { 4: 'var(--crit)', 3: 'var(--high)', 2: 'var(--mod)', 1: 'var(--low)' };

export default {
  title: 'Analytics',
  async render(ctx) {
    const a = await ctx.api.get('/analytics');
    const days = a.deliveriesByDay;
    const withLines = a.coverageByUrgency.filter((u) => u.lines > 0);
    return html`
      <div class="page-head"><div><h2>Analytics</h2><p>Is the allocation fair, fast and complete? These views are computed live from the operational tables with SQL joins and aggregates.</p></div></div>
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><div><h2>Coverage by urgency</h2><p>Average share of approved quantity allocated and delivered, per request line</p></div></div>
          ${withLines.length ? columnChart({ labels: withLines.map((u) => u.label), series: [
            { name: 'Allocated', color: 'var(--accent)', values: withLines.map((u) => Math.round((u.avgAllocatedCoverage || 0) * 100)) },
            { name: 'Delivered', color: 'var(--ok)', values: withLines.map((u) => Math.round((u.avgDeliveredCoverage || 0) * 100)) }], format: (v) => `${Math.round(v)}%`, yMax: 100 }) : empty('No data')}</div>
        <div class="card"><div class="card-head"><div><h2>Time to first delivery</h2><p>Average hours from request to the first delivered shipment</p></div></div>
          ${a.hoursToFirstDelivery.length ? hBars({ items: a.hoursToFirstDelivery.map((u) => ({ label: u.label, value: u.avgHours, color: URG_COLOR[u.level], note: `${u.requests} request${u.requests === 1 ? '' : 's'}` })), format: (v) => `${v.toFixed(1)} h` }) : empty('No deliveries yet')}</div>
      </div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card"><div class="card-head"><div><h2>Deliveries per day</h2><p>Shipments confirmed received at camps</p></div></div>
          ${days.length ? columnChart({ labels: days.map((d) => d.day.slice(5)), series: [{ name: 'Shipments delivered', values: days.map((d) => d.shipments) }], format: (v) => String(Math.round(v)) }) : empty('No deliveries yet')}</div>
        <div class="card"><div class="card-head"><div><h2>Stock already committed</h2><p>Share of each category’s warehouse stock reserved for planned shipments</p></div></div>
          ${a.stockByCategory.length ? hBars({ max: 1, format: (v) => `${Math.round(v * 100)}%`, items: a.stockByCategory.map((c) => ({
            label: c.category, value: (c.reserved + c.available) ? c.reserved / (c.reserved + c.available) : 0, color: 'var(--high)', note: `${n(c.available)} available · ${n(c.reserved)} reserved`,
          })) }) : empty('No stock')}</div>
      </div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card flush"><div class="card-head"><div><h2>Largest shortages now</h2><p>Open demand that current stock cannot meet</p></div></div>
          <div class="table-wrap">${a.topShortages.length ? html`<table><thead><tr><th>Item</th><th class="right">Open demand</th><th class="right">Available</th><th>Coverable</th></tr></thead><tbody>
            ${a.topShortages.map((s) => html`<tr><td><b>${s.itemName}</b></td><td class="right num">${n(s.openDemand)} ${s.unit}</td><td class="right num">${n(s.available)}</td><td>${meter(s.coverage, { cls: coverageClass(s.coverage) })}</td></tr>`)}</tbody></table>` : html`<div class="empty"><strong>No shortages</strong>Stock covers every open request.</div>`}</div></div>
        <div class="card flush"><div class="card-head"><div><h2>Camp coverage</h2><p>Average share of approved quantities allocated / delivered, lowest first</p></div></div>
          <div class="table-wrap">${a.campCoverage.length ? html`<table><thead><tr><th>Camp</th><th>Allocated</th><th>Delivered</th></tr></thead><tbody>
            ${a.campCoverage.map((c) => html`<tr><td><b>${c.name}</b><div class="muted" style="font-size:.76rem">${n(c.population)} people · ${c.lines} lines</div></td><td>${meter(c.allocatedCoverage, { cls: coverageClass(c.allocatedCoverage) })}</td><td>${meter(c.deliveredCoverage, { cls: 'ok' })}</td></tr>`)}</tbody></table>` : empty('No data')}</div></div>
      </div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card flush"><div class="card-head"><div><h2>Allocation runs</h2></div></div>
          <div class="table-wrap">${a.runs.length ? html`<table><thead><tr><th>Run</th><th>When</th><th class="right">Lines</th><th class="right">Scarce</th><th class="right">Units</th><th class="right">Shipments</th></tr></thead><tbody>
            ${a.runs.slice().reverse().map((r) => html`<tr><td class="mono">#${r.id}</td><td class="nowrap">${dateTime(r.createdAt)}</td><td class="right num">${r.requests}</td><td class="right num">${r.scarceItems}</td><td class="right num">${n(r.units)}</td><td class="right num">${r.shipments}</td></tr>`)}</tbody></table>` : empty('No runs yet')}</div></div>
        <div class="card"><div class="card-head"><div><h2>Losses in transit</h2><p>Units reported short or damaged at delivery</p></div></div>
          <div class="kpi" style="padding:0"><div class="value">${n(a.losses.units)}</div><div class="sub">across ${a.losses.lines} delivered line${a.losses.lines === 1 ? '' : 's'}. Short quantities return to the allocation queue automatically.</div></div></div>
      </div>`;
  },
};
