// Response cache (better-sqlite3). Keyed by a normalized request, TTL per endpoint.
//
// Qloo's hackathon terms allow private server-side caching with no time limit but
// forbid storing response data in a public repository. The database therefore lives
// in server/data/, which is gitignored; nothing it holds is ever committed.
//
// CACHE_ONLY=1 serves whatever is cached (expired or not) and never calls upstream,
// so the demo keeps working after the hackathon key is deactivated. CACHE_FREEZE=1 is the
// same behavior under the name the dark period uses; /health then reports cache: 'frozen'.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
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

/**
 * Why a file cannot serve as a frozen cache, or null when it can: it must exist and hold at
 * least one cached response. Opened read-only, so checking never changes it.
 * @param {string} path @returns {string | null}
 */
export function frozenCacheProblem(path) {
  if (!path || !existsSync(path)) return `no cache file at ${path}`;
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM responses').get();
    return n > 0 ? null : `the cache at ${path} holds no responses`;
  } catch (err) {
    return `the cache at ${path} cannot be read: ${String(err?.message ?? err)}`;
  } finally {
    db?.close();
  }
}

export class ResponseCache {
  /** @param {{ path: string, only?: boolean, frozen?: boolean, now?: () => number }} opts */
  constructor({ path, only = false, frozen = false, now = () => Math.floor(Date.now() / 1000) }) {
    this.frozen = frozen;
    this.only = only || frozen;
    this.now = now;
    if (frozen && path !== ':memory:') {
      // Frozen serves a prewarmed file as it is: it must exist and hold responses (a wrong path
      // must not quietly create an empty cache that misses everything), and it is opened
      // read-only, so nothing is written next to it or into it.
      const problem = frozenCacheProblem(path);
      if (problem) throw new Error(`CACHE_FREEZE is set, but ${problem}`);
      this.db = new Database(path, { readonly: true, fileMustExist: true });
      this.getStmt = this.db.prepare('SELECT body, expires_at FROM responses WHERE key = ?');
      this.putStmt = null;
      return;
    }
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
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

  /**
   * Cached body regardless of age, or undefined. Used when upstream cannot answer (rate limit,
   * deactivated key): an old answer beats no answer.
   * @param {string} key @returns {unknown | undefined}
   */
  getStale(key) {
    const row = /** @type {{ body: string } | undefined} */ (this.getStmt.get(key));
    return row ? JSON.parse(row.body) : undefined;
  }

  /** @param {string} key @param {string} service @param {string} endpoint @param {unknown} body */
  put(key, service, endpoint, body) {
    if (!this.putStmt) return; // a frozen file cache is read-only
    const now = this.now();
    const ttl = TTL_SECONDS[`${service}:${endpoint}`] ?? DEFAULT_TTL;
    this.putStmt.run({ key, service, endpoint, body: JSON.stringify(body), created_at: now, expires_at: now + ttl });
  }

  close() {
    this.db.close();
  }
}
