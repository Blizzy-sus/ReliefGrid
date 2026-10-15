import { html, n, pct, dateTime, timeAgo, meter, statusBadge, empty, formModal, modal, toast } from '../ui.js';

const state = { wh: 'all', q: '' };
let draw = null;

export default {
  title: 'Warehouses & inventory',
  async render(ctx) {
    const [warehouses, inventory, items] = await Promise.all([ctx.api.get('/warehouses'), ctx.api.get('/inventory'), ctx.api.get('/items')]);
    if (state.wh !== 'all' && !warehouses.some((w) => String(w.id) === state.wh)) state.wh = 'all';
    const u = ctx.user;
    const canManage = (wid) => u.role === 'admin' || (u.role === 'warehouse_manager' && u.warehouseId === wid);
    if (!state.init) { state.init = true; if (u.role === 'warehouse_manager') state.wh = String(u.warehouseId); }

    draw = () => {
      const q = state.q.toLowerCase();
      const wid = state.wh === 'all' ? null : Number(state.wh);
      let rows;
      if (wid) rows = inventory.filter((r) => r.warehouseId === wid);
      else {
        const m = new Map();
        for (const r of inventory) {
          const a = m.get(r.itemId) || { ...r, onHand: 0, reserved: 0, available: 0, reorderLevel: 0, belowReorder: 0, warehouses: 0 };
          a.onHand += r.onHand; a.reserved += r.reserved; a.available += r.available; a.reorderLevel += r.reorderLevel; a.belowReorder += r.belowReorder; a.warehouses += 1;
          m.set(r.itemId, a);
        }
        rows = [...m.values()];
      }
      rows = rows.filter((r) => !q || r.itemName.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
      const maxOnHand = Math.max(1, ...rows.map((r) => r.onHand));
      const manage = wid && canManage(wid);
      ctx.el.querySelector('#inv-table').innerHTML = String(rows.length ? html`
        <table><thead><tr><th>Item</th><th>Category</th><th class="right">On hand</th><th class="right">Reserved</th><th class="right">Available</th><th>Stock level</th><th class="right">Reorder at</th>${wid ? html`<th></th>` : ''}</tr></thead><tbody>
        ${rows.map((r) => html`<tr>
          <td><b>${r.itemName}</b>${!wid ? html`<div class="muted" style="font-size:.76rem">${r.warehouses} warehouse${r.warehouses === 1 ? '' : 's'}</div>` : ''}</td><td class="muted">${r.category}</td>
          <td class="right num">${n(r.onHand)} <span class="muted">${r.unit}</span></td><td class="right num">${r.reserved ? n(r.reserved) : '–'}</td>
          <td class="right num"><b style="${r.belowReorder && wid ? 'color:var(--crit-text)' : ''}">${n(r.available)}</b></td>
          <td style="min-width:150px"><div class="bar tall ${wid && r.belowReorder ? 'crit' : ''}"><i class="stack2" style="width:${(r.onHand / maxOnHand) * 100}%"></i><i style="width:${(r.available / maxOnHand) * 100}%"></i></div></td>
          <td class="right num">${r.reorderLevel ? n(r.reorderLevel) : '–'}${wid && r.belowReorder ? html` <span class="badge crit plain">Low</span>` : wid && r.onHand === 0 ? html` <span class="badge plain">Out</span>` : ''}</td>
          ${wid ? html`<td class="nowrap right"><button class="btn btn-sm" data-action="ledger" data-w="${r.warehouseId}" data-i="${r.itemId}">Ledger</button>${manage ? html` <button class="btn btn-sm" data-action="adjust" data-w="${r.warehouseId}" data-i="${r.itemId}">Adjust</button> <button class="btn btn-sm" data-action="reorder" data-w="${r.warehouseId}" data-i="${r.itemId}" data-level="${r.reorderLevel}">Reorder level</button>` : ''}</td>` : ''}</tr>`)}</tbody></table>` : empty('No stock records', 'Receive stock to get started.'));
      ctx.el.querySelectorAll('[data-wh]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wh === state.wh)));
      const actions = ctx.el.querySelector('#wh-actions');
      if (actions) actions.hidden = !(wid && canManage(wid));
    };

    ctx.on('wh', (el) => { state.wh = el.dataset.wh; draw(); });
    ctx.onInput('q', (el) => { state.q = el.value; draw(); });
    const done = (m) => { toast(m, 'success'); ctx.rerender(true); };
    ctx.on('receive', () => {
      const wid = Number(state.wh);
      formModal({
        title: 'Receive stock', subtitle: warehouses.find((w) => w.id === wid)?.name, submitLabel: 'Record receipt',
        fields: [
          { name: 'itemId', label: 'Item', type: 'select', options: items.filter((i) => i.active).map((i) => ({ value: i.id, label: `${i.category} · ${i.name} (${i.unit})` })) },
          { name: 'quantity', label: 'Quantity received', type: 'number', min: 1, required: true },
          { name: 'note', label: 'Source / note', full: true, placeholder: 'e.g. State tanker delivery' },
        ],
        onSubmit: async (v) => { await ctx.api.post('/inventory/receive', { warehouseId: wid, itemId: Number(v.itemId), quantity: Number(v.quantity), note: v.note || undefined }); done('Stock received'); },
      });
    });
    ctx.on('adjust', (el) => formModal({
      title: 'Adjust stock', subtitle: 'Use for damage, loss or recounts. Cannot go below the quantity reserved for planned shipments.', submitLabel: 'Apply adjustment',
      fields: [
        { name: 'delta', label: 'Change (+ or −)', type: 'number', required: true, hint: 'e.g. -40 for 40 damaged units' },
        { name: 'reason', label: 'Reason (required)', required: true, full: true },
      ],
      onSubmit: async (v) => { await ctx.api.post('/inventory/adjust', { warehouseId: Number(el.dataset.w), itemId: Number(el.dataset.i), delta: Number(v.delta), reason: v.reason }); done('Stock adjusted'); },
    }));
    ctx.on('reorder', (el) => formModal({
      title: 'Reorder level', subtitle: 'An alert is raised when available stock reaches this level.',
      fields: [{ name: 'level', label: 'Reorder level', type: 'number', min: 0, value: el.dataset.level, required: true }],
      onSubmit: async (v) => { await ctx.api.post('/inventory/reorder-level', { warehouseId: Number(el.dataset.w), itemId: Number(el.dataset.i), reorderLevel: Number(v.level) }); done('Reorder level saved'); },
    }));
    ctx.on('ledger', async (el) => {
      const moves = await ctx.api.get(`/inventory/movements?warehouseId=${el.dataset.w}&itemId=${el.dataset.i}&limit=60`);
      modal({
        title: `Stock ledger${moves[0] ? ` · ${moves[0].itemName}` : ''}`, subtitle: `${moves[0]?.warehouseName || ''}. Append-only: replaying it reproduces today’s balance.`, wide: true,
        body: moves.length ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>Type</th><th class="right">On hand</th><th class="right">Reserved</th><th>Note</th><th>By</th></tr></thead><tbody>
          ${moves.map((m) => html`<tr><td class="nowrap muted">${dateTime(m.createdAt)}</td><td><span class="badge accent plain">${m.type}</span></td>
            <td class="right num" style="color:${m.deltaOnHand > 0 ? 'var(--ok-text)' : m.deltaOnHand < 0 ? 'var(--crit-text)' : 'var(--muted)'}">${m.deltaOnHand > 0 ? '+' : ''}${m.deltaOnHand || '–'}</td>
            <td class="right num">${m.deltaReserved > 0 ? '+' : ''}${m.deltaReserved || '–'}</td><td class="muted">${m.note || ''}</td><td class="muted">${m.actor || ''}</td></tr>`)}</tbody></table></div>` : empty('No movements'),
      });
    });
    ctx.on('wh-status', async (el) => {
      const w = warehouses.find((x) => String(x.id) === state.wh);
      formModal({
        title: `Warehouse status · ${w.name}`, subtitle: 'Offline warehouses are ignored by allocation.',
        fields: [{ name: 'status', label: 'Status', type: 'select', value: w.status, options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'OFFLINE', label: 'Offline' }] }],
        onSubmit: async (v) => { await ctx.api.patch(`/warehouses/${w.id}`, { status: v.status }); done('Warehouse updated'); },
      });
    });
    ctx.on('add-wh', () => formModal({
      title: 'Add warehouse', submitLabel: 'Create', wide: true,
      fields: [
        { name: 'name', label: 'Name', required: true, full: true }, { name: 'district', label: 'District', required: true }, { name: 'contactPhone', label: 'Phone' },
        { name: 'latitude', label: 'Latitude', type: 'number', step: 'any', required: true, min: -90, max: 90 }, { name: 'longitude', label: 'Longitude', type: 'number', step: 'any', required: true, min: -180, max: 180 },
      ],
      onSubmit: async (v) => { await ctx.api.post('/warehouses', v); done('Warehouse created'); },
    }));

    return html`
      <div class="page-head"><div><h2>Warehouses & inventory</h2><p>Available = on hand − reserved. Reserved stock is promised to planned shipments and cannot be allocated twice.</p></div>
        <div class="row">${ctx.can('admin') ? html`<button class="btn" data-action="add-wh">+ Add warehouse</button>` : ''}</div></div>
      <div class="grid auto" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin-bottom:16px">
        ${warehouses.map((w) => html`<div class="card"><div class="row between"><b>${w.name}</b>${statusBadge(w.status)}</div><div class="muted" style="font-size:.8rem">${w.district}${w.contactPhone ? html` · ${w.contactPhone}` : ''}</div>
          <div class="stat-line" style="margin-top:8px"><span><b>${n(w.onHand)}</b> units</span><span><b>${n(w.reserved)}</b> reserved</span><span><b>${w.itemCount}</b> lines</span></div></div>`)}
      </div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Warehouse"><button class="chip-btn" data-action="wh" data-wh="all" aria-pressed="${state.wh === 'all'}">All warehouses</button>
          ${warehouses.map((w) => html`<button class="chip-btn" data-action="wh" data-wh="${w.id}" aria-pressed="${state.wh === String(w.id)}">${w.name.replace(/ (Central )?(Relief )?(Depot|Warehouse|Store|Hub)$/i, '')}</button>`)}</div>
        <span class="spacer"></span>
        <span id="wh-actions" class="row" hidden><button class="btn btn-primary btn-sm" data-action="receive">+ Receive stock</button>${ctx.can('admin') ? html`<button class="btn btn-sm" data-action="wh-status">Status</button>` : ''}</span>
        <input type="search" placeholder="Search item or category" data-input="q" value="${state.q}" aria-label="Search inventory">
      </div>
      <div class="card flush"><div class="table-wrap" id="inv-table"></div></div>`;
  },
  after() { draw?.(); },
};
