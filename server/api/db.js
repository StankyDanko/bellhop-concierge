// Dashboard storage: one SQLite file in server/data/ holding the host configs
// (`properties`). The `sessions` table in the same file is written by the log_session
// tool (server/lib/sessions.js); the dashboard only reads it, and reads it defensively,
// because a fresh install has no sessions table until the first call is logged.

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/concierge.sqlite', import.meta.url));
export const DEMO_CONFIG_PATH = fileURLToPath(new URL('../../config/examples/demo-inn.json', import.meta.url));
export const DEMO_PROPERTY_ID = 'demo';

const PROPERTIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS properties (
    id           TEXT PRIMARY KEY,
    config_json  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft',
    updated_at   TEXT NOT NULL,
    published_at TEXT
  );
`;

/**
 * Open (or create) the dashboard database and seed the demo inn on first run.
 * @param {{ path?: string, now?: () => Date }} [opts]
 */
export function openDashboardDb({ path = DEFAULT_DB_PATH, now = () => new Date() } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 2000');
  db.exec(PROPERTIES_SCHEMA);
  seedDemo(db, now);
  return db;
}

/** Insert the demo inn as property `demo` if it is not there yet. Never overwrites. */
export function seedDemo(db, now = () => new Date()) {
  const config = readFileSync(DEMO_CONFIG_PATH, 'utf8');
  JSON.parse(config); // fail loudly on a broken example rather than seeding junk
  db.prepare(`INSERT OR IGNORE INTO properties (id, config_json, status, updated_at) VALUES (?, ?, 'draft', ?)`)
    .run(DEMO_PROPERTY_ID, config, now().toISOString());
}

/** @param {import('better-sqlite3').Database} db */
export function hasSessionsTable(db) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'`).get());
}
