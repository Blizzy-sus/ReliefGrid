import { html, n, pct, timeAgo, dateTime, meter, urgencyBadge, statusBadge, empty, formModal, toast } from '../ui.js';

const state = { q: '', status: '' };

export default {
  title: 'Relief camps',
  async render(ctx) {
    if (ctx.route.id) return detail(ctx);
    const camps = await ctx.api.get('/camps');
    const canCreate = ctx.can('admin');
    const draw = () => {
      const q = state.q.toLowerCase();
      const list = camps.filter((c) => c.status !== 'CLOSED' || state.status === 'CLOSED')
        .filter((c) => (!q || c.name.toLowerCase().includes(q) || c.district.toLowerCase().includes(q)) && (!state.status || c.status === state.status))
        .sort((a, b) => b.maxOpenUrgency - a.maxOpenUrgency || b.openRequests - a.openRequests || a.name.localeCompare(b.name));
      ctx.el.querySelector('#camp-grid').innerHTML = String(list.length ? html`${list.map((c) => html`
        <article class="card camp-card" data-action="open" data-id="${c.id}" tabindex="0" role="link" aria-label="${c.name}">
          <div class="row between"><h3>${c.name}</h3>${statusBadge(c.status)}</div>
          <div class="muted" style="font-size:.84rem">${c.district} · ${c.disasterName}</div>
          <div>${meter(c.population / c.capacity, { cls: c.population / c.capacity > 0.95 ? 'high' : '', label: `${n(c.population)} / ${n(c.capacity)}` })}
            <div class="muted" style="font-size:.76rem;margin-top:3px">Occupancy</div></div>
          <div class="stat-line"><span><b>${pct(c.vulnerableCount / Math.max(1, c.population))}</b> at-risk</span><span><b>${c.openRequests}</b> open requests</span><span><b>${c.activeShipments}</b> inbound</span></div>
          <div class="row">${c.maxOpenUrgency ? html`Most urgent: ${urgencyBadge(c.maxOpenUrgency)}` : html`<span class="badge ok">No open requests</span>`}</div>
        </article>`)}` : empty('No camps match', 'Try clearing the filters.'));
    };
    drawGrid = draw;
    ctx.on('open', (el) => ctx.go(`#/camps/${el.dataset.id}`));
    ctx.onInput('q', (el) => { state.q = el.value; draw(); });
    ctx.onChange('status', (el) => { state.status = el.value; draw(); });
    ctx.on('add-camp', async () => {
      const disasters = (await ctx.api.get('/disasters')).filter((d) => d.status !== 'CLOSED');
      formModal({
        title: 'Add relief camp', submitLabel: 'Create camp', wide: true,
        fields: [
          { name: 'name', label: 'Camp name', required: true, full: true },
          { name: 'disasterId', label: 'Incident', type: 'select', options: disasters.map((d) => ({ value: d.id, label: d.name })) },
          { name: 'district', label: 'District', required: true },
          { name: 'latitude', label: 'Latitude', type: 'number', step: 'any', required: true, min: -90, max: 90 },
          { name: 'longitude', label: 'Longitude', type: 'number', step: 'any', required: true, min: -180, max: 180 },
          { name: 'capacity', label: 'Capacity', type: 'number', required: true, min: 1 },
          { name: 'population', label: 'Current population', type: 'number', value: 0, min: 0 },
          { name: 'vulnerableCount', label: 'Of whom at-risk', type: 'number', value: 0, min: 0, hint: 'Children under 5, elderly, pregnant women, people with disabilities' },
        ],
        onSubmit: async (v) => { await ctx.api.post('/camps', v); toast('Camp created', 'success'); ctx.rerender(); },
      });
    });
    return html`
      <div class="page-head">
        <div><h2>Relief camps</h2><p>Population, vulnerability and outstanding needs at every camp.</p></div>
        ${canCreate ? html`<button class="btn btn-primary" data-action="add-camp">+ Add camp</button>` : ''}
      </div>
      <div class="toolbar">
        <input type="search" placeholder="Search camps or districts" data-input="q" value="${state.q}" aria-label="Search camps">
        <select data-change="status" aria-label="Filter by status"><option value="">Open and full</option><option value="OPEN" ${state.status === 'OPEN' ? 'selected' : ''}>Open</option><option value="FULL" ${state.status === 'FULL' ? 'selected' : ''}>Full</option><option value="CLOSED" ${state.status === 'CLOSED' ? 'selected' : ''}>Closed</option></select>
      </div>
      <div class="grid auto" id="camp-grid"></div>`;
  },
  after(ctx) { if (!ctx.route.id) drawGrid?.(); },
};

let drawGrid = null;

async function detail(ctx) {
  const d = await ctx.api.get(`/camps/${ctx.route.id}`);
  const c = d.camp;
  const dist = await ctx.api.get(`/distributions?campId=${c.id}`);
  const mine = ctx.user.role === 'camp_coordinator' && ctx.user.campId === c.id;
  ctx.on('census', () => formModal({
    title: 'Update camp census', subtitle: 'Population drives each request’s planning cap and its priority score.',
    fields: [
      { name: 'population', label: 'Current population', type: 'number', value: c.population, min: 0, required: true },
      { name: 'vulnerableCount', label: 'Of whom at-risk', type: 'number', value: c.vulnerableCount, min: 0, required: true, hint: 'Children under 5, elderly, pregnant women, people with disabilities' },
    ],
    onSubmit: async (v) => { await ctx.api.patch(`/camps/${c.id}`, v); toast('Census updated', 'success'); ctx.rerender(); },
  }));
  ctx.on('set-status', (el) => formModal({
    title: 'Camp status', fields: [{ name: 'status', label: 'Status', type: 'select', value: c.status, options: ['OPEN', 'FULL', 'CLOSED'].map((s) => ({ value: s, label: s })) }],
    onSubmit: async (v) => { await ctx.api.patch(`/camps/${c.id}`, v); ctx.rerender(); },
  }));
  ctx.on('open-request', (el) => ctx.go(`#/requests/${el.dataset.id}`));
  ctx.on('open-shipment', (el) => ctx.go(`#/shipments/${el.dataset.id}`));
  return html`
    <div class="page-head">
      <div><a href="#/camps">← All camps</a><h2 style="margin-top:6px">${c.name}</h2><p>${c.district} · ${c.disasterName} · ${statusBadge(c.status)}</p></div>
      <div class="row">${mine || ctx.can('admin') ? html`<button class="btn" data-action="census">Update census</button>` : ''}${ctx.can('admin') ? html`<button class="btn" data-action="set-status">Change status</button>` : ''}</div>
    </div>
    <div class="grid cols-4">
      <div class="card kpi"><div class="label">Population</div><div class="value">${n(c.population)}</div><div class="sub">Capacity ${n(c.capacity)}</div></div>
      <div class="card kpi high"><div class="label">At-risk residents</div><div class="value">${n(c.vulnerableCount)}</div><div class="sub">${pct(c.vulnerableCount / Math.max(1, c.population))} of population</div></div>
      <div class="card kpi ${c.openRequests ? 'crit' : 'ok'}"><div class="label">Open requests</div><div class="value">${c.openRequests}</div><div class="sub">${c.maxOpenUrgency ? html`Most urgent: ${urgencyBadge(c.maxOpenUrgency)}` : 'None outstanding'}</div></div>
      <div class="card kpi low"><div class="label">Aid servings</div><div class="value">${n(c.peopleServedTotal)}</div><div class="sub">people × distribution events · ${c.activeShipments} shipments inbound</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card flush"><div class="card-head"><div><h2>Requests</h2></div></div>
        <div class="table-wrap">${d.requests.length ? html`<table><thead><tr><th>#</th><th>Urgency</th><th>Status</th><th>Progress</th><th>Raised</th></tr></thead><tbody>
          ${d.requests.map((r) => html`<tr class="clickable" data-action="open-request" data-id="${r.id}" tabindex="0"><td class="mono">#${r.id}</td><td>${urgencyBadge(r.urgency, r.urgencyLabel)}</td><td>${statusBadge(r.status)}</td>
            <td>${meter(r.linesDelivered / r.linesTotal, { label: `${r.linesDelivered}/${r.linesTotal}`, cls: 'ok' })}</td><td class="muted nowrap">${timeAgo(r.createdAt)}</td></tr>`)}</tbody></table>` : empty('No requests yet')}</div></div>
      <div class="card flush"><div class="card-head"><div><h2>Stock held at the camp</h2></div></div>
        <div class="table-wrap">${d.stock.length ? html`<table><thead><tr><th>Item</th><th class="right">On hand</th></tr></thead><tbody>
          ${d.stock.map((s) => html`<tr><td>${s.itemName}</td><td class="right num">${n(s.quantity)} ${s.unit}</td></tr>`)}</tbody></table>` : empty('Nothing received yet')}</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card flush"><div class="card-head"><div><h2>Shipments</h2></div></div>
        <div class="table-wrap">${d.shipments.length ? html`<table><thead><tr><th>Code</th><th>From</th><th>Status</th><th>ETA</th></tr></thead><tbody>
          ${d.shipments.map((s) => html`<tr class="clickable" data-action="open-shipment" data-id="${s.id}" tabindex="0"><td class="mono">${s.code}</td><td>${s.warehouseName}</td><td>${statusBadge(s.status)}</td><td class="muted nowrap">${s.eta ? dateTime(s.eta) : '–'}</td></tr>`)}</tbody></table>` : empty('No shipments yet')}</div></div>
      <div class="card flush"><div class="card-head"><div><h2>Distributions</h2><p>Aid handed out to residents</p></div></div>
        <div class="table-wrap">${dist.length ? html`<table><thead><tr><th>When</th><th>Item</th><th class="right">Qty</th><th class="right">People</th></tr></thead><tbody>
          ${dist.slice(0, 12).map((x) => html`<tr><td class="muted nowrap">${timeAgo(x.createdAt)}</td><td>${x.itemName}</td><td class="right num">${n(x.quantity)} ${x.unit}</td><td class="right num">${n(x.peopleServed)}</td></tr>`)}</tbody></table>` : empty('No distributions recorded')}</div></div>
    </div>`;
}
