import { html, n, dateTime, timeAgo, statusBadge, empty, formModal, confirmModal, toast, ROLE_LABEL, urgencyBadge } from '../ui.js';

const state = { tab: 'users' };
const TABS = [['users', 'Users & access'], ['settings', 'Allocation settings'], ['audit', 'Audit trail'], ['integrity', 'Data integrity']];

export default {
  title: 'Administration',
  async render(ctx) {
    ctx.on('tab', (el) => { state.tab = el.dataset.tab; ctx.rerender(true); });
    const body = await ({ users, settings, audit, integrity })[state.tab](ctx);
    return html`
      <div class="page-head"><div><h2>Administration</h2><p>Accounts, allocation parameters, the audit trail and database self-checks.</p></div></div>
      <div class="toolbar"><div class="chips" role="group" aria-label="Section">${TABS.map(([v, l]) => html`<button class="chip-btn" data-action="tab" data-tab="${v}" aria-pressed="${state.tab === v}">${l}</button>`)}</div></div>
      ${body}`;
  },
};

async function users(ctx) {
  const [list, camps, warehouses] = await Promise.all([ctx.api.get('/users'), ctx.api.get('/camps'), ctx.api.get('/warehouses')]);
  ctx.on('add-user', () => {
    const m = formModal({
      title: 'Add user', submitLabel: 'Create user', wide: true,
      fields: [
        { name: 'fullName', label: 'Full name', required: true }, { name: 'username', label: 'Username', required: true },
        { name: 'role', label: 'Role', type: 'select', options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })), value: 'volunteer' },
        { name: 'phone', label: 'Phone' },
        { name: 'campId', label: 'Camp (coordinators)', type: 'select', options: camps.filter((c) => c.status !== 'CLOSED').map((c) => ({ value: c.id, label: c.name })) },
        { name: 'warehouseId', label: 'Warehouse (managers)', type: 'select', options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
        { name: 'password', label: 'Initial password', type: 'password', required: true, hint: 'At least 8 characters', full: true },
      ],
      onSubmit: async (v) => {
        await ctx.api.post('/users', { ...v, campId: v.role === 'camp_coordinator' ? Number(v.campId) : undefined, warehouseId: v.role === 'warehouse_manager' ? Number(v.warehouseId) : undefined, phone: v.phone || undefined });
        toast('User created', 'success'); ctx.rerender(true);
      },
    });
  });
  ctx.on('toggle', (el) => {
    const u = list.find((x) => x.id === Number(el.dataset.id));
    confirmModal({
      title: `${u.active ? 'Deactivate' : 'Reactivate'} ${u.fullName}?`, message: u.active ? 'They will be signed out immediately and cannot sign in again until reactivated.' : 'They will be able to sign in again.',
      confirmLabel: u.active ? 'Deactivate' : 'Reactivate', danger: u.active,
      onConfirm: async () => { await ctx.api.patch(`/users/${u.id}`, { active: !u.active }); toast('User updated', 'success'); ctx.rerender(true); },
    });
  });
  ctx.on('reset', (el) => formModal({
    title: 'Reset password', subtitle: list.find((x) => x.id === Number(el.dataset.id)).fullName, submitLabel: 'Reset password',
    fields: [{ name: 'password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters. Existing sessions are ended.' }],
    onSubmit: async (v) => { await ctx.api.patch(`/users/${el.dataset.id}`, { password: v.password }); toast('Password reset', 'success'); },
  }));
  return html`<div class="card flush"><div class="card-head"><div><h2>${list.length} accounts</h2><p>Camp coordinators and warehouse managers are scoped to their own camp or warehouse by a database constraint.</p></div><button class="btn btn-primary" data-action="add-user">+ Add user</button></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Scope</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((u) => html`<tr><td><b>${u.fullName}</b></td><td class="mono">${u.username}</td><td><span class="badge accent plain role-badge">${ROLE_LABEL[u.role]}</span></td><td class="muted">${u.campName || u.warehouseName || 'Network-wide'}</td>
      <td class="muted nowrap">${u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</td><td>${u.active ? html`<span class="badge ok">Active</span>` : html`<span class="badge plain">Inactive</span>`}</td>
      <td class="nowrap right"><button class="btn btn-sm" data-action="reset" data-id="${u.id}">Reset password</button> <button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-action="toggle" data-id="${u.id}">${u.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`)}</tbody></table></div></div>`;
}

async function settings(ctx) {
  const cfg = await ctx.api.get('/allocation/settings');
  ctx.on('edit-settings', () => formModal({
    title: 'Allocation parameters', subtitle: 'Changes apply to future runs only. Each committed run stores the parameters it used.', wide: true,
    fields: cfg.settings.map((s) => ({ name: s.key, label: s.key.replaceAll('_', ' '), type: 'number', step: 'any', value: s.value, required: true, hint: s.description })),
    onSubmit: async (v) => { await ctx.api.put('/allocation/settings', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))); toast('Settings saved', 'success'); ctx.rerender(true); },
  }));
  ctx.on('edit-urgency', (el) => {
    const u = cfg.urgencyLevels.find((x) => x.level === Number(el.dataset.level));
    formModal({
      title: `${u.label} urgency`, subtitle: 'The weight multiplies a request’s priority score; the target is the time within which a first allocation is expected.',
      fields: [{ name: 'weight', label: 'Priority weight', type: 'number', step: 'any', min: 0.1, value: u.weight, required: true }, { name: 'slaHours', label: 'Target hours to first allocation', type: 'number', min: 1, value: u.slaHours, required: true }],
      onSubmit: async (v) => { await ctx.api.put(`/urgency-levels/${u.level}`, { weight: Number(v.weight), slaHours: Number(v.slaHours) }); toast('Urgency level updated', 'success'); ctx.rerender(true); },
    });
  });
  return html`<div class="grid cols-2">
    <div class="card flush"><div class="card-head"><div><h2>Urgency levels</h2><p>The weight is the biggest lever in a shortage</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Level</th><th class="right">Weight</th><th class="right">Target</th><th></th></tr></thead><tbody>
      ${cfg.urgencyLevels.slice().reverse().map((u) => html`<tr><td>${urgencyBadge(u.level, u.label)}</td><td class="right num">${u.weight}</td><td class="right num">${u.slaHours} h</td><td class="right"><button class="btn btn-sm" data-action="edit-urgency" data-level="${u.level}">Edit</button></td></tr>`)}</tbody></table></div></div>
    <div class="card flush"><div class="card-head"><div><h2>Parameters</h2></div><button class="btn btn-sm" data-action="edit-settings">Edit</button></div>
      <div class="table-wrap"><table><tbody>${cfg.settings.map((s) => html`<tr><td><b>${s.key.replaceAll('_', ' ')}</b><div class="muted" style="font-size:.78rem">${s.description}</div></td><td class="right num"><b>${s.value}</b></td></tr>`)}</tbody></table></div></div>
  </div>`;
}

async function audit(ctx) {
  const rows = await ctx.api.get('/audit?limit=200');
  return html`<div class="card flush"><div class="card-head"><div><h2>Audit trail</h2><p>Append-only: database triggers reject updates and deletes</p></div></div>
    <div class="table-wrap">${rows.length ? html`<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td class="nowrap muted" title="${r.createdAt}">${dateTime(r.createdAt)}</td><td>${r.actor || 'System'}</td><td><span class="badge accent plain mono">${r.action}</span></td><td class="muted">${r.entityType}${r.entityId ? html` #${r.entityId}` : ''}</td><td class="muted mono" style="font-size:.76rem;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.details || ''}">${r.details || ''}</td></tr>`)}</tbody></table>` : empty('No entries')}</div></div>`;
}

async function integrity(ctx) {
  const res = await ctx.api.get('/integrity');
  ctx.on('recheck', () => ctx.rerender(true));
  return html`<div class="card"><div class="card-head"><div><h2>Database self-check</h2><p>Reconciliation views compare derived figures with the ledgers they should match. Zero rows means consistent.</p></div><button class="btn btn-sm" data-action="recheck">Run checks again</button></div>
    ${res.ok ? html`<div class="callout ok"><b>All ${res.checks.length} checks passed.</b> Inventory equals the replayed stock ledger, reservations equal planned shipments, request counters equal shipments, and camp stock equals deliveries minus distributions.</div>`
      : html`<div class="callout warn"><b>${res.problems.length} check${res.problems.length === 1 ? '' : 's'} failed.</b></div>${res.problems.map((p) => html`<h3 style="margin:14px 0 6px">${p.description}</h3><pre class="json">${JSON.stringify(p.rows.slice(0, 8), null, 2)}</pre>`)}`}
    <ul class="timeline" style="margin-top:16px">${res.checks.map((c) => html`<li><b class="mono">${c.check}</b><small>${c.description}</small></li>`)}</ul></div>`;
}
