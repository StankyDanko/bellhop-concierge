// Session log (better-sqlite3): one row per guest call, written by the log_session tool at
// the end of a call and read by the host dashboard.
//
// Nothing in a row identifies a guest. The caller's number is stored ONLY as an
// HMAC-SHA256 keyed by CONCIERGE_TOOL_SECRET, so repeat callers can be counted without the
// number ever being written down. No names, no transcripts, no message bodies.

import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SESSIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    property_id   TEXT,
    persona       TEXT,
    started_at    TEXT,
    caller_hash   TEXT,
    entities_json TEXT,
    picks_count   INTEGER,
    events_count  INTEGER,
    sms_sent      INTEGER,
    created_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_property_started ON sessions (property_id, started_at);
`;

// Call trace: one row per tool invocation, keyed by the platform's conversation id (the same
// id log_session writes as sessions.id). Each row holds the upstream requests that tool made
// (endpoint, the pii-guarded params, mock/live, cache, ms, result count) and, for
// recommend_nearby, the counterfactual. Never a caller number, caller hash, name, or SMS body:
// only tools that call Qloo or Ticketmaster produce entries, and those params pass the PII guard.
export const TRACES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS session_traces (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          TEXT NOT NULL,
    tool                TEXT NOT NULL,
    trace_json          TEXT NOT NULL,
    counterfactual_json TEXT,
    created_at          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS session_traces_session ON session_traces (session_id, seq);
`;
/** Rows kept per session; a runaway agent loop cannot grow the table without bound. */
export const MAX_TRACE_ROWS_PER_SESSION = 40;

const SESSION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * The session id a tool call carries, or null. An unfilled platform variable arrives empty
 * or as its own {{name}}; both mean "no session" (same rule as log_session).
 * @param {any} body
 */
export function sessionIdFrom(body) {
  const v = body?.session_id;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^\{\{.*\}\}$/.test(t) || !SESSION_ID.test(t)) return null;
  return t;
}

/** Add a column if an older database lacks it (existing DBs keep working). */
function addColumnIfMissing(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** @param {import('better-sqlite3').Database} db */
export function hasTracesTable(db) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_traces'`).get());
}

/**
 * Read one session's trace, numbered in call order across tools, plus the last
 * counterfactual. Works on any handle to the sessions database (the dashboard reads it).
 * @param {import('better-sqlite3').Database} db @param {string} sessionId
 * @returns {{ trace: Array<Record<string, unknown>>, counterfactual: object|null }}
 */
export function readTrace(db, sessionId) {
  if (!sessionId || !hasTracesTable(db)) return { trace: [], counterfactual: null };
  const rows = db.prepare('SELECT tool, trace_json, counterfactual_json FROM session_traces WHERE session_id = ? ORDER BY seq').all(sessionId);
  const trace = [];
  let counterfactual = null;
  for (const r of rows) {
    let entries = [];
    try { entries = JSON.parse(r.trace_json); } catch { entries = []; }
    for (const e of Array.isArray(entries) ? entries : []) trace.push({ ...e, n: trace.length + 1, tool: r.tool });
    if (r.counterfactual_json) {
      try { counterfactual = JSON.parse(r.counterfactual_json); } catch { /* keep the previous one */ }
    }
  }
  return { trace, counterfactual };
}

/** @param {string} callerId @param {string} key */
export function hashCaller(callerId, key) {
  if (!key) throw new Error('hashCaller needs a key');
  return createHmac('sha256', key).update(callerId, 'utf8').digest('hex');
}

/**
 * @typedef {object} SessionRow
 * @property {string} id
 * @property {string|null} property_id
 * @property {string|null} persona
 * @property {string} started_at
 * @property {string|null} caller_hash
 * @property {string[]} entities
 * @property {number} picks_count
 * @property {number} events_count
 * @property {boolean} sms_sent
 */

export class SessionStore {
  /** @param {{ path: string, hashKey: string, now?: () => Date }} opts */
  constructor({ path, hashKey, now = () => new Date() }) {
    if (!hashKey) throw new Error('SessionStore needs a hash key');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.hashKey = hashKey;
    this.now = now;
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SESSIONS_SCHEMA);
    this.db.exec(TRACES_SCHEMA);
    addColumnIfMissing(this.db, 'sessions', 'trace_count', 'INTEGER');
    // Upsert: an agent that calls log_session twice for one call updates its row.
    // created_at keeps the first write's time.
    this.upsert = this.db.prepare(`
      INSERT INTO sessions (id, property_id, persona, started_at, caller_hash, entities_json, picks_count, events_count, sms_sent, created_at, trace_count)
      VALUES (@id, @property_id, @persona, @started_at, @caller_hash, @entities_json, @picks_count, @events_count, @sms_sent, @created_at, @trace_count)
      ON CONFLICT(id) DO UPDATE SET
        property_id = excluded.property_id, persona = excluded.persona, started_at = excluded.started_at,
        caller_hash = excluded.caller_hash, entities_json = excluded.entities_json, picks_count = excluded.picks_count,
        events_count = excluded.events_count, sms_sent = excluded.sms_sent, trace_count = excluded.trace_count
    `);
    this.insertTrace = this.db.prepare(`
      INSERT INTO session_traces (session_id, tool, trace_json, counterfactual_json, created_at)
      SELECT @session_id, @tool, @trace_json, @counterfactual_json, @created_at
      WHERE (SELECT COUNT(*) FROM session_traces WHERE session_id = @session_id) < ${MAX_TRACE_ROWS_PER_SESSION}
    `);
  }

  /**
   * @param {{ id: string, property_id?: string|null, persona?: string|null, started_at: string, caller_id?: string|null,
   *           entities: string[], picks_count: number, events_count: number, sms_sent: boolean }} s
   */
  write(s) {
    const row = {
      id: s.id,
      property_id: s.property_id ?? null,
      persona: s.persona ?? null,
      started_at: s.started_at,
      caller_hash: s.caller_id ? hashCaller(s.caller_id, this.hashKey) : null,
      entities_json: JSON.stringify(s.entities),
      picks_count: s.picks_count,
      events_count: s.events_count,
      sms_sent: s.sms_sent ? 1 : 0,
      created_at: this.now().toISOString(),
      // Links the row to its call trace: how many upstream requests were recorded under this id.
      trace_count: readTrace(this.db, s.id).trace.length,
    };
    this.upsert.run(row);
    return row;
  }

  /**
   * Record the upstream trace of one tool invocation under a session id.
   * @param {string} sessionId @param {string} tool
   * @param {Array<object>} trace  entries from withTrace() (server/lib/upstream.js)
   * @param {object|null} [counterfactual]
   * @returns {boolean} whether a row was written
   */
  writeTrace(sessionId, tool, trace, counterfactual = null) {
    if (!sessionId || (!trace?.length && !counterfactual)) return false;
    const info = this.insertTrace.run({
      session_id: sessionId,
      tool,
      trace_json: JSON.stringify(trace ?? []),
      counterfactual_json: counterfactual ? JSON.stringify(counterfactual) : null,
      created_at: this.now().toISOString(),
    });
    return info.changes > 0;
  }

  /** @param {string} sessionId */
  trace(sessionId) {
    return readTrace(this.db, sessionId);
  }

  /** @param {string} id */
  get(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  }

  close() {
    this.db.close();
  }
}
