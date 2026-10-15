import { html, raw, esc, n, dateTime, timeAgo, statusBadge, statusLabel, empty, formModal, modal, confirmModal, toast } from '../ui.js';

const state = { status: 'active', mine: false, q: '', scope: null };
const TABS = [['active', 'Active'], ['PLANNED', 'Planned'], ['IN_TRANSIT', 'In transit'], ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancelled'], ['all', 'All']];
let draw = null;

export default {
  title: 'Shipments & deliveries',
  async render(ctx) {
    if (ctx.route.id) return detail(ctx);
    const all = await ctx.api.get('/shipments');
    const isVol = ctx.user.role === 'volunteer';
    const scopeLabel = { warehouse_manager: 'My warehouse', camp_coordinator: 'My camp' }[ctx.user.role];
    if (state.scope === null) state.scope = Boolean(scopeLabel); // warehouse managers and coordinators start with their own shipments
    const inScope = (s) => (ctx.user.role === 'warehouse_manager' ? s.warehouseId === ctx.user.warehouseId : ctx.user.role === 'camp_coordinator' ? s.campId === ctx.user.campId : true);
    const matches = (s) => {
      if (state.status === 'active' && !['PLANNED', 'IN_TRANSIT'].includes(s.status)) return false;
      if (!['active', 'all'].includes(state.status) && s.status !== state.status) return false;
      if (state.mine && s.volunteerId !== ctx.user.id) return false;
      if (state.scope && !inScope(s)) return false;
      const q = state.q.toLowerCase();
      return !q || [s.code, s.campName, s.warehouseName, s.volunteerName || ''].some((x) => x.toLowerCase().includes(q));
    };
    const count = (t) => all.filter((s) => (!state.scope || inScope(s)) && (t === 'active' ? ['PLANNED', 'IN_TRANSIT'].includes(s.status) : t === 'all' ? true : s.status === t)).length;
    draw = () => {
      const list = all.filter(matches);
      ctx.el.querySelector('#ship-grid').innerHTML = String(list.length ? html`${list.slice(0, 120).map((s) => card(s, ctx))}` : empty('No shipments here', 'Shipments are created when an allocation run is committed.'));
      ctx.el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === state.status)));
    };
    wireActions(ctx);
    ctx.on('tab', (el) => { state.status = el.dataset.tab; draw(); });
    ctx.on('open', (el) => ctx.go(`#/shipments/${el.dataset.id}`));
    ctx.onInput('q', (el) => { state.q = el.value; draw(); });
    ctx.on('mine', (el) => { state.mine = !state.mine; el.setAttribute('aria-pressed', String(state.mine)); draw(); });
    ctx.on('scope', () => { state.scope = !state.scope; ctx.rerender(true); });
    return html`
      <div class="page-head"><div><h2>Shipments & deliveries</h2><p>From warehouse reservation to confirmed receipt at the camp. Every status change is recorded automatically.</p></div></div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Shipment status">${TABS.map(([v, l]) => html`<button class="chip-btn" data-action="tab" data-tab="${v}" aria-pressed="${state.status === v}">${l}<span class="count">${count(v)}</span></button>`)}</div>
        <span class="spacer"></span>
        ${isVol ? html`<button class="chip-btn" data-action="mine" aria-pressed="${state.mine}">My shipments</button>` : ''}
        ${scopeLabel ? html`<button class="chip-btn" data-action="scope" aria-pressed="${state.scope}">${scopeLabel} only</button>` : ''}
        <input type="search" placeholder="Search code, camp, depot" data-input="q" value="${state.q}" aria-label="Search shipments">
      </div>
      <div class="grid auto" id="ship-grid"></div>`;
  },
  after(ctx) { if (!ctx.route.id) draw?.(); },
};

const STEP = { PLANNED: 1, IN_TRANSIT: 2, DELIVERED: 3, CANCELLED: 0 };
function card(s, ctx) {
  const step = STEP[s.status];
  return html`<article class="card ship-card">
    <div class="row between"><span class="code">${s.code}</span>${statusBadge(s.status)}</div>
    <div class="route"><span>${s.warehouseName.replace(/ (Central )?(Relief )?(Depot|Warehouse|Store|Hub)$/i, '')}</span><span class="arrow">→</span><span>${s.campName}</span></div>
    <div class="progress-steps" aria-hidden="true"><i class="${step >= 1 ? (step > 1 ? 'done' : 'on') : ''}"></i><i class="${step >= 2 ? (step > 2 ? 'done' : 'on') : ''}"></i><i class="${step >= 3 ? 'done' : ''}"></i></div>
    <div class="stat-line"><span><b>${s.lineCount}</b> items</span><span><b>${n(s.unitCount)}</b> units</span><span><b>${s.distanceKm}</b> km</span>
      ${s.status === 'IN_TRANSIT' && s.eta ? html`<span>ETA <b>${dateTime(s.eta)}</b></span>` : ''}</div>
    <div class="muted" style="font-size:.82rem">${s.volunteerName ? html`Driver/volunteer: <b style="color:var(--text)">${s.volunteerName}</b>` : 'No volunteer assigned'}${s.vehicle ? html` · <span class="mono">${s.vehicle}</span>` : ''}</div>
    <div class="row" style="margin-top:auto">${actionButtons(s, ctx)}<button class="btn btn-sm btn-ghost" data-action="open" data-id="${s.id}">Details</button></div>
  </article>`;
}

function actionButtons(s, ctx) {
  const u = ctx.user;
  const ownWarehouse = u.role === 'admin' || (u.role === 'warehouse_manager' && u.warehouseId === s.warehouseId);
  const out = [];
  if (s.status === 'PLANNED' && ownWarehouse) out.push(html`<button class="btn btn-sm btn-primary" data-action="dispatch" data-id="${s.id}">Dispatch</button><button class="btn btn-sm" data-action="assign" data-id="${s.id}">${s.volunteerId ? 'Reassign' : 'Assign'}</button><button class="btn btn-sm btn-danger" data-action="cancel" data-id="${s.id}">Cancel</button>`);
  if (s.status === 'IN_TRANSIT' && ownWarehouse) out.push(html`<button class="btn btn-sm" data-action="assign" data-id="${s.id}">${s.volunteerId ? 'Reassign' : 'Assign'}</button>`);
  if (u.role === 'volunteer' && !s.volunteerId && ['PLANNED', 'IN_TRANSIT'].includes(s.status)) out.push(html`<button class="btn btn-sm" data-action="claim" data-id="${s.id}">Claim</button>`);
  const mayReceive = u.role === 'admin' || (u.role === 'camp_coordinator' && u.campId === s.campId) || (u.role === 'volunteer' && s.volunteerId === u.id);
  if (s.status === 'IN_TRANSIT' && mayReceive) out.push(html`<button class="btn btn-sm btn-primary" data-action="deliver" data-id="${s.id}">Confirm delivery</button>`);
  return out;
}

function wireActions(ctx) {
  const done = (msg) => { toast(msg, 'success'); ctx.rerender(true); };
  ctx.on('dispatch', (el) => formModal({
    title: 'Dispatch shipment', subtitle: 'Stock leaves the warehouse and the reservation becomes a real stock movement.', submitLabel: 'Dispatch',
    fields: [{ name: 'vehicle', label: 'Vehicle / registration', placeholder: 'TN-45-AB-1234' }, { name: 'note', label: 'Note', full: true }],
    onSubmit: async (v) => { await ctx.api.post(`/shipments/${el.dataset.id}/dispatch`, { vehicle: v.vehicle || undefined, note: v.note || undefined }); done('Shipment dispatched'); },
  }));
  ctx.on('assign', async (el) => {
    const vols = await ctx.api.get('/volunteers');
    formModal({
      title: 'Assign volunteer', submitLabel: 'Assign',
      fields: [{ name: 'volunteerId', label: 'Volunteer', type: 'select', options: vols.map((v) => ({ value: v.id, label: `${v.fullName}${v.phone ? ` · ${v.phone}` : ''}` })) }],
      onSubmit: async (v) => { await ctx.api.post(`/shipments/${el.dataset.id}/assign`, { volunteerId: Number(v.volunteerId) }); done('Volunteer assigned'); },
    });
  });
  ctx.on('claim', async (el) => { await ctx.api.post(`/shipments/${el.dataset.id}/claim`); done('Shipment claimed'); });
  ctx.on('cancel', (el) => formModal({
    title: 'Cancel planned shipment', subtitle: 'Its reservation is released and the requested quantities return to the allocation queue.', submitLabel: 'Cancel shipment', danger: true,
    fields: [{ name: 'note', label: 'Reason', required: true, full: true, placeholder: 'e.g. Road washed out' }],
    onSubmit: async (v) => { await ctx.api.post(`/shipments/${el.dataset.id}/cancel`, { note: v.note }); done('Shipment cancelled, stock released'); },
  }));
  ctx.on('deliver', async (el) => {
    const s = await ctx.api.get(`/shipments/${el.dataset.id}`);
    const m = modal({
      title: `Confirm delivery · ${s.code}`, subtitle: `Count what actually arrived at ${s.campName}. Anything short is released back to the request for re-allocation.`, wide: true,
      body: raw(`<form id="deliver-form" class="stack" novalidate><div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Shipped</th><th class="right">Received</th></tr></thead><tbody>
        ${s.items.map((i) => `<tr><td>${esc(i.itemName)} <span class="muted">· request #${i.requestId}</span></td><td class="right num">${n(i.quantity)} ${esc(i.unit)}</td><td class="right"><input type="number" name="r${i.id}" min="0" max="${i.quantity}" step="1" value="${i.quantity}" required style="width:110px;text-align:right" aria-label="Received ${esc(i.itemName)}"></td></tr>`).join('')}</tbody></table></div>
        <label class="field">Note (optional)<input type="text" name="note" maxlength="200" placeholder="e.g. Two pallets soaked in transit"></label><div class="form-error" hidden></div></form>`),
      actions: [{ label: 'Cancel', onClick: ({ close }) => close() }, { label: 'Confirm receipt', cls: 'btn-primary', form: 'deliver-form' }],
    });
    const form = m.el.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const err = form.querySelector('.form-error'); err.hidden = true;
      const btn = m.el.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const res = await ctx.api.post(`/shipments/${s.id}/deliver`, { received: s.items.map((i) => ({ shipmentItemId: i.id, quantity: Number(form[`r${i.id}`].value) })), note: form.note.value || undefined });
        m.close(); done(res.shortfall ? `Delivered. ${n(res.shortfall)} ${res.shortfall === 1 ? 'unit' : 'units'} short, returned to the allocation queue.` : 'Delivered in full');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
  });
}

async function detail(ctx) {
  const s = await ctx.api.get(`/shipments/${ctx.route.id}`);
  wireActions(ctx);
  ctx.on('open-request', (el) => ctx.go(`#/requests/${el.dataset.id}`));
  return html`
    <div class="page-head"><div><a href="#/shipments">← All shipments</a>
      <h2 style="margin-top:6px"><span class="mono">${s.code}</span> · ${s.warehouseName} → ${s.campName}</h2>
      <p>${statusBadge(s.status)} &nbsp;${s.distanceKm} km · created ${timeAgo(s.createdAt)}${s.runId ? html` · <a href="#/allocation/${s.runId}">allocation run #${s.runId}</a>` : ''}</p></div>
      <div class="row">${actionButtons(s, ctx)}</div></div>
    <div class="grid main-side">
      <div class="card flush"><div class="card-head"><div><h2>Contents</h2></div></div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Shipped</th><th class="right">Received</th><th>Request</th></tr></thead><tbody>
          ${s.items.map((i) => html`<tr><td>${i.itemName}</td><td class="right num">${n(i.quantity)} ${i.unit}</td>
            <td class="right num">${i.quantityReceived == null ? '–' : html`${n(i.quantityReceived)} ${i.quantityReceived < i.quantity ? html`<span class="badge crit plain">−${n(i.quantity - i.quantityReceived)}</span>` : ''}`}</td>
            <td><a href="#/requests/${i.requestId}">#${i.requestId}</a></td></tr>`)}</tbody></table></div></div>
      <div class="stack">
        <div class="card"><div class="card-head"><div><h2>Details</h2></div></div>
          <dl class="kv"><dt>Volunteer</dt><dd>${s.volunteerName || 'Unassigned'}</dd><dt>Vehicle</dt><dd>${s.vehicle || '–'}</dd>
          <dt>Dispatched</dt><dd>${s.dispatchedAt ? dateTime(s.dispatchedAt) : '–'}</dd><dt>ETA</dt><dd>${s.eta ? dateTime(s.eta) : '–'}</dd><dt>Delivered</dt><dd>${s.deliveredAt ? dateTime(s.deliveredAt) : '–'}</dd></dl></div>
        <div class="card"><div class="card-head"><div><h2>Timeline</h2><p>Written by a database trigger on every status change</p></div></div>
          <ul class="timeline">${s.events.map((e) => html`<li><b>${statusLabel(e.status)}</b>${e.note ? html` · ${e.note}` : ''}<small>${dateTime(e.createdAt)}${e.actor ? html` · ${e.actor}` : ''}</small></li>`)}</ul></div>
      </div>
    </div>`;
}
