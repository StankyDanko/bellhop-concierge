// Response cache (better-sqlite3). Keyed by a normalized request, TTL per endpoint.
//
// Qloo's hackathon terms allow private server-side caching with no time limit but
// forbid storing response data in a public repository. The database therefore lives
// in server/data/, which is gitignored; nothing it holds is ever committed.
//
// CACHE_ONLY=1 serves whatever is cached (expired or not) and never calls upstream,
// so the demo keeps working after the hackathon key is deactivated.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Seconds a cached response stays fresh, per logical endpoint. */
export const TTL_SECONDS = {
  'qloo:/search': 30 * DAY,         // names -> ids barely move
  'qloo:/v2/tags': 30 * DAY,
  'qloo:/v2/insights': 1 * DAY,     // place recs: refresh daily (hours, closures)
  'qloo:/v2/analysis/compare': 7 * DAY,
  'ticketmaster:/events.json': 1 * HOUR,
};
const DEFAULT_TTL = 1 * DAY;

/**
 * Stable cache key: service + endpoint + params sorted by name.
 * @param {string} service @param {string} endpoint @param {Record<string,string>} params
 */
export function cacheKey(service, endpoint, params) {
  const sorted = Object.keys(params).sort().map((k) => [k, String(params[k])]);
  return createHash('sha256').update(JSON.stringify([service, endpoint, sorted])).digest('hex');
}

export class ResponseCache {
  /** @param {{ path: string, only?: boolean, now?: () => number }} opts */
  constructor({ path, only = false, now = () => Math.floor(Date.now() / 1000) }) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.only = only;
    this.now = now;
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS responses (
        key        TEXT PRIMARY KEY,
        service    TEXT NOT NULL,
        endpoint   TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS responses_expiry ON responses (expires_at);
    `);
    this.getStmt = this.db.prepare('SELECT body, expires_at FROM responses WHERE key = ?');
    this.putStmt = this.db.prepare(`
      INSERT INTO responses (key, service, endpoint, body, created_at, expires_at)
      VALUES (@key, @service, @endpoint, @body, @created_at, @expires_at)
      ON CONFLICT(key) DO UPDATE SET body = excluded.body,
        created_at = excluded.created_at, expires_at = excluded.expires_at
    `);
  }

  /**
   * Cached body, or undefined. In cache-only mode expired rows still count.
   * @param {string} key @returns {unknown | undefined}
   */
  get(key) {
    const row = /** @type {{ body: string, expires_at: number } | undefined} */ (this.getStmt.get(key));
    if (!row) return undefined;
    if (!this.only && row.expires_at <= this.now()) return undefined;
    return JSON.parse(row.body);
  }

  /** @param {string} key @param {string} service @param {string} endpoint @param {unknown} body */
  put(key, service, endpoint, body) {
    const now = this.now();
    const ttl = TTL_SECONDS[`${service}:${endpoint}`] ?? DEFAULT_TTL;
    this.putStmt.run({ key, service, endpoint, body: JSON.stringify(body), created_at: now, expires_at: now + ttl });
  }

  close() {
    this.db.close();
  }
}
