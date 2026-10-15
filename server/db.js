import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
export const DEFAULT_DB_PATH = process.env.RELIEFGRID_DB || path.join(ROOT, 'data', 'reliefgrid.db');

/** Open a connection with the pragmas every ReliefGrid connection must have. */
export function openDb(file = DEFAULT_DB_PATH, { busyTimeoutMs = 5000 } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${Number(busyTimeoutMs)};`);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  return db;
}

/** Apply any migration files that have not been applied yet. Returns the list applied. */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Map(db.prepare('SELECT version, checksum FROM schema_migrations').all().map((r) => [r.version, r.checksum]));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)')
        .run(file, checksum, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
    done.push(file);
  }
  return done;
}

const depth = new WeakMap();

/**
 * Run `fn` inside a write transaction.  BEGIN IMMEDIATE takes the database write lock up
 * front, so every read inside the transaction sees a snapshot that nobody else can change
 * before we commit.  This is what makes allocate-then-reserve safe.
 * Nested calls join the outer transaction.
 */
export function tx(db, fn) {
  const level = depth.get(db) || 0;
  if (level > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    depth.set(db, 0);
  }
}

/** Error carrying an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Translate low-level SQLite errors into meaningful HTTP errors. */
export function translateDbError(err) {
  if (err instanceof HttpError) return err;
  const msg = String(err?.message || '');
  if (/UNIQUE constraint failed/.test(msg)) return new HttpError(409, 'DUPLICATE', 'A record with these values already exists.', msg);
  if (/FOREIGN KEY constraint failed/.test(msg)) return new HttpError(409, 'REFERENCE_ERROR', 'The record refers to something that does not exist, or is still in use.', msg);
  if (/CHECK constraint failed/.test(msg)) return new HttpError(409, 'CONSTRAINT_VIOLATION', 'The change violates a data integrity rule.', msg);
  if (/NOT NULL constraint failed/.test(msg)) return new HttpError(400, 'MISSING_FIELD', 'A required value is missing.', msg);
  if (/append-only|immutable|invalid shipment status|only be recorded|cannot create requests|cannot change urgency|cannot delete an inventory|distribution exceeds/.test(msg)) {
    return new HttpError(409, 'RULE_VIOLATION', msg.replace(/^.*?:\s*/, ''), msg);
  }
  if (/database is locked|SQLITE_BUSY/.test(msg)) return new HttpError(503, 'BUSY', 'The database is busy, please retry.', msg);
  return err;
}
