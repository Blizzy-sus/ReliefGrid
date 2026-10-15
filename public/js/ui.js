// UI helpers: auto-escaping html``, formatting, badges, modals, toasts, forms.

export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const render = (v) => {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
};
/** Tagged template that escapes every interpolated value unless it is already Safe. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Safe(out);
}

// ---------------------------------------------------------------- formatting
const nf = new Intl.NumberFormat('en-US');
export const n = (v) => (v == null ? '–' : nf.format(Math.round(v * 100) / 100));
export const pct = (v, d = 0) => (v == null ? '–' : `${(v * 100).toFixed(d)}%`);

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '–';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 0) { const f = -s; return f < 3600 ? `in ${Math.round(f / 60)}m` : f < 86400 ? `in ${Math.round(f / 3600)}h` : `in ${Math.round(f / 86400)}d`; }
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');

// ---------------------------------------------------------------- badges
const URGENCY = { 4: ['Critical', 'crit'], 3: ['High', 'high'], 2: ['Moderate', 'mod'], 1: ['Low', 'low'] };
export const urgencyClass = (level) => (URGENCY[level] || ['', 'low'])[1];
export const urgencyBadge = (level, label) => html`<span class="badge ${urgencyClass(level)}">${label || URGENCY[level]?.[0]}</span>`;

const STATUS = {
  PENDING: ['Pending', 'mod'], PARTIALLY_ALLOCATED: ['Partly allocated', 'high'], ALLOCATED: ['Allocated', 'accent'],
  FULFILLED: ['Fulfilled', 'ok'], CANCELLED: ['Cancelled', 'plain'],
  PLANNED: ['Planned', 'low'], IN_TRANSIT: ['In transit', 'accent'], DELIVERED: ['Delivered', 'ok'],
  OPEN: ['Open', 'ok'], FULL: ['Full', 'high'], CLOSED: ['Closed', 'plain'],
  ACTIVE: ['Active', 'ok'], OFFLINE: ['Offline', 'crit'], RECOVERY: ['Recovery', 'mod'],
};
export const statusBadge = (s) => { const [label, cls] = STATUS[s] || [s, 'plain']; return html`<span class="badge ${cls}">${label}</span>`; };
export const statusLabel = (s) => (STATUS[s] || [s])[0];
export const ROLE_LABEL = { admin: 'Administrator', warehouse_manager: 'Warehouse manager', camp_coordinator: 'Camp coordinator', volunteer: 'Volunteer' };

export function meter(value, { max = 1, cls = '', label, marker } = {}) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return html`<div class="meter-cell"><div class="bar ${cls}"><i style="width:${w}%"></i>${marker != null ? html`<b class="marker" style="left:${Math.min(100, marker * 100)}%"></b>` : ''}</div><span>${label ?? pct(value)}</span></div>`;
}
export const coverageClass = (c) => (c >= 0.75 ? 'ok' : c >= 0.4 ? 'mod' : c >= 0.15 ? 'high' : 'crit');

export const icon = (name) => raw(ICONS[name] || '');
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  requests: svg('<path d="M9 4h6l1 2h3v14H5V6h3z"/><path d="M9 12h6M9 16h4"/>'),
  allocation: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7"/>'),
  shipments: svg('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
  inventory: svg('<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>'),
  camps: svg('<path d="M3 20L12 4l9 16z"/><path d="M12 20v-7l-3 7M12 13l3 7"/>'),
  distribution: svg('<path d="M12 21s-7-4.5-7-10a7 7 0 0114 0c0 5.5-7 10-7 10z"/><circle cx="12" cy="11" r="2.5"/>'),
  analytics: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  admin: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18.2v.1"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/>'),
};

// ---------------------------------------------------------------- toasts
export function toast(message, kind = 'info', ms = 4200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------------------------------------------------------------- modal
let modalCount = 0;
/** Open a modal. Returns { el, close }. `body` may be html``. */
export function modal({ title, subtitle, body, actions = [], wide = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const id = `m${++modalCount}`;
  overlay.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
      <div class="modal-head"><div><h2 id="${id}-t"></h2><p class="sub"></p></div><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div>`;
  overlay.querySelector('h2').textContent = title || '';
  const sub = overlay.querySelector('.sub');
  if (subtitle) sub.textContent = subtitle; else sub.remove();
  overlay.querySelector('.modal-body').innerHTML = String(body ?? '');
  const foot = overlay.querySelector('.modal-foot');
  if (!actions.length) foot.remove();
  const previouslyFocused = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && overlay === root.lastElementChild) close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.cls || ''}`;
    b.textContent = a.label;
    if (a.form) b.setAttribute('form', a.form), b.type = 'submit';
    else b.addEventListener('click', () => a.onClick?.({ close, button: b, el: overlay }));
    foot.appendChild(b);
  }
  root.appendChild(overlay);
  (overlay.querySelector('[autofocus], input:not([type=hidden]), select, textarea') || overlay.querySelector('.modal'))?.focus();
  return { el: overlay, close };
}

function fieldHtml(f) {
  const id = `f_${f.name}`;
  const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.disabled ? 'disabled' : ''}`;
  let control;
  if (f.type === 'select') {
    control = `<select ${common}>${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea ${common} maxlength="${f.max || 500}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`;
  } else if (f.type === 'checkbox') {
    control = `<input type="checkbox" ${common} ${f.value ? 'checked' : ''}>`;
  } else {
    control = `<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
  }
  return `<label class="field ${f.full ? 'full' : ''}" for="${id}">${esc(f.label)}${control}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
}

/**
 * Form modal. fields: [{ name, label, type, options, required, value, hint, full }].
 * onSubmit(values) may throw; the message is shown in the dialog and the dialog stays open.
 */
export function formModal({ title, subtitle, fields, submitLabel = 'Save', danger = false, extra = '', onSubmit, wide }) {
  const formId = `form${++modalCount}`;
  const m = modal({
    title, subtitle, wide,
    body: raw(`<form id="${formId}" class="stack" novalidate><div class="form-grid">${fields.map(fieldHtml).join('')}</div>${extra}<div class="form-error" hidden></div></form>`),
    actions: [{ label: 'Cancel', onClick: ({ close }) => close() }, { label: submitLabel, cls: danger ? 'btn-danger' : 'btn-primary', form: formId }],
  });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.hidden = true;
    if (!form.reportValidity()) return;
    const values = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    }
    const btn = m.el.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(values, form);
      m.close();
    } catch (ex) {
      err.textContent = ex.message || 'Something went wrong.';
      err.hidden = false;
      btn.disabled = false;
    }
  });
  return m;
}

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  const m = modal({
    title, body: html`<p style="margin:0">${message}</p><div class="form-error" hidden style="margin-top:12px"></div>`,
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      {
        label: confirmLabel, cls: danger ? 'btn-danger' : 'btn-primary',
        onClick: async ({ close, button, el }) => {
          button.disabled = true;
          try { await onConfirm(); close(); } catch (ex) {
            const err = el.querySelector('.form-error'); err.textContent = ex.message; err.hidden = false; button.disabled = false;
          }
        },
      },
    ],
  });
  return m;
}

export const loading = (text = 'Loading…') => html`<div class="loading"><div class="spinner"></div><div>${text}</div></div>`;
export const empty = (title, text = '') => html`<div class="empty"><strong>${title}</strong>${text}</div>`;
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
