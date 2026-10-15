// Captures the report's application screenshots from the running ReliefGrid server.
// Usage: node screens.mjs   (server must be running on http://localhost:3000 with a freshly seeded database)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'assets', 'screens');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3000';
const PASSWORD = 'ReliefGrid@2026';
const THEME = process.env.THEME || 'light';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });

async function token(username) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login failed for ${username}`);
  return (await res.json()).token;
}

async function session(username, { width = 1240, height = 800, scale = 1.6 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const t = username ? await token(username) : null;
  await page.evaluateOnNewDocument((tok, theme) => {
    try { if (tok) sessionStorage.setItem('reliefgrid.token', tok); localStorage.setItem('reliefgrid.theme', theme); } catch { /* ignore */ }
  }, t, THEME);
  return page;
}

async function go(page, hash, wait = 1600) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' });
  if (hash) { await page.evaluate((h) => { location.hash = h.replace(/^.*#/, '#'); }, hash); }
  await sleep(wait);
  await page.evaluate(() => window.scrollTo(0, 0));
}
const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
  console.log('captured', name);
};
const click = async (page, selector) => { await page.waitForSelector(selector, { timeout: 8000 }); await page.click(selector); };
const clickText = async (page, selector, text) => {
  await page.evaluate((s, t) => { [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t)).click(); }, selector, text);
};
const evalIn = (page, fn, ...args) => page.evaluate(fn, ...args);

try {
  // ------------------------------------------------------------ 01 login (signed out)
  {
    const page = await session(null);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(900);
    await shot(page, '01_login');
    await page.close();
  }

  // ------------------------------------------------------------ admin
  const admin = await session('admin');
  await go(admin, '#/dashboard', 2200);
  await shot(admin, '02_dashboard');
  await evalIn(admin, () => window.scrollTo(0, 780));
  await sleep(400);
  await shot(admin, '02b_dashboard_lower');

  await go(admin, '#/requests');
  await shot(admin, '03_requests');

  await go(admin, '#/requests/2');
  await shot(admin, '04_request_detail');

  await go(admin, '#/allocation');
  await shot(admin, '05_allocation_method');

  await click(admin, '[data-action=preview]');
  await sleep(2200);
  await evalIn(admin, () => {
    document.querySelectorAll('.item-block').forEach((b) => { b.open = b.innerText.includes('Packaged drinking water'); });
    const b = [...document.querySelectorAll('.item-block')].find((x) => x.innerText.includes('Packaged drinking water'));
    b.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80);
  });
  await sleep(400);
  await shot(admin, '06_allocation_preview_water');

  // expand an explanation row inside the water block
  await evalIn(admin, () => {
    const b = [...document.querySelectorAll('.item-block')].find((x) => x.innerText.includes('Packaged drinking water'));
    const row = b.querySelectorAll('tr[data-action=toggle-expl]')[2];
    row.click(); row.scrollIntoView({ block: 'center' });
  });
  await sleep(400);
  await shot(admin, '07_allocation_explanation');

  // insulin block (deficit-aware lines)
  await evalIn(admin, () => {
    document.querySelectorAll('.item-block').forEach((b) => { b.open = b.innerText.includes('Insulin vials'); });
    const b = [...document.querySelectorAll('.item-block')].find((x) => x.innerText.includes('Insulin vials'));
    b.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80);
  });
  await sleep(400);
  await shot(admin, '08_allocation_insulin_deficit');

  // commit
  await evalIn(admin, () => document.querySelector('[data-action=commit]').click());
  await sleep(600);
  await shot(admin, '09_commit_dialog');
  await evalIn(admin, () => [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent.includes('Commit allocation')).click());
  await sleep(2200);
  await evalIn(admin, () => window.scrollTo(0, 0));
  await shot(admin, '10_run_detail');
  await evalIn(admin, () => { const t = [...document.querySelectorAll('.card.flush')].find((c) => c.innerText.includes('Shipments planned')); t.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); });
  await sleep(300);
  await shot(admin, '10b_run_shipments');
  await go(admin, '#/allocation');
  await evalIn(admin, () => { const t = [...document.querySelectorAll('.card.flush')].find((c) => c.innerText.includes('Allocation history')); t.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); });
  await sleep(300);
  await shot(admin, '11_allocation_history');
  await admin.close();

  // ------------------------------------------------------------ warehouse manager
  const wm = await session('wm_thanjavur');
  await go(wm, '#/shipments');
  await shot(wm, '12_shipments_manager');
  await evalIn(wm, () => document.querySelector('[data-action=dispatch]').click());
  await sleep(500);
  await evalIn(wm, () => { document.querySelector('#f_vehicle').value = 'TN-45-AB-1234'; });
  await shot(wm, '13_dispatch_dialog');
  await evalIn(wm, () => document.querySelector('.modal button[type=submit]').click());
  await sleep(1800);
  const code = await evalIn(wm, () => [...document.querySelectorAll('.ship-card')].find((c) => c.innerText.includes('In transit') && c.innerText.includes('TN-45-AB-1234')).querySelector('.code').textContent);
  console.log('dispatched', code);
  await evalIn(wm, (c) => { const id = Number(c.replace('SHP-', '')); location.hash = `#/shipments/${id}`; }, code);
  await sleep(1600);
  await shot(wm, '14_shipment_detail');
  await go(wm, '#/inventory');
  await evalIn(wm, () => document.querySelector('[data-action=ledger]').click());
  await sleep(900);
  await shot(wm, '15_inventory_ledger');
  await wm.close();

  // ------------------------------------------------------------ volunteer
  const vol = await session('vol_asha');
  await go(vol, '#/shipments');
  await evalIn(vol, () => {
    const transit = [...document.querySelectorAll('.ship-card')].find((c) => c.innerText.includes('In transit') && c.querySelector('[data-action=claim]'));
    transit.querySelector('[data-action=claim]').click();
  });
  await sleep(1600);
  await evalIn(vol, () => {
    const t = [...document.querySelectorAll('.ship-card')].find((c) => c.innerText.includes('In transit') && c.querySelector('[data-action=deliver]'));
    t.querySelector('[data-action=deliver]').click();
  });
  await sleep(900);
  await evalIn(vol, () => {
    const inputs = [...document.querySelectorAll('#deliver-form input[type=number]')];
    inputs[0].value = Math.max(0, Number(inputs[0].max) - 3);
    document.querySelector('#deliver-form [name=note]').value = 'Some units damaged by water in transit';
  });
  await shot(vol, '16_delivery_dialog');
  await evalIn(vol, () => document.querySelector('.modal button[type=submit]').click());
  await sleep(1800);
  await shot(vol, '17_volunteer_shipments');
  await vol.close();

  // ------------------------------------------------------------ coordinator
  const co = await session('coord_thalaignayar');
  await go(co, '#/requests');
  await evalIn(co, () => document.querySelector('[data-action=new]').click());
  await sleep(900);
  await evalIn(co, () => {
    document.querySelector('#urg input[value="3"]').checked = true;
    document.querySelector('#req-form [name=notes]').value = 'Cold snap overnight; blankets and drinking water needed';
    const sel = document.querySelector('#lines [name=item]');
    [...sel.options].forEach((o) => { if (o.textContent.includes('Blankets')) sel.value = o.value; });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#lines [name=qty]').value = '300';
    document.querySelector('#add-line').click();
    const s2 = document.querySelectorAll('#lines [name=item]')[1];
    [...s2.options].forEach((o) => { if (o.textContent.includes('Packaged')) s2.value = o.value; });
    s2.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelectorAll('#lines [name=qty]')[1].value = '40000';
  });
  await sleep(300);
  await shot(co, '18_new_request_dialog');
  await evalIn(co, () => document.querySelector('.modal button[type=submit]').click());
  await sleep(2000);
  await shot(co, '19_request_capped');

  await go(co, '#/distribution');
  await evalIn(co, () => document.querySelector('[data-action=record]').click());
  await sleep(700);
  await evalIn(co, () => { document.querySelector('#f_quantity').value = '999999'; document.querySelector('#f_peopleServed').value = '100'; document.querySelector('.modal button[type=submit]').click(); });
  await sleep(900);
  await shot(co, '20_distribution_refused');
  await co.close();

  // ------------------------------------------------------------ admin again: remaining pages
  const a2 = await session('admin');
  await go(a2, '#/camps');
  await shot(a2, '21_camps');
  await go(a2, '#/camps/9');
  await shot(a2, '22_camp_detail');
  await go(a2, '#/inventory');
  await evalIn(a2, () => document.querySelector('[data-wh="2"]').click());
  await sleep(500);
  await shot(a2, '23_inventory');
  await go(a2, '#/analytics', 2200);
  await shot(a2, '24_analytics');
  await evalIn(a2, () => window.scrollTo(0, 820));
  await sleep(500);
  await shot(a2, '24b_analytics_lower');
  await go(a2, '#/admin');
  await shot(a2, '25_admin_users');
  await evalIn(a2, () => document.querySelector('[data-tab=settings]').click());
  await sleep(1200);
  await shot(a2, '26_admin_settings');
  await evalIn(a2, () => document.querySelector('[data-tab=audit]').click());
  await sleep(1200);
  await shot(a2, '27_admin_audit');
  await evalIn(a2, () => document.querySelector('[data-tab=integrity]').click());
  await sleep(1200);
  await shot(a2, '28_admin_integrity');
  await a2.close();

  // ------------------------------------------------------------ mobile
  const mob = await session('admin', { width: 390, height: 844, scale: 2 });
  await go(mob, '#/dashboard', 2200);
  await shot(mob, '29_mobile_dashboard');
  await evalIn(mob, () => document.querySelector('#menu-btn').click());
  await sleep(500);
  await shot(mob, '30_mobile_navigation');
  await mob.close();
} finally {
  await browser.close();
}
