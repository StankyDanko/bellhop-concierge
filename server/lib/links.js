// Short links for the text: https://concierge.southernsky.cloud/go/<token>.
//
// A text has room for a few words per pick, and a place's own website or a maps search runs two
// hundred characters or more. Each link in the text is a short one on this server instead. The
// token is stored with its target in the session database (no caller, no call id, nothing but
// the target and two dates), the route /go/<token> answers a 302 to the target, and a token
// older than LINK_TTL_DAYS or never issued answers 404.
//
// The token is the first 8 characters of an HMAC of the target keyed by CONCIERGE_TOOL_SECRET:
// the same target always gets the same token (a repeat is one row, its expiry pushed out), and
// a token cannot be guessed from the target or counted up from another. Only https targets are
// ever stored, so the redirect cannot send a guest to a plain-http or script address.

import { createHmac, randomBytes } from 'node:crypto';

export const LINK_TTL_DAYS = 30;
export const TOKEN_CHARS = 8;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8}$/;
/** The longest target kept. Longer is refused, not cut: a cut address is a broken one. */
export const MAX_TARGET_CHARS = 2000;

export const LINKS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS short_links (
    token      TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS short_links_expiry ON short_links (expires_at);
`;

/**
 * A target worth redirecting to: https, no whitespace or control characters, a host, not too long.
 * @param {unknown} url @returns {string|null}
 */
export function httpsTarget(url) {
  if (typeof url !== 'string' || url.length > MAX_TARGET_CHARS || /[\s\u0000-\u001f\u007f]/.test(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

export class LinkStore {
  /**
   * @param {{ db: import('better-sqlite3').Database, secret?: string, baseUrl: string, now?: () => Date }} opts
   */
  constructor({ db, secret = '', baseUrl, now = () => new Date() }) {
    this.db = db;
    this.secret = secret;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.now = now;
    db.exec(LINKS_SCHEMA);
    this.put = db.prepare(`
      INSERT INTO short_links (token, url, created_at, expires_at) VALUES (@token, @url, @now, @expires)
      ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at WHERE short_links.url = excluded.url`);
    this.get = db.prepare('SELECT url FROM short_links WHERE token = ? AND expires_at > ?');
    this.prune = db.prepare('DELETE FROM short_links WHERE expires_at <= ?');
    this.owner = db.prepare('SELECT url FROM short_links WHERE token = ?');
  }

  #nowSec() {
    return Math.floor(this.now().getTime() / 1000);
  }

  #tokenFor(url) {
    return this.secret
      ? createHmac('sha256', this.secret).update(`go.v1\n${url}`).digest('base64url').slice(0, TOKEN_CHARS)
      : randomBytes(8).toString('base64url').slice(0, TOKEN_CHARS);
  }

  /**
   * The short link for a target, or null when the target is not an acceptable https address.
   * @param {unknown} url @returns {string|null}
   */
  shorten(url) {
    const target = httpsTarget(url);
    if (!target) return null;
    const now = this.#nowSec();
    this.prune.run(now);
    const token = this.#tokenFor(target);
    const expires = now + LINK_TTL_DAYS * 86_400;
    this.put.run({ token, url: target, now, expires });
    // A different target already holds this token (a collision in 48 bits): refuse rather than redirect wrongly.
    if (this.owner.get(token)?.url !== target) return null;
    return `${this.baseUrl}/go/${token}`;
  }

  /**
   * The target of a live token, or null (never issued, expired, or malformed).
   * @param {string} token @returns {string|null}
   */
  resolve(token) {
    if (!TOKEN_PATTERN.test(token)) return null;
    return this.get.get(token, this.#nowSec())?.url ?? null;
  }
}
