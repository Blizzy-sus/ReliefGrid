import { openDb, migrate, DEFAULT_DB_PATH } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const db = openDb();
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

const hasData = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
if (!hasData) console.warn('The database is empty. Run "npm run seed" to load the demo scenario.');

const app = createApp(db);
const server = app.listen(port, () => {
  console.log(`ReliefGrid running at http://localhost:${port}  (database: ${DEFAULT_DB_PATH})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { db.close(); process.exit(0); }); });
}
