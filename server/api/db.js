// Dashboard storage: one SQLite file in server/data/ holding the innkeeper configs
// (`properties`). The `sessions` table in the same file is written by the log_session
// tool (server/lib/sessions.js); the dashboard only reads it, and reads it defensively,
// because a fresh install has no sessions table until the first call is logged.

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entityIdsFromTrace, labelIds } from '../lib/fingerprint.js';
import { tonightEnds } from '../tools/events-nearby.js';
import { ROAMING_PROPERTY_ID } from '../tools/log-session.js';

export const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/concierge.sqlite', import.meta.url));
export const DEMO_CONFIG_PATH = fileURLToPath(new URL('../../config/examples/demo-inn.json', import.meta.url));
export const DEMO_PROPERTY_ID = 'demo';
/** The Miami rental demo, an Airbnb-style stay with a stay sheet: seeded beside the demo inn. */
export const RENTAL_DEMO_CONFIG_PATH = fileURLToPath(new URL('../../config/examples/miami-rental.json', import.meta.url));
export const RENTAL_DEMO_PROPERTY_ID = 'miami';
/**
 * The built-in property any-city calls with no inn are filed under (tools/log-session.js): the
 * road line. Seeded from its example config when the repo has one, else from ROAMING_FALLBACK.
 */
export const ROAMING_CONFIG_PATH = fileURLToPath(new URL('../../config/examples/road-line.json', import.meta.url));
/** A road line with no fixed place: no address, no coordinates, only a clock to fall back on. */
export const ROAMING_FALLBACK = Object.freeze({
  schema_version: 1,
  property: { id: 'road', name: 'Bellhop', timezone: 'America/New_York' },
});
export { ROAMING_PROPERTY_ID };
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
  seedRoaming(db, now);
  seedRentalDemo(db, now);
  return db;
}

/** Insert the Miami rental demo as property `miami` if it is not there yet. Never overwrites. */
export function seedRentalDemo(db, now = () => new Date()) {
  if (!existsSync(RENTAL_DEMO_CONFIG_PATH)) return;
  const config = readFileSync(RENTAL_DEMO_CONFIG_PATH, 'utf8');
  if (JSON.parse(config).property?.id !== RENTAL_DEMO_PROPERTY_ID) throw new Error(`${RENTAL_DEMO_CONFIG_PATH} must have property.id ${RENTAL_DEMO_PROPERTY_ID}`);
  db.prepare(`INSERT OR IGNORE INTO properties (id, config_json, status, updated_at) VALUES (?, ?, 'draft', ?)`)
    .run(RENTAL_DEMO_PROPERTY_ID, config, now().toISOString());
}

/** Insert the demo inn as property `demo` if it is not there yet. Never overwrites. */
export function seedDemo(db, now = () => new Date()) {
  const config = readFileSync(DEMO_CONFIG_PATH, 'utf8');
  JSON.parse(config); // fail loudly on a broken example rather than seeding junk
  db.prepare(`INSERT OR IGNORE INTO properties (id, config_json, status, updated_at) VALUES (?, ?, 'draft', ?)`)
    .run(DEMO_PROPERTY_ID, config, now().toISOString());
}

/**
 * Insert the road line as property `road` if it is not there yet. Never overwrites. It has no
 * coordinates: every call it files named a city.
 */
export function seedRoaming(db, now = () => new Date()) {
  const config = existsSync(ROAMING_CONFIG_PATH) ? readFileSync(ROAMING_CONFIG_PATH, 'utf8') : JSON.stringify(ROAMING_FALLBACK);
  if (JSON.parse(config).property?.id !== ROAMING_PROPERTY_ID) throw new Error(`${ROAMING_CONFIG_PATH} must have property.id ${ROAMING_PROPERTY_ID}`);
  db.prepare(`INSERT OR IGNORE INTO properties (id, config_json, status, updated_at) VALUES (?, ?, 'draft', ?)`)
    .run(ROAMING_PROPERTY_ID, config, now().toISOString());
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

const DAY_MS = 86_400_000;
const localDay = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** The zone's offset from UTC at an instant, in ms (local wall time read as UTC, minus the instant). */
function zoneOffset(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - Math.floor(d.getTime() / 1000) * 1000;
}
/** Ticketmaster's date format: seconds, no milliseconds. */
const tmDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The sample call as of `now`: the same call, moved to the day the page is viewed so its
 * events always read as tonight. The call keeps its local time of day (early evening) when
 * that time has passed, and otherwise sits a few minutes before `now`. The Ticketmaster
 * window is then rebuilt by the same "tonight" rule events_nearby uses: from the call to
 * 4 am the morning after the call's calendar day.
 * @param {Date} now @param {string} tz IANA zone of the inn
 */
export function sampleSessionAt(now, tz) {
  const base = loadSampleSession();
  if (!base) return null;
  const stored = new Date(base.started_at);
  if (Number.isNaN(stored.getTime())) return base;
  const days = Math.round((Date.parse(`${localDay(now, tz)}T12:00:00Z`) - Date.parse(`${localDay(stored, tz)}T12:00:00Z`)) / DAY_MS);
  const shifted = new Date(stored.getTime() + days * DAY_MS);
  // Same wall-clock time across a clock change.
  const moved = new Date(shifted.getTime() + zoneOffset(stored, tz) - zoneOffset(shifted, tz));
  const start = moved <= now ? moved : new Date(now.getTime() - 5 * 60_000);
  const end = tonightEnds(start, tz);
  const trace = (base.trace ?? []).map((e) => (e.source === 'ticketmaster' && e.params?.startDateTime
    ? { ...e, params: { ...e.params, startDateTime: tmDate(start), endDateTime: tmDate(end) } }
    : e));
  return { ...base, started_at: start.toISOString(), trace };
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
