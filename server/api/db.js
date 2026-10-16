// Dashboard storage: one SQLite file in server/data/ holding the host configs
// (`properties`). The `sessions` table in the same file is written by the log_session
// tool (server/lib/sessions.js); the dashboard only reads it, and reads it defensively,
// because a fresh install has no sessions table until the first call is logged.

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entityIdsFromTrace, labelIds } from '../lib/fingerprint.js';

export const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/concierge.sqlite', import.meta.url));
export const DEMO_CONFIG_PATH = fileURLToPath(new URL('../../config/examples/demo-inn.json', import.meta.url));
export const DEMO_PROPERTY_ID = 'demo';
export const SAMPLE_SESSION_PATH = fileURLToPath(new URL('../fixtures/sample-session.json', import.meta.url));

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

let sampleSession;
/**
 * The hand-made sample call shown on every property page until real calls exist, so the
 * Qloo call trace is visible on day one. Built from mock fixtures, never from a Qloo response.
 * Returns null if the file is missing or broken (the page simply shows no sample).
 */
export function loadSampleSession() {
  if (sampleSession === undefined) {
    try {
      const raw = JSON.parse(readFileSync(SAMPLE_SESSION_PATH, 'utf8'));
      const { _note, ...session } = raw;
      sampleSession = { ...session, sample: true };
    } catch {
      sampleSession = null;
    }
  }
  return sampleSession;
}

export const SAMPLE_CALLERS_PATH = fileURLToPath(new URL('../fixtures/fingerprint.sample-callers.json', import.meta.url));

let sampleFingerprint;
/**
 * The sessions behind the SAMPLE guest taste fingerprint: the sample call above (its ids
 * read from its own trace, exactly as log_session reads a real call) plus a few hand-made
 * fictional callers. Ids and taste names only. Returns [] if a file is missing or broken.
 * @returns {Array<{ ids: string[], labels: Record<string, string|null> }>}
 */
export function loadSampleFingerprintSessions() {
  if (sampleFingerprint === undefined) {
    try {
      const out = [];
      const call = loadSampleSession();
      if (call) {
        const ids = entityIdsFromTrace(call.trace);
        out.push({ ids, labels: labelIds({ ids, trace: call.trace, names: call.entities ?? [] }) });
      }
      const { callers } = JSON.parse(readFileSync(SAMPLE_CALLERS_PATH, 'utf8'));
      for (const c of callers) {
        const tastes = (c.tastes ?? []).filter((t) => typeof t?.id === 'string');
        out.push({ ids: tastes.map((t) => t.id), labels: Object.fromEntries(tastes.map((t) => [t.id, t.name ?? null])) });
      }
      sampleFingerprint = out;
    } catch {
      sampleFingerprint = [];
    }
  }
  return sampleFingerprint;
}
