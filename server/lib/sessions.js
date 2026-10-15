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
    // Upsert: an agent that calls log_session twice for one call updates its row.
    // created_at keeps the first write's time.
    this.upsert = this.db.prepare(`
      INSERT INTO sessions (id, property_id, persona, started_at, caller_hash, entities_json, picks_count, events_count, sms_sent, created_at)
      VALUES (@id, @property_id, @persona, @started_at, @caller_hash, @entities_json, @picks_count, @events_count, @sms_sent, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        property_id = excluded.property_id, persona = excluded.persona, started_at = excluded.started_at,
        caller_hash = excluded.caller_hash, entities_json = excluded.entities_json, picks_count = excluded.picks_count,
        events_count = excluded.events_count, sms_sent = excluded.sms_sent
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
    };
    this.upsert.run(row);
    return row;
  }

  /** @param {string} id */
  get(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  }

  close() {
    this.db.close();
  }
}
