import Database, { type Database as BetterDb } from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dashboard SQLite access — strictly read-only.
 *
 * The dashboard never writes; we open the same file the scanner + paper
 * simulator write to (`data/market_inefficiency_observatory.sqlite` at the
 * repo root). The path is resolved relative to the dashboard's CWD, with a
 * `DASHBOARD_DB_PATH` env override for non-standard layouts.
 */

let cached: BetterDb | undefined;
let cachedPath: string | undefined;

function resolveDbPath(): string {
  const override = process.env.DASHBOARD_DB_PATH;
  if (override && override.trim().length > 0) return resolve(override);
  // Default: dashboard is at <repo>/dashboard, DB is at <repo>/data/...
  return resolve(process.cwd(), '..', 'data', 'market_inefficiency_observatory.sqlite');
}

export interface DbHandle {
  db: BetterDb;
  path: string;
  exists: boolean;
}

export function getDb(): DbHandle {
  const path = resolveDbPath();
  if (cached && cachedPath === path) {
    return { db: cached, path, exists: existsSync(path) };
  }
  if (cached) {
    try {
      cached.close();
    } catch {
      /* noop */
    }
    cached = undefined;
  }
  const exists = existsSync(path);
  // `better-sqlite3` will throw if the file is missing; open in readonly mode
  // even for the writeable file so we can never accidentally mutate state.
  const db = new Database(path, { readonly: true, fileMustExist: false });
  db.pragma('journal_mode = WAL');
  cached = db;
  cachedPath = path;
  return { db, path, exists };
}

/** Best-effort detection that the paper-simulator migration has been applied. */
export function hasPaperSimulatorSchema(db: BetterDb): boolean {
  try {
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='paper_simulation_runs'`,
      )
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}
