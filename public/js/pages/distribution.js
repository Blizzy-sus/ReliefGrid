import { html, n, timeAgo, dateTime, empty, formModal, toast } from '../ui.js';

const state = { camp: '' };

export default {
  title: 'Distribution',
  async render(ctx) {
    const camps = (await ctx.api.get('/camps')).filter((c) => c.status !== 'CLOSED');
    const u = ctx.user;
    if (u.role === 'camp_coordinator') state.camp = String(u.campId);
    const campId = state.camp ? Number(state.camp) : null;
    const [list, stock] = await Promise.all([
      ctx.api.get(`/distributions${campId ? `?campId=${campId}` : ''}`),
      campId ? ctx.api.get(`/camps/${campId}/stock`) : Promise.resolve([]),
    ]);
    const canRecord = campId && (u.role === 'admin' || (u.role === 'camp_coordinator' && u.campId === campId));
    ctx.onChange('camp', (el) => { state.camp = el.value; ctx.rerender(true); });
    ctx.on('record', () => {
      const camp = camps.find((c) => c.id === campId);
      const usable = stock.filter((s) => s.quantity > 0);
      if (!usable.length) { toast('This camp holds no stock to distribute yet.', 'error'); return; }
      formModal({
        title: 'Record a distribution', subtitle: `${camp.name}. Stock held at the camp is reduced; it cannot go below zero.`, submitLabel: 'Record',
        fields: [
          { name: 'itemId', label: 'Item', type: 'select', options: usable.map((s) => ({ value: s.itemId, label: `${s.itemName}: ${n(s.quantity)} ${s.unit} on hand` })) },
          { name: 'quantity', label: 'Quantity handed out', type: 'number', min: 1, required: true },
          { name: 'peopleServed', label: 'People served', type: 'number', min: 1, max: camp.population, required: true, hint: `Camp population: ${n(camp.population)}` },
          { name: 'note', label: 'Note', full: true, placeholder: 'e.g. Evening ration, Block C' },
        ],
        onSubmit: async (v) => {
          await ctx.api.post('/distributions', { campId, itemId: Number(v.itemId), quantity: Number(v.quantity), peopleServed: Number(v.peopleServed), note: v.note || undefined });
          toast('Distribution recorded', 'success'); ctx.rerender(true);
        },
      });
    });
    return html`
      <div class="page-head"><div><h2>Distribution to residents</h2><p>Closing the loop: record what each camp hands out so stock on hand and need stay honest.</p></div>
        ${canRecord ? html`<button class="btn btn-primary" data-action="record">+ Record distribution</button>` : ''}</div>
      <div class="toolbar">${u.role === 'camp_coordinator' ? html`<b>${camps.find((c) => c.id === u.campId)?.name}</b>` : html`<select data-change="camp" aria-label="Camp"><option value="">All camps</option>${camps.map((c) => html`<option value="${c.id}" ${state.camp === String(c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>`}</div>
      <div class="grid main-side">
        <div class="card flush"><div class="card-head"><div><h2>Recent distributions</h2></div></div>
          <div class="table-wrap">${list.length ? html`<table><thead><tr><th>When</th>${campId ? '' : html`<th>Camp</th>`}<th>Item</th><th class="right">Quantity</th><th class="right">People</th><th>Recorded by</th></tr></thead><tbody>
            ${list.slice(0, 80).map((d) => html`<tr><td class="nowrap muted" title="${dateTime(d.createdAt)}">${timeAgo(d.createdAt)}</td>${campId ? '' : html`<td>${d.campName}</td>`}<td>${d.itemName}</td><td class="right num">${n(d.quantity)} ${d.unit}</td><td class="right num">${n(d.peopleServed)}</td><td class="muted">${d.recordedBy}</td></tr>`)}</tbody></table>` : empty('Nothing recorded yet')}</div></div>
        <div class="card flush"><div class="card-head"><div><h2>${campId ? 'Stock held at camp' : 'Select a camp'}</h2></div></div>
          <div class="table-wrap">${campId ? (stock.length ? html`<table><thead><tr><th>Item</th><th class="right">On hand</th></tr></thead><tbody>${stock.map((s) => html`<tr><td>${s.itemName}</td><td class="right num">${n(s.quantity)} ${s.unit}</td></tr>`)}</tbody></table>` : empty('Nothing received yet')) : empty('Choose a camp', 'to see what it currently holds.')}</div></div>
      </div>`;
  },
};
