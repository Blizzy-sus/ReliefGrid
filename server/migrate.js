import { openDb, migrate, DEFAULT_DB_PATH } from './db.js';

const db = openDb();
const applied = migrate(db);
console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date.');
console.log(`Database: ${DEFAULT_DB_PATH}`);
db.close();
