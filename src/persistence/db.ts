import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database, { type Database as BetterDb } from 'better-sqlite3';

import { getAppConfig } from '../config/app-config.js';
import { getLogger } from '../core/logger/logger.js';

const log = getLogger('db');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, 'migrations');

let dbInstance: BetterDb | undefined;

function ensureSchemaTracking(db: BetterDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    );
  `);
}

function applyMigrations(db: BetterDb): void {
  ensureSchemaTracking(db);
  const applied = new Set(
    (db.prepare('SELECT filename FROM schema_migrations').all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );

  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    log.warn({ err }, 'no migrations directory found');
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    log.info({ file }, 'applying migration');
    const previousForeignKeys = db.pragma('foreign_keys', { simple: true }) as number;
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)').run(
          file,
          Date.now(),
        );
      });
      tx();
    } finally {
      db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    }
  }
}

export function getDb(): BetterDb {
  if (dbInstance) return dbInstance;
  const cfg = getAppConfig();
  mkdirSync(dirname(cfg.DB_PATH), { recursive: true });
  const db = new Database(cfg.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  dbInstance = db;
  log.info({ path: cfg.DB_PATH }, 'sqlite ready');
  return db;
}

/** Test/CLI helper: open an arbitrary path (does not cache). */
export function openDbAt(path: string): BetterDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = undefined;
  }
}
