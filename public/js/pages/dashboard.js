import { html, icon, n, pct, timeAgo, meter, coverageClass, urgencyBadge, empty } from '../ui.js';
import { situationMap, bindMap } from '../map.js';
import { donut } from '../charts.js';

const ACTION_TEXT = {
  REQUEST_CREATED: 'submitted a supply request', REQUEST_CANCELLED: 'cancelled a request', URGENCY_CHANGED: 'changed a request’s urgency',
  ALLOCATION_RUN: 'committed an allocation run', SHIPMENT_ASSIGNED: 'assigned a volunteer to a shipment', SHIPMENT_DISPATCHED: 'dispatched a shipment',
  SHIPMENT_DELIVERED: 'confirmed a delivery', SHIPMENT_CANCELLED: 'cancelled a shipment', STOCK_RECEIVED: 'received stock', STOCK_ADJUSTED: 'adjusted stock',
  DISTRIBUTION_RECORDED: 'recorded a distribution', CAMP_UPDATED: 'updated camp figures', APPROVAL_OVERRIDDEN: 'overrode an approved quantity',
  SETTINGS_CHANGED: 'changed allocation settings', USER_CREATED: 'created a user', SEED_COMPLETE: 'loaded the demo scenario',
};

export default {
  title: 'Operations dashboard',
  async render(ctx) {
    const d = await ctx.api.get('/dashboard');
    const crit = d.urgency.find((u) => u.level === 4)?.count || 0;
    const shortItems = d.supplyDemand.filter((s) => s.shortage > 0).length;
    ctx.every(30_000, () => ctx.rerender(true));
    ctx.on('open-camp', (el) => ctx.go(`#/camps/${el.dataset.id}`));
    ctx.on('go', (el) => ctx.go(el.dataset.to));

    const urgencySlices = d.urgency.map((u) => ({ label: u.label, value: u.count, color: { 4: 'var(--crit)', 3: 'var(--high)', 2: 'var(--mod)', 1: 'var(--low)' }[u.level] }));
    return html`
      <div class="grid cols-4">
        <div class="card kpi ${crit ? 'crit' : 'ok'}"><div class="label">Open requests</div><div class="value">${d.requests.open ?? 0}</div><div class="sub">${crit} critical · ${d.requests.total} all-time</div></div>
        <div class="card kpi low"><div class="label">Shipments active</div><div class="value">${(d.shipments.planned || 0) + (d.shipments.inTransit || 0)}</div><div class="sub">${d.shipments.inTransit || 0} in transit · ${d.shipments.planned || 0} planned · ${d.shipments.delivered || 0} delivered</div></div>
        <div class="card kpi"><div class="label">People in camps</div><div class="value">${n(d.camps.population)}</div><div class="sub">${d.camps.total} camps · ${pct(d.camps.vulnerable / Math.max(1, d.camps.population))} at-risk</div></div>
        <div class="card kpi ${d.criticalAlerts ? 'crit' : 'ok'}"><div class="label">Shortage alerts</div><div class="value">${shortItems}</div><div class="sub">${d.alertCount} active alerts · ${n(d.served.peopleServed)} aid servings</div></div>
      </div>

      <div class="grid map-layout" style="margin-top:16px">
        <div class="card">
          <div class="card-head"><div><h2>Situation map</h2><p>Camps coloured by their most urgent open request. Select a camp for details.</p></div></div>
          ${situationMap({ camps: d.mapCamps, warehouses: d.mapWarehouses, routes: d.routes })}
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h2>Alerts</h2><p>Live from stock, requests and shipments</p></div><a href="#/allocation" class="btn btn-sm">Plan allocation</a></div>
            ${d.alerts.length ? d.alerts.map((a) => html`
              <div class="alert-item ${a.severity}"><span class="icon">${icon(a.severity === 'info' ? 'info' : 'alert')}</span>
                <div><strong>${a.title}</strong><p>${a.detail}</p></div></div>`) : html`<div class="callout ok">All clear: no active alerts.</div>`}
            ${d.alertCount > d.alerts.length ? html`<p class="muted" style="margin:10px 0 0;font-size:.82rem">+ ${d.alertCount - d.alerts.length} more alerts, including low-stock warnings. <a href="#/inventory">See inventory</a></p>` : ''}
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Supply versus open demand</h2><p>How much of each item’s outstanding demand current stock can cover</p></div></div>
            ${d.supplyDemand.filter((s) => s.openDemand > 0).length ? d.supplyDemand.filter((s) => s.openDemand > 0).slice(0, 9).map((s) => html`
              <div class="supply-row">
                <div class="name">${s.itemName}<small>${s.category}</small></div>
                <div>${meter(s.coverage, { cls: coverageClass(s.coverage), label: pct(s.coverage) })}</div>
                <div class="figs">${n(s.available)} / ${n(s.openDemand)} ${s.unit}</div>
              </div>`) : empty('No open demand', 'Every request is fully allocated.')}
          </div>
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:16px">
        <div class="card">
          <div class="card-head"><div><h2>Open requests by urgency</h2></div></div>
          ${donut({ slices: urgencySlices, center: 'open' })}
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Recent activity</h2><p>From the immutable audit trail</p></div></div>
          ${d.activity.length ? html`<ul class="timeline">${d.activity.slice(0, 7).map((a) => html`
            <li><b>${a.actor || 'System'}</b> ${ACTION_TEXT[a.action] || a.action.toLowerCase().replaceAll('_', ' ')}<small>${timeAgo(a.createdAt)}</small></li>`)}</ul>` : empty('Nothing yet')}
        </div>
      </div>`;
  },
  after(ctx) {
    bindMap(ctx.el, (id) => ctx.go(`#/camps/${id}`));
  },
};
