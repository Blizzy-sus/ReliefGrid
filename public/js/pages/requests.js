import { html, raw, esc, n, pct, timeAgo, dateTime, meter, urgencyBadge, statusBadge, empty, formModal, modal, confirmModal, toast } from '../ui.js';

const state = { status: 'open', urgency: '', q: '' };
const FILTERS = [['open', 'Open'], ['all', 'All'], ['PENDING', 'Pending'], ['PARTIALLY_ALLOCATED', 'Partly allocated'], ['ALLOCATED', 'Allocated'], ['FULFILLED', 'Fulfilled'], ['CANCELLED', 'Cancelled']];
let drawTable = null;

export default {
  title: 'Supply requests',
  async render(ctx) {
    if (ctx.route.id) return detail(ctx);
    const all = await ctx.api.get('/requests');
    const canCreate = ctx.can('admin', 'camp_coordinator');
    const matches = (r) => {
      const q = state.q.toLowerCase();
      if (state.status === 'open' && !['PENDING', 'PARTIALLY_ALLOCATED'].includes(r.status)) return false;
      if (!['open', 'all'].includes(state.status) && r.status !== state.status) return false;
      if (state.urgency && String(r.urgency) !== state.urgency) return false;
      return !q || r.campName.toLowerCase().includes(q) || String(r.id) === q.replace('#', '');
    };
    drawTable = () => {
      const list = all.filter(matches);
      ctx.el.querySelector('#req-table').innerHTML = String(list.length ? html`
        <table><thead><tr><th>#</th><th>Camp</th><th>Urgency</th><th>Status</th><th>Allocated</th><th>Delivered</th><th>Raised</th></tr></thead><tbody>
        ${list.map((r) => html`<tr class="clickable" data-action="open" data-id="${r.id}" tabindex="0">
          <td class="mono">#${r.id}</td><td><b>${r.campName}</b><div class="muted" style="font-size:.78rem">${n(r.population)} people${r.notes ? html` · ${r.notes.slice(0, 54)}${r.notes.length > 54 ? '…' : ''}` : ''}</div></td>
          <td>${urgencyBadge(r.urgency, r.urgencyLabel)}</td><td>${statusBadge(r.status)}</td>
          <td>${meter(r.linesAllocated / r.linesTotal, { label: `${r.linesAllocated}/${r.linesTotal}`, cls: 'low' })}</td>
          <td>${meter(r.linesDelivered / r.linesTotal, { label: `${r.linesDelivered}/${r.linesTotal}`, cls: 'ok' })}</td>
          <td class="muted nowrap" title="${dateTime(r.createdAt)}">${timeAgo(r.createdAt)}</td></tr>`)}</tbody></table>` : empty('No requests match', 'Change the filters or raise a new request.'));
      ctx.el.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === state.status)));
    };
    ctx.on('open', (el) => ctx.go(`#/requests/${el.dataset.id}`));
    ctx.on('filter', (el) => { state.status = el.dataset.filter; drawTable(); });
    ctx.onInput('q', (el) => { state.q = el.value; drawTable(); });
    ctx.onChange('urgency', (el) => { state.urgency = el.value; drawTable(); });
    ctx.on('new', () => newRequestModal(ctx));
    const count = (f) => (f === 'open' ? all.filter((r) => ['PENDING', 'PARTIALLY_ALLOCATED'].includes(r.status)).length : f === 'all' ? all.length : all.filter((r) => r.status === f).length);
    return html`
      <div class="page-head">
        <div><h2>Supply requests</h2><p>Camps request what they need and say how urgent it is. Quantities above the planning standard are trimmed automatically; the allocation engine does the rest.</p></div>
        ${canCreate ? html`<button class="btn btn-primary" data-action="new">+ New request</button>` : ''}
      </div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Status filter">${FILTERS.map(([v, l]) => html`<button class="chip-btn" data-action="filter" data-filter="${v}" aria-pressed="${state.status === v}">${l}<span class="count">${count(v)}</span></button>`)}</div>
        <span class="spacer"></span>
        <select data-change="urgency" aria-label="Urgency"><option value="">Any urgency</option>${[4, 3, 2, 1].map((u) => html`<option value="${u}" ${state.urgency === String(u) ? 'selected' : ''}>${['', 'Low', 'Moderate', 'High', 'Critical'][u]}</option>`)}</select>
        <input type="search" placeholder="Search camp or #id" data-input="q" value="${state.q}" aria-label="Search requests">
      </div>
      <div class="card flush"><div class="table-wrap" id="req-table"></div></div>`;
  },
  after(ctx) { if (!ctx.route.id) drawTable?.(); },
};

// ---------------------------------------------------------------------- new request
async function newRequestModal(ctx) {
  const [items, camps, settings] = await Promise.all([ctx.api.get('/items'), ctx.api.get('/camps'), ctx.api.get('/allocation/settings')]);
  const horizon = settings.settings.find((s) => s.key === 'planning_horizon_days').value;
  const myCamps = ctx.user.role === 'camp_coordinator' ? camps.filter((c) => c.id === ctx.user.campId) : camps.filter((c) => c.status !== 'CLOSED');
  const activeItems = items.filter((i) => i.active);
  const itemOptions = (selected) => activeItems.map((i) => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(i.category)} · ${esc(i.name)} (${esc(i.unit)})</option>`).join('');
  const m = modal({
    title: 'New supply request', subtitle: 'List what the camp needs. Urgency is the single biggest factor in how scarce stock is shared.', wide: true,
    body: raw(`<form id="req-form" class="stack" novalidate>
      <div class="form-grid">
        <label class="field">Camp<select name="campId" required>${myCamps.map((c) => `<option value="${c.id}">${esc(c.name)} · ${c.population} people</option>`).join('')}</select></label>
        <label class="field">Needed by (optional)<input type="datetime-local" name="neededBy"></label>
        <div class="field full">Urgency
          <div class="chips" id="urg">${[[4, 'Critical', 'Lives at immediate risk'], [3, 'High', 'Serious shortfall within hours'], [2, 'Moderate', 'Needed within a day'], [1, 'Low', 'Routine top-up']].map(([v, l, h]) => `<label class="chip-btn" style="display:inline-flex;gap:7px;align-items:center" title="${h}"><input type="radio" name="urgency" value="${v}" ${v === 2 ? 'checked' : ''}>${l}</label>`).join('')}</div>
          <span class="hint">Escalating urgency without cause lowers trust in the system. Every request is visible to administrators.</span></div>
        <label class="field full">Notes<textarea name="notes" placeholder="What happened? Anything the control room should know?" maxlength="500"></textarea></label>
      </div>
      <div><div class="row between" style="margin-bottom:8px"><h3>Items</h3><button type="button" class="btn btn-sm" id="add-line">+ Add item</button></div>
        <div id="lines" class="stack" style="gap:10px"></div></div>
      <div class="form-error" hidden></div></form>`),
    actions: [{ label: 'Cancel', onClick: ({ close }) => close() }, { label: 'Submit request', cls: 'btn-primary', form: 'req-form' }],
  });
  const form = m.el.querySelector('#req-form');
  const lines = form.querySelector('#lines');
  const camp = () => myCamps.find((c) => c.id === Number(form.campId.value));
  const addLine = (itemId, qty = '') => {
    const row = document.createElement('div');
    row.className = 'form-grid';
    row.style.gridTemplateColumns = 'minmax(0,2fr) minmax(0,1fr) auto';
    row.innerHTML = `<label class="field"><span class="sr-only">Item</span><select name="item">${itemOptions(itemId)}</select><span class="hint" data-hint></span></label>
      <label class="field"><span class="sr-only">Quantity</span><input type="number" name="qty" min="1" step="1" value="${qty}" placeholder="Quantity" required></label>
      <button type="button" class="btn btn-ghost btn-sm" data-remove aria-label="Remove item" style="align-self:start;margin-top:3px">✕</button>`;
    lines.appendChild(row);
    hint(row);
  };
  const hint = (row) => {
    const item = activeItems.find((i) => i.id === Number(row.querySelector('[name=item]').value));
    const el = row.querySelector('[data-hint]');
    if (!item || !camp()) return;
    if (item.standardPerPersonPerDay == null) { el.textContent = `No per-person standard: approved as requested (${item.unit}).`; return; }
    const cap = Math.max(1, Math.ceil(item.standardPerPersonPerDay * camp().population * horizon));
    el.textContent = `Planning cap: ${n(cap)} ${item.unit} (${item.standardPerPersonPerDay}/person/day × ${n(camp().population)} people × ${horizon} days). Requests above it are trimmed.`;
  };
  const firstFree = () => (activeItems.find((i) => ![...lines.querySelectorAll('[name=item]')].some((s) => Number(s.value) === i.id)) || activeItems[0]).id;
  addLine(activeItems.find((i) => i.name.toLowerCase().includes('water'))?.id ?? activeItems[0].id);
  form.querySelector('#add-line').addEventListener('click', () => addLine(firstFree()));
  lines.addEventListener('click', (e) => { if (e.target.closest('[data-remove]') && lines.children.length > 1) e.target.closest('.form-grid').remove(); });
  lines.addEventListener('change', (e) => { const row = e.target.closest('.form-grid'); if (row) hint(row); });
  form.campId.addEventListener('change', () => lines.querySelectorAll('.form-grid').forEach(hint));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error'); err.hidden = true;
    if (!form.reportValidity()) return;
    const body = {
      campId: Number(form.campId.value), urgency: Number(form.urgency.value), notes: form.notes.value || undefined,
      neededBy: form.neededBy.value ? new Date(form.neededBy.value).toISOString() : undefined,
      items: [...lines.querySelectorAll('.form-grid')].map((r) => ({ itemId: Number(r.querySelector('[name=item]').value), quantity: Number(r.querySelector('[name=qty]').value) })),
    };
    const btn = m.el.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const res = await ctx.api.post('/requests', body);
      m.close(); toast('Request submitted', 'success'); ctx.go(`#/requests/${res.id}`);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------- detail
async function detail(ctx) {
  const r = await ctx.api.get(`/requests/${ctx.route.id}`);
  const open = ['PENDING', 'PARTIALLY_ALLOCATED'].includes(r.status);
  const owner = ctx.user.role === 'admin' || (ctx.user.role === 'camp_coordinator' && ctx.user.campId === r.campId);
  const byItem = new Map();
  for (const d of r.decisions) { if (!byItem.has(d.requestItemId)) byItem.set(d.requestItemId, []); byItem.get(d.requestItemId).push(d); }
  ctx.on('urgency', () => formModal({
    title: 'Change urgency', subtitle: ctx.user.role === 'admin' ? 'Administrators can raise or lower urgency.' : 'Coordinators can raise urgency; only administrators can lower it.',
    fields: [{ name: 'urgency', label: 'Urgency', type: 'select', value: r.urgency, options: [[4, 'Critical'], [3, 'High'], [2, 'Moderate'], [1, 'Low']].map(([v, l]) => ({ value: v, label: l })) }],
    onSubmit: async (v) => { await ctx.api.post(`/requests/${r.id}/urgency`, { urgency: Number(v.urgency) }); toast('Urgency updated', 'success'); ctx.rerender(); },
  }));
  ctx.on('cancel', () => confirmModal({
    title: `Cancel request #${r.id}?`, message: 'The request leaves the allocation queue. Shipments already planned must be cancelled first.', confirmLabel: 'Cancel request', danger: true,
    onConfirm: async () => { await ctx.api.post(`/requests/${r.id}/cancel`); toast('Request cancelled', 'success'); ctx.rerender(); },
  }));
  ctx.on('approve', (el) => {
    const it = r.items.find((x) => x.id === Number(el.dataset.id));
    formModal({
      title: `Approved quantity · ${it.itemName}`, subtitle: `Requested ${n(it.requested)} ${it.unit}; already allocated ${n(it.allocated)}.`,
      fields: [{ name: 'approved', label: `Approved (${it.unit})`, type: 'number', value: it.approved, min: Math.max(1, it.allocated), max: it.requested, required: true }, { name: 'note', label: 'Reason', value: '', hint: 'Shown to the camp' }],
      onSubmit: async (v) => { await ctx.api.post(`/request-items/${it.id}/approval`, { approved: Number(v.approved), note: v.note || undefined }); toast('Approval updated', 'success'); ctx.rerender(); },
    });
  });
  ctx.on('open-shipment', (el) => ctx.go(`#/shipments/${el.dataset.id}`));
  return html`
    <div class="page-head">
      <div><a href="#/requests">← All requests</a>
        <h2 style="margin-top:6px">Request #${r.id} · ${r.campName}</h2>
        <p>${urgencyBadge(r.urgency, r.urgencyLabel)} ${statusBadge(r.status)} &nbsp;Raised ${timeAgo(r.createdAt)} by ${r.requestedBy} · ${n(r.population)} people (${pct(r.vulnerableCount / Math.max(1, r.population))} at-risk)</p></div>
      <div class="row">${owner && !['FULFILLED', 'CANCELLED'].includes(r.status) ? html`<button class="btn" data-action="urgency">Change urgency</button><button class="btn btn-danger" data-action="cancel">Cancel request</button>` : ''}</div>
    </div>
    ${r.notes ? html`<div class="callout" style="margin-bottom:16px"><b>Camp note:</b> ${r.notes}</div>` : ''}
    <div class="card flush"><div class="card-head"><div><h2>Items</h2><p>Requested → approved (after the planning standard) → allocated → delivered</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Requested</th><th class="right">Approved</th><th class="right">Allocated</th><th class="right">Delivered</th><th>Progress</th>${ctx.can('admin') && open ? html`<th></th>` : ''}</tr></thead><tbody>
      ${r.items.map((i) => html`<tr>
        <td><b>${i.itemName}</b>${i.approvalNote ? html`<div class="muted" style="font-size:.78rem;max-width:44ch">${i.approvalNote}</div>` : ''}</td>
        <td class="right num">${n(i.requested)} ${i.unit}</td>
        <td class="right num">${i.approved < i.requested ? html`<span class="badge high plain" title="${i.approvalNote}">${n(i.approved)}</span>` : n(i.approved)}</td>
        <td class="right num">${n(i.allocated)}</td><td class="right num">${n(i.delivered)}</td>
        <td style="min-width:150px"><div class="bar tall"><i class="stack2" style="width:${(i.allocated / i.approved) * 100}%"></i><i class="" style="width:${(i.delivered / i.approved) * 100}%;background:var(--ok)"></i></div>
          <div class="muted" style="font-size:.74rem;margin-top:3px">${pct(i.delivered / i.approved)} delivered · ${pct(i.allocated / i.approved)} allocated</div></td>
        ${ctx.can('admin') && open ? html`<td><button class="btn btn-sm" data-action="approve" data-id="${i.id}">Adjust</button></td>` : ''}</tr>`)}</tbody></table></div></div>
    <div class="grid main-side" style="margin-top:16px">
      <div class="card"><div class="card-head"><div><h2>Why this camp received what it did</h2><p>Every allocation decision made for this request, in plain language</p></div></div>
        ${r.decisions.length ? r.items.filter((i) => byItem.has(i.id)).map((i) => html`<h3 style="margin:14px 0 8px">${i.itemName}</h3>${byItem.get(i.id).map((d) => html`
          <div class="explain" style="margin-bottom:8px"><div class="row between" style="margin-bottom:4px"><b>Run #${d.runId} · ${dateTime(d.createdAt)}</b><span>${d.scarce ? html`<span class="badge high">Scarce</span>` : html`<span class="badge ok">Sufficient stock</span>`}</span></div>
            ${d.explanation}</div>`)}`) : empty('Not yet considered', 'The next allocation run will evaluate this request.')}</div>
      <div class="card"><div class="card-head"><div><h2>Shipments</h2></div></div>
        ${r.shipments.length ? r.shipments.map((s) => html`<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border-soft)"><a href="#/shipments/${s.id}" class="mono">${s.code}</a>${statusBadge(s.status)}</div>`) : empty('No shipments yet')}</div>
    </div>`;
}
