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
import { logSession } from './tools/log-session.js';
import { createSendLimiter, sendSms } from './tools/send-sms.js';
import { mountDashboard } from './api/index.js';

/** Tool name (what the voice agent calls) -> handler. */
export const TOOLS = {
  resolve_taste: resolveTaste,
  recommend_nearby: recommendNearby,
  cross_domain: crossDomain,
  events_nearby: eventsNearby,
  compose_itinerary: composeItinerary,
  area_insights: areaInsights,
  send_sms: sendSms,
  log_session: logSession,
};

/** A line the agent can say when a lookup fails, instead of inventing an answer. */
const FALLBACK_SAY = "I couldn't reach my recommendations desk just now.";
/** Said when a text did not go out. The agent must never say it was sent. */
const SMS_FAILED_SAY = "I wasn't able to send that text just now.";

/**
 * @param {object} deps
 * @param {string} deps.secret
 * @param {import('./lib/qloo.js').QlooClient} deps.qloo
 * @param {import('./lib/ticketmaster.js').TicketmasterClient} deps.ticketmaster
 * @param {string} deps.timezone
 * @param {import('./lib/log.js').Logger} deps.logger
 * @param {import('./lib/twilio.js').SmsSender} deps.sms
 * @param {import('./lib/sessions.js').SessionStore} deps.sessions
 * @param {() => Date} [deps.now]
 * @param {object} [deps.dashboard]  { db, env, distDir? } to mount the host dashboard (server/api/)
 */
export function createApp({ secret, qloo, ticketmaster, timezone, logger, sms, sessions, now, dashboard }) {
  if (!sms || !sessions) throw new Error('createApp needs an sms sender and a session store');
  const app = new Hono();
  const ctx = { qloo, ticketmaster, timezone, now, sms, smsLimiter: createSendLimiter(), sessions };

  app.get('/health', (c) => c.json({
    ok: true,
    service: 'bellhop-concierge-tools',
    qloo: qloo.mode,
    ticketmaster: ticketmaster.mode ?? (ticketmaster.enabled ? 'live' : 'disabled'),
    sms: sms.mode,
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

  // Host dashboard: JSON under /api, the built React app at /, /build, /property/:id.
  // Optional, so the tool server runs without it (tests, a tools-only deploy).
  if (dashboard) mountDashboard(app, { ...dashboard, ctx, sessionsDb: dashboard.sessionsDb ?? sessions?.db, toolNames: Object.keys(TOOLS) });

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
    const say = err.service === 'twilio' ? SMS_FAILED_SAY : FALLBACK_SAY;
    return [{ ok: false, tool, status: 'error', ...(err.service === 'twilio' ? { sent: false } : {}), error: { code: err.code, service: err.service, retryable: err.retryable }, say }, 502];
  }
  logger({ svc: 'tool', tool, error: 'internal', detail: String(err?.stack ?? err) });
  return [{ ok: false, tool, status: 'error', error: { code: 'internal' }, say: FALLBACK_SAY }, 500];
}
