/**
 * Runs the showcase queries in db/queries.sql against the demo database and prints the results.
 *   node --disable-warning=ExperimentalWarning scripts/run-queries.js [q05] [--limit 8]
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, ROOT, DEFAULT_DB_PATH } from '../server/db.js';

export function loadQueries(file = path.join(ROOT, 'db', 'queries.sql')) {
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.split(/^-- name: /m).slice(1);
  return blocks.map((b) => {
    const [first, ...rest] = b.split('\n');
    const lines = rest.join('\n');
    const description = lines.split('\n').filter((l) => l.startsWith('--')).map((l) => l.replace(/^--\s?/, '')).join(' ').trim();
    const sql = lines.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim().replace(/;\s*$/, '');
    return { name: first.trim(), description, sql };
  });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 8;
  const filter = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit');
  const db = openDb(DEFAULT_DB_PATH);
  for (const q of loadQueries().filter((x) => !filter.length || filter.some((f) => x.name.startsWith(f)))) {
    const rows = db.prepare(q.sql).all();
    console.log(`\n=== ${q.name} (${rows.length} rows) ===\n${q.description}`);
    console.table(rows.slice(0, limit).map((r) => ({ ...r })));
  }
  db.close();
}
