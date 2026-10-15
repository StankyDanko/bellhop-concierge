// The HTTP surface: /health plus one POST route per agent tool under /tools/*.
// createApp() takes its dependencies as arguments so tests can build the whole
// server around mock clients and an in-memory cache.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireSecret } from './lib/auth.js';
import { InputError, PiiViolation, UpstreamError } from './lib/errors.js';
import { areaInsights } from './tools/area-insights.js';
import { composeItinerary } from './tools/compose-itinerary.js';
import { crossDomain } from './tools/cross-domain.js';
import { eventsNearby } from './tools/events-nearby.js';
import { recommendNearby } from './tools/recommend-nearby.js';
import { resolveTaste } from './tools/resolve-taste.js';

/** Tool name (what the voice agent calls) -> handler. */
export const TOOLS = {
  resolve_taste: resolveTaste,
  recommend_nearby: recommendNearby,
  cross_domain: crossDomain,
  events_nearby: eventsNearby,
  compose_itinerary: composeItinerary,
  area_insights: areaInsights,
};

/** A line the agent can say when a lookup fails, instead of inventing an answer. */
const FALLBACK_SAY = "I couldn't reach my recommendations desk just now.";

/**
 * @param {object} deps
 * @param {string} deps.secret
 * @param {import('./lib/qloo.js').QlooClient} deps.qloo
 * @param {import('./lib/ticketmaster.js').TicketmasterClient} deps.ticketmaster
 * @param {string} deps.timezone
 * @param {import('./lib/log.js').Logger} deps.logger
 * @param {() => Date} [deps.now]
 */
export function createApp({ secret, qloo, ticketmaster, timezone, logger, now }) {
  const app = new Hono();
  const ctx = { qloo, ticketmaster, timezone, now };

  app.get('/health', (c) => c.json({
    ok: true,
    service: 'bellhop-concierge-tools',
    qloo: qloo.mode,
    ticketmaster: ticketmaster.enabled ? 'enabled' : 'disabled',
    tools: Object.keys(TOOLS),
  }));

  app.use('/tools/*', requireSecret(secret));
  app.use('/tools/*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ ok: false, status: 'error', error: { code: 'body_too_large' } }, 413) }));

  for (const [name, handler] of Object.entries(TOOLS)) {
    app.post(`/tools/${name}`, async (c) => {
      const started = Date.now();
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, status: 'error', error: { code: 'invalid_json' } }, 400);
      }
      try {
        const { calls, ...result } = await handler(body, ctx);
        logger({ svc: 'tool', tool: name, status: result.status, ms: Date.now() - started });
        return c.json({ ok: true, tool: name, ...result, meta: { upstream: calls, ms: Date.now() - started } });
      } catch (err) {
        return c.json(...toErrorResponse(name, err, logger));
      }
    });
  }

  app.notFound((c) => c.json({ ok: false, status: 'error', error: { code: 'not_found' } }, 404));
  return app;
}

/** @returns {[Record<string, unknown>, 400|422|500|502]} */
function toErrorResponse(tool, err, logger) {
  if (err instanceof InputError) {
    return [{ ok: false, tool, status: 'error', error: { code: 'invalid_input', message: err.message } }, 400];
  }
  if (err instanceof PiiViolation) {
    logger({ svc: 'tool', tool, error: 'pii_refused', detail: err.message });
    return [{ ok: false, tool, status: 'error', error: { code: 'pii_refused', message: 'Request refused: it would have sent personal data upstream.' } }, 422];
  }
  if (err instanceof UpstreamError) {
    logger({ svc: 'tool', tool, error: err.code, upstream: err.service });
    return [{ ok: false, tool, status: 'error', error: { code: err.code, service: err.service, retryable: err.retryable }, say: FALLBACK_SAY }, 502];
  }
  logger({ svc: 'tool', tool, error: 'internal', detail: String(err?.stack ?? err) });
  return [{ ok: false, tool, status: 'error', error: { code: 'internal' }, say: FALLBACK_SAY }, 500];
}
