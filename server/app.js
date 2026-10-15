import express from 'express';
import path from 'node:path';
import { ROOT, HttpError, translateDbError } from './db.js';
import { authenticate, createLoginLimiter, login, logout } from './auth.js';
import { masterRoutes } from './routes/master.js';
import { opsRoutes } from './routes/ops.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo.js';

/**
 * Build the Express app around an open database.
 * `clock` lets seeding and tests inject the current time; it returns a Date (or nothing for "now").
 */
export function createApp(db, { clock = () => undefined, serveStatic = true, quiet = false, demoHints = process.env.NODE_ENV !== 'production' } = {}) {
  const app = express();
  const at = () => clock();
  const limiter = createLoginLimiter();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();

  api.post('/auth/login', (req, res) => {
    const username = String(req.body?.username || '');
    const key = `${req.ip}|${username.toLowerCase()}`;
    limiter.check(key);
    try {
      const out = login(db, username, req.body?.password, at());
      limiter.reset(key);
      res.json(out);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) limiter.fail(key);
      throw err;
    }
  });

  // Sign-in shortcuts for the seeded demo accounts (local development only; off when NODE_ENV=production).
  api.get('/auth/demo-accounts', (_req, res) => {
    const present = demoHints
      ? DEMO_ACCOUNTS.filter((a) => db.prepare('SELECT 1 FROM users WHERE username = ?').get(a.username))
      : [];
    res.json(present.length ? { enabled: true, password: DEMO_PASSWORD, accounts: present } : { enabled: false });
  });

  api.use(authenticate(db, at));
  api.post('/auth/logout', (req, res) => { logout(db, req.token); res.json({ ok: true }); });
  api.get('/auth/me', (req, res) => res.json(req.user));
  api.use(masterRoutes({ db, at }));
  api.use(opsRoutes({ db, at }));
  api.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'No such API endpoint.')));
  app.use('/api', api);

  if (serveStatic) app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') err = new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON.');
    const e = translateDbError(err);
    if (e instanceof HttpError) {
      return res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.status < 500 && e.details && e.code === 'VALIDATION' ? { details: e.details } : {}) } });
    }
    if (!quiet) console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  });

  return app;
}
