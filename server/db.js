import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from './config.js';
import { MIGRATIONS } from './migrations/index.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/**
 * Runs `fn` inside an IMMEDIATE transaction so a read-modify-write of balances
 * or a status transition cannot interleave with another writer. SQLite takes a
 * write lock up front, which is what makes "check balance, then debit" atomic.
 */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Already rolled back, e.g. by an integrity error.
    }
    throw err;
  }
}

export function isUniqueViolation(err) {
  return /UNIQUE constraint failed/i.test(`${err?.code ?? ''} ${err?.message ?? ''}`);
}

function legacyBaselineVersion() {
  // A database written by the pre-migration app has the v1 tables but no
  // history row; that schema matches migration 1, so record it as applied.
  const hasCreators = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='creators'`).get();
  const hasHistory = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n > 0;
  return hasCreators && !hasHistory ? 1 : 0;
}

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const baseline = legacyBaselineVersion();
  if (baseline) {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(baseline, 'legacy-v1-baseline');
  }

  const current = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v ?? 0;
  const applied = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    // Table-rebuild migrations drop referenced tables, which only works while
    // foreign-key enforcement is off. PRAGMA is a no-op inside a transaction,
    // so it is flipped around the run and integrity verified afterwards.
    if (migration.rebuildsTables) db.exec('PRAGMA foreign_keys = OFF');
    transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    });
    if (migration.rebuildsTables) {
      db.exec('PRAGMA foreign_keys = ON');
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) {
        throw new Error(`Migration ${migration.version} left foreign-key violations: ${JSON.stringify(violations)}`);
      }
    }
    applied.push(`#${migration.version} ${migration.name}`);
  }
  return { from: current, to: Math.max(current, ...MIGRATIONS.map((m) => m.version)), applied };
}

export { config };
export default db;
