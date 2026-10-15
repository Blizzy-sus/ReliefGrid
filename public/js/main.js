import { api, ApiError, hasToken, setToken, setUnauthorizedHandler } from './api.js';
import { html, icon, loading, raw, toast, ROLE_LABEL, esc } from './ui.js';

import dashboard from './pages/dashboard.js';
import requests from './pages/requests.js';
import allocation from './pages/allocation.js';
import shipments from './pages/shipments.js';
import inventory from './pages/inventory.js';
import camps from './pages/camps.js';
import distribution from './pages/distribution.js';
import analytics from './pages/analytics.js';
import admin from './pages/admin.js';

const PAGES = { dashboard, requests, allocation, shipments, inventory, camps, distribution, analytics, admin };
const NAV = [
  { section: 'Operations' },
  { id: 'dashboard', label: 'Dashboard' }, { id: 'requests', label: 'Requests' },
  { id: 'allocation', label: 'Allocation' }, { id: 'shipments', label: 'Shipments' },
  { section: 'Resources' },
  { id: 'inventory', label: 'Inventory' }, { id: 'camps', label: 'Relief camps' }, { id: 'distribution', label: 'Distribution' },
  { section: 'Insight' },
  { id: 'analytics', label: 'Analytics' },
  { section: 'System', roles: ['admin'] },
  { id: 'admin', label: 'Administration', roles: ['admin'] },
];

const $ = (s) => document.querySelector(s);
const view = $('#view');
let user = null;
let handlers = {};
let inputHandlers = {};
let changeHandlers = {};
let cleanups = [];
let renderToken = 0;

// ------------------------------------------------------------------ theme & clock
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('reliefgrid.theme', t); } catch { /* ignore */ }
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('reliefgrid.theme'); } catch { /* ignore */ }
  if (!t) t = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(t);
})();
$('#theme-btn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
const tick = () => { $('#clock').textContent = new Date().toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
tick();
setInterval(tick, 30_000);

// ------------------------------------------------------------------ page context
function makeCtx(route) {
  return {
    el: view, user, route, api,
    on: (name, fn) => { handlers[name] = fn; },
    onInput: (name, fn) => { inputHandlers[name] = fn; },
    onChange: (name, fn) => { changeHandlers[name] = fn; },
    cleanup: (fn) => cleanups.push(fn),
    every: (ms, fn) => { const t = setInterval(fn, ms); cleanups.push(() => clearInterval(t)); },
    go: (hash) => { location.hash = hash; },
    rerender: (silent = false) => render(silent),
    can: (...roles) => roles.includes(user.role),
  };
}

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !view.contains(el)) return;
  const fn = handlers[el.dataset.action];
  if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch(reportError); }
});
view.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); if (el) inputHandlers[el.dataset.input]?.(el, e); });
view.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el) changeHandlers[el.dataset.change]?.(el, e); });
view.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('tr[data-action]');
  if (el) { handlers[el.dataset.action]?.(el, e); }
});

function reportError(err) {
  console.error(err);
  toast(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.', 'error');
}

// ------------------------------------------------------------------ routing
function parseRoute() {
  const [, page = 'dashboard', id] = location.hash.split('/');
  return { page: PAGES[page] ? page : 'dashboard', id: id ? decodeURIComponent(id) : null };
}

function renderNav(active) {
  const items = NAV.filter((i) => !i.roles || i.roles.includes(user.role));
  $('#nav').innerHTML = items.map((i) => (i.section
    ? `<div class="nav-section">${esc(i.section)}</div>`
    : `<a href="#/${i.id}" ${i.id === active ? 'aria-current="page"' : ''} data-nav="${i.id}">${icon(i.id)}<span>${esc(i.label)}</span><span class="nav-badge" data-badge="${i.id}" hidden></span></a>`)).join('');
}

async function render(silent = false) {
  const route = parseRoute();
  const page = PAGES[route.page];
  cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } });
  cleanups = []; handlers = {}; inputHandlers = {}; changeHandlers = {};
  document.body.classList.remove('nav-open');
  renderNav(route.page);
  $('#page-title').textContent = page.title;
  document.title = `${page.title} · ReliefGrid`;
  const token = ++renderToken;
  const scrollY = window.scrollY;
  if (!silent) view.innerHTML = String(loading());
  try {
    const out = await page.render(makeCtx(route));
    if (token !== renderToken) return;
    if (out != null) view.innerHTML = String(out);
    if (silent) window.scrollTo(0, scrollY);
    page.after?.(makeCtx(route));
  } catch (err) {
    if (token !== renderToken) return;
    if (err instanceof ApiError && err.status === 401) return;
    view.innerHTML = String(html`<div class="card"><div class="empty"><strong>Could not load this page</strong>${err.message}
      <div style="margin-top:14px"><button class="btn" data-action="retry">Try again</button></div></div></div>`);
    handlers.retry = () => render();
  }
  refreshBadges();
}
window.addEventListener('hashchange', () => { if (user) render(); });

async function refreshBadges() {
  try {
    const alerts = await api.get('/alerts');
    const crit = alerts.filter((a) => a.severity === 'critical').length;
    const b = document.querySelector('[data-badge="dashboard"]');
    if (b) { b.textContent = crit; b.hidden = crit === 0; b.title = `${crit} critical alert${crit === 1 ? '' : 's'}`; }
  } catch { /* non-essential */ }
}

// ------------------------------------------------------------------ session
async function enterApp() {
  user = await api.get('/auth/me');
  $('#login-root').innerHTML = '';
  $('#app').hidden = false;
  $('#user-chip').innerHTML = `<span>${esc(user.fullName)}</span><small>${esc(ROLE_LABEL[user.role])}</small>`;
  try {
    const d = await api.get('/disasters');
    const active = d.find((x) => x.status === 'ACTIVE');
    $('#incident').innerHTML = active ? `<strong><span class="dot"></span>${esc(active.name)}</strong>${active.camps} camps · ${esc(active.type.toLowerCase())} response` : '';
  } catch { /* ignore */ }
  if (!location.hash) location.hash = '#/dashboard';
  render();
}

function showLogin(message) {
  user = null;
  $('#app').hidden = true;
  const root = $('#login-root');
  root.innerHTML = String(html`
    <div class="login-screen">
      <section class="login-hero">
        <div class="row" style="gap:12px;color:var(--accent)">${raw('<svg viewBox="0 0 32 32" width="38" height="38"><path d="M16 3l11 6v8c0 6-5 10-11 12C10 27 5 23 5 17V9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 10v12M10 16h12" stroke="var(--crit)" stroke-width="2.6" stroke-linecap="round"/></svg>')}<strong style="font-size:1.2rem;color:var(--text)">ReliefGrid</strong></div>
        <h1>Get the right supplies to the right camps, <span>fairly and fast.</span></h1>
        <p>One shared operating picture for relief camps, warehouses, coordinators and volunteers, with an explainable allocation engine for the moments when demand outruns stock.</p>
        <ul class="login-points">
          <li><span class="dot">1</span><div><b>Priority-based rationing</b>Urgency, vulnerability and waiting time decide shares, never guesswork.</div></li>
          <li><span class="dot">2</span><div><b>Transaction-safe stock</b>Reservations make over-allocation impossible, with a full audit trail.</div></li>
          <li><span class="dot">3</span><div><b>Every decision explained</b>Each camp can see exactly why it received what it did.</div></li>
        </ul>
      </section>
      <section class="login-panel">
        <form class="card login-card stack" id="login-form" novalidate>
          <div><h2 style="font-size:1.3rem">Sign in</h2><p class="muted" style="margin:4px 0 0">Use your relief-operations account.</p></div>
          ${message ? html`<div class="form-error">${message}</div>` : ''}
          <label class="field">Username<input type="text" name="username" autocomplete="username" required autofocus></label>
          <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
          <div class="form-error" id="login-error" hidden></div>
          <button class="btn btn-primary" type="submit" id="login-btn">Sign in</button>
          <div id="demo-box"></div>
        </form>
      </section>
    </div>`);
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    const btn = $('#login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await api.post('/auth/login', { username: form.username.value, password: form.password.value });
      setToken(res.token);
      location.hash = '#/dashboard';
      await enterApp();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
  api.get('/auth/demo-accounts').then((d) => {
    if (!d.enabled) return;
    $('#demo-box').innerHTML = String(html`<div class="muted" style="font-size:.8rem;margin-bottom:6px">Demo accounts (local build):</div>
      <div class="demo-accounts">${d.accounts.map((a) => html`<button type="button" data-demo="${a.username}"><b>${a.username}</b>${a.hint}</button>`)}</div>`);
    $('#demo-box').addEventListener('click', (e) => {
      const b = e.target.closest('[data-demo]');
      if (!b) return;
      form.username.value = b.dataset.demo; form.password.value = d.password; form.requestSubmit();
    });
  }).catch(() => {});
}

setUnauthorizedHandler(() => showLogin('Your session has ended. Please sign in again.'));
$('#logout-btn').addEventListener('click', async () => {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  setToken(null);
  location.hash = '';
  showLogin();
});
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

if (hasToken()) enterApp().catch(() => showLogin());
else showLogin();
