// Shared-secret auth for agent tool calls.
// The voice platform stores the secret and sends it on every tool request in
// X-Concierge-Secret. Comparison is constant-time over fixed-length digests, so
// neither the secret's content nor its length leaks through timing.

import { createHash, timingSafeEqual } from 'node:crypto';

export const SECRET_HEADER = 'X-Concierge-Secret';
const MIN_SECRET_LENGTH = 16;

const digest = (s) => createHash('sha256').update(s, 'utf8').digest();

/** @param {string | undefined | null} provided @param {string} expected */
export function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Hono middleware. Refuses everything when the server has no secret configured,
 * so a misconfigured deploy fails closed.
 * @param {string} secret
 * @returns {import('hono').MiddlewareHandler}
 */
export function requireSecret(secret) {
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`CONCIERGE_TOOL_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return async (c, next) => {
    if (!secret) return c.json({ ok: false, status: 'error', error: { code: 'not_configured' } }, 503);
    if (!secretMatches(c.req.header(SECRET_HEADER), secret)) {
      return c.json({ ok: false, status: 'error', error: { code: 'unauthorized' } }, 401);
    }
    await next();
  };
}
