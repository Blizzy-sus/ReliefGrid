import { html, n, pct, dateTime, timeAgo, meter, coverageClass, urgencyBadge, urgencyClass, statusBadge, empty, loading, confirmModal, toast } from '../ui.js';

let lastPlan = null;
const LEVEL = { Critical: 4, High: 3, Moderate: 2, Low: 1 };

export default {
  title: 'Allocation engine',
  async render(ctx) {
    if (ctx.route.id) return runDetail(ctx);
    const [cfg, runs] = await Promise.all([ctx.api.get('/allocation/settings'), ctx.api.get('/allocation/runs')]);
    const isAdmin = ctx.can('admin');
    const S = Object.fromEntries(cfg.settings.map((s) => [s.key, s.value]));
    ctx.on('open-run', (el) => ctx.go(`#/allocation/${el.dataset.id}`));
    ctx.on('toggle-expl', toggleExplanation);
    ctx.on('preview', async (el) => {
      el.disabled = true; el.textContent = 'Calculating…';
      try {
        lastPlan = await ctx.api.post('/allocation/preview');
        showPlan(ctx);
      } finally { el.disabled = false; el.textContent = 'Preview allocation'; }
    });
    ctx.on('commit', () => {
      const t = lastPlan.totals;
      confirmModal({
        title: 'Commit this allocation?',
        message: html`This will reserve <b>${n(t.unitsAllocated)}</b> units of stock and create <b>${t.shipments}</b> planned shipment${t.shipments === 1 ? '' : 's'} for <b>${t.requestLines}</b> request lines. Stock is re-read inside the transaction, so nothing can be reserved twice. The decision record becomes part of the permanent history.`,
        confirmLabel: 'Commit allocation',
        onConfirm: async () => {
          const res = await ctx.api.post('/allocation/run', { note: document.getElementById('run-note')?.value || undefined });
          toast(`Allocation run #${res.runId} committed: ${res.shipmentIds.length} shipments planned`, 'success');
          lastPlan = null;
          ctx.go(`#/allocation/${res.runId}`);
        },
      });
    });

    return html`
      <div class="page-head"><div><h2>Priority-based allocation</h2><p>When requests exceed stock, ReliefGrid shares each item by priority: fair, repeatable and fully explained. Nothing changes until an administrator commits a run.</p></div></div>

      <div class="card">
        <div class="card-head"><div><h2>How a shortage is shared</h2><p>The method, with the parameters currently in force</p></div></div>
        <div class="formula">
          <div class="term"><small>Priority score</small><b>score</b></div><span class="op">=</span>
          <div class="term"><small>Urgency weight</small><b>${cfg.urgencyLevels.map((u) => u.weight).join(' / ')}</b></div><span class="op">×</span>
          <div class="term"><small>Vulnerability</small><b>1 + ${S.vulnerability_weight} × at-risk share</b></div><span class="op">×</span>
          <div class="term"><small>Waiting time</small><b>1 + ${S.aging_max_bonus} × min(1, hours / ${S.aging_window_hours})</b></div>
        </div>
        <ol class="steps">
          <li><b>Each supply item is rationed on its own.</b> If stock covers all open demand for the item, everyone gets everything they still need.</li>
          <li><b>If stock falls short,</b> every request line is raised to a <b>coverage</b> (share of its approved quantity) proportional to its priority score, capped at 100%. A Critical line (×${cfg.urgencyLevels[3].weight}) ends up with about ${n(cfg.urgencyLevels[3].weight / cfg.urgencyLevels[0].weight)}× the coverage of an otherwise identical Low line, but a Low line is never starved.</li>
          <li><b>Surplus is redistributed.</b> Lines that reach 100% release what they do not need to the rest. Lines already served by an earlier run count what they hold, so camps that have waited catch up first.</li>
          <li><b>Whole units, nearest stock.</b> Fractions are resolved by largest remainder so totals are exact; each line is then served from the nearest warehouses, highest priority first, and stock is reserved in the same transaction.</li>
        </ol>
        <div class="row" style="margin-top:12px">${cfg.urgencyLevels.slice().reverse().map((u) => html`<span class="badge ${urgencyClass(u.level)}">${u.label} ×${u.weight} · target ${u.slaHours}h</span>`)}</div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Plan a run</h2><p>${isAdmin ? 'Preview shows exactly what would happen. Commit reserves the stock and plans the shipments.' : 'Only administrators can run allocation. You can review every run and its explanations below.'}</p></div>
          ${isAdmin ? html`<button class="btn btn-primary" data-action="preview">Preview allocation</button>` : ''}</div>
        <div id="plan">${isAdmin ? html`<div class="empty"><strong>No preview yet</strong>Press “Preview allocation” to see how current stock would be shared.</div>` : ''}</div>
      </div>

      <div class="card flush" style="margin-top:16px">
        <div class="card-head"><div><h2>Allocation history</h2><p>Immutable record of every committed run</p></div></div>
        <div class="table-wrap">${runs.length ? html`<table><thead><tr><th>Run</th><th>When</th><th>By</th><th class="right">Lines</th><th class="right">Scarce items</th><th class="right">Units</th><th class="right">Shipments</th><th>Note</th></tr></thead><tbody>
          ${runs.map((r) => html`<tr class="clickable" data-action="open-run" data-id="${r.id}" tabindex="0"><td class="mono">#${r.id}</td><td class="nowrap">${dateTime(r.createdAt)} <span class="muted">(${timeAgo(r.createdAt)})</span></td><td>${r.runBy}</td>
            <td class="right num">${r.requestsConsidered}</td><td class="right num">${r.itemsScarce}</td><td class="right num">${n(r.unitsAllocated)}</td><td class="right num">${r.shipmentsCreated}</td><td class="muted">${r.note || ''}</td></tr>`)}</tbody></table>` : empty('No runs yet')}</div>
      </div>`;
  },
  after(ctx) { if (!ctx.route.id && lastPlan) showPlan(ctx); },
};

function showPlan(ctx) {
  const el = ctx.el.querySelector('#plan');
  if (!el || !lastPlan) return;
  const p = lastPlan;
  el.innerHTML = String(html`
    ${p.decisions.length === 0 ? html`<div class="callout ok"><b>Nothing to allocate.</b> There are no open request lines.</div>` : html`
    ${renderPlan(p, { preview: true })}
    <div class="row" style="margin-top:16px;align-items:flex-end">
      <label class="field" style="flex:1;min-width:220px">Note for the record (optional)<input type="text" id="run-note" maxlength="200" placeholder="e.g. Second allocation after tanker arrival"></label>
      <button class="btn btn-primary" data-action="commit">Commit allocation…</button>
    </div>`}`);
}

/** Shared by preview and run detail. */
export function renderPlan(plan, { preview = false } = {}) {
  const items = plan.items.slice().sort((a, b) => Number(b.scarce) - Number(a.scarce) || (a.supply / a.demand) - (b.supply / b.demand));
  const t = plan.totals;
  return html`
    <div class="grid cols-4" style="margin-bottom:14px">
      <div class="card kpi low"><div class="label">Request lines</div><div class="value">${t.requestLines}</div></div>
      <div class="card kpi ${t.scarceItems ? 'high' : 'ok'}"><div class="label">Scarce items</div><div class="value">${t.scarceItems}</div><div class="sub">demand exceeds stock</div></div>
      <div class="card kpi"><div class="label">Units ${preview ? 'to allocate' : 'allocated'}</div><div class="value">${n(t.unitsAllocated)}</div></div>
      <div class="card kpi low"><div class="label">Shipments ${preview ? 'to plan' : 'planned'}</div><div class="value">${t.shipments}</div></div>
    </div>
    ${items.map((it) => {
      const ds = plan.decisions.filter((d) => d.itemId === it.itemId).sort((a, b) => b.score - a.score);
      const cov = it.demand ? Math.min(1, it.supply / it.demand) : 1;
      return html`<details class="item-block" ${it.scarce ? 'open' : ''}>
        <summary>
          <div><b>${it.itemName}</b><div class="muted" style="font-size:.8rem">${ds.length} request line${ds.length === 1 ? '' : 's'}</div></div>
          <div>${meter(cov, { cls: coverageClass(cov), label: pct(cov) })}<div class="muted" style="font-size:.76rem;margin-top:3px">${n(it.supply)} in stock vs ${n(it.demand)} ${it.unit} needed</div></div>
          <div>${it.scarce ? html`<span class="badge high">Scarce · rationed</span>` : html`<span class="badge ok">Sufficient</span>`}</div>
          <div class="right"><b class="num">${n(it.allocated)}</b> <span class="muted">${it.unit}</span><span class="chev"> ›</span></div>
        </summary>
        <div class="table-wrap"><table><thead><tr><th>Camp</th><th>Urgency</th><th>Priority</th><th class="right">Still needs</th><th class="right">Allocated</th><th>Coverage</th><th>Sourced from</th></tr></thead><tbody>
          ${ds.map((d) => html`<tr class="clickable" data-action="toggle-expl" tabindex="0">
            <td><b>${d.campName}</b>${d.prior > 0 ? html`<div class="muted" style="font-size:.76rem">already holds ${n(d.prior)} of ${n(d.approved)}</div>` : ''}</td>
            <td>${urgencyBadge(d.urgencyLevel ?? LEVEL[d.urgencyLabel], d.urgencyLabel)}</td>
            <td><span class="score"><b>${d.score.toFixed(2)}</b><small>${d.urgencyWeight} × ${d.vulnerabilityFactor.toFixed(2)} × ${d.agingFactor.toFixed(2)}</small></span></td>
            <td class="right num">${n(d.need)}</td>
            <td class="right num"><b>${n(d.allocated)}</b></td>
            <td style="min-width:150px">${meter(d.cumulativeCoverage, { cls: coverageClass(d.cumulativeCoverage), marker: d.targetCoverage, label: pct(d.cumulativeCoverage) })}</td>
            <td class="muted" style="font-size:.8rem">${d.sources.length ? d.sources.map((s) => html`<div>${s.warehouseName} · ${n(s.quantity)} · ${s.distanceKm} km${s.shipmentCode ? html` <span class="mono">${s.shipmentCode}</span>` : ''}</div>`) : '–'}</td></tr>
            <tr class="expl" hidden><td colspan="7"><div class="explain"><b>Why:</b> ${d.explanation}</div></td></tr>`)}</tbody></table></div>
      </details>`;
    })}
    <p class="muted" style="font-size:.8rem;margin:12px 0 0">Coverage = (already allocated + allocated now) ÷ approved quantity. The tick on each bar is the fair coverage level for that line when stock was short. Select a row for its plain-language explanation.</p>`;
}

function toggleExplanation(el) {
  const next = el.nextElementSibling;
  if (next?.classList.contains('expl')) next.hidden = !next.hidden;
}

async function runDetail(ctx) {
  ctx.on('toggle-expl', toggleExplanation);
  ctx.on('open-shipment', (el) => ctx.go(`#/shipments/${el.dataset.id}`));
  const run = await ctx.api.get(`/allocation/runs/${ctx.route.id}`);
  const labelByWeight = new Map(run.params.urgencyLevels.map((u) => [u.weight, u]));
  const items = new Map();
  for (const d of run.decisions) {
    const u = labelByWeight.get(d.urgencyWeight);
    d.urgencyLabel = u?.label || `×${d.urgencyWeight}`;
    d.urgencyLevel = u?.level;
    d.targetCoverage = null;
    d.sources = d.sources.map((s) => ({ ...s }));
    if (!items.has(d.itemId)) items.set(d.itemId, { itemId: d.itemId, itemName: d.itemName, unit: d.unit, supply: d.itemSupply, demand: d.itemDemand, scarce: Boolean(d.scarce), allocated: 0 });
    items.get(d.itemId).allocated += d.allocated;
  }
  const plan = { items: [...items.values()], decisions: run.decisions, totals: { requestLines: run.requestsConsidered, scarceItems: run.itemsScarce, unitsAllocated: run.unitsAllocated, shipments: run.shipmentsCreated } };
  return html`
    <div class="page-head"><div><a href="#/allocation">← Allocation</a><h2 style="margin-top:6px">Allocation run #${run.id}</h2>
      <p>Committed ${dateTime(run.createdAt)} (${timeAgo(run.createdAt)}) by ${run.runBy}${run.note ? html` · “${run.note}”` : ''}</p></div></div>
    <div class="card">${renderPlan(plan)}</div>
    <div class="card flush" style="margin-top:16px"><div class="card-head"><div><h2>Shipments planned by this run</h2></div></div>
      <div class="table-wrap">${run.shipments.length ? html`<table><thead><tr><th>Code</th><th>From</th><th>To</th><th class="right">km</th><th>Status now</th></tr></thead><tbody>
        ${run.shipments.map((s) => html`<tr class="clickable" data-action="open-shipment" data-id="${s.id}" tabindex="0"><td class="mono">${s.code}</td><td>${s.warehouseName}</td><td>${s.campName}</td><td class="right num">${s.distanceKm}</td><td>${statusBadge(s.status)}</td></tr>`)}</tbody></table>` : empty('No shipments', 'Nothing could be allocated in this run.')}</div></div>
    <details class="plain card" style="margin-top:16px"><summary>Parameters in force when this run was committed</summary>
      <dl class="kv" style="margin-top:12px">${Object.entries(run.params.settings).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
      ${run.params.urgencyLevels.map((u) => html`<dt>Urgency: ${u.label}</dt><dd>weight ${u.weight}, target ${u.sla_hours}h</dd>`)}</dl></details>`;
}
