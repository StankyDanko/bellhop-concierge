// The HTTP surface: /health plus one POST route per agent tool under /tools/*.
// createApp() takes its dependencies as arguments so tests can build the whole
// server around mock clients and an in-memory cache.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireSecret } from './lib/auth.js';
import { sessionIdFrom } from './lib/sessions.js';
import { withTrace } from './lib/upstream.js';
import { InputError, PiiViolation, RateLimited, UpstreamError } from './lib/errors.js';
import { areaInsights } from './tools/area-insights.js';
import { composeItinerary } from './tools/compose-itinerary.js';
import { crossDomain } from './tools/cross-domain.js';
import { eventsNearby } from './tools/events-nearby.js';
import { recommendNearby } from './tools/recommend-nearby.js';
import { resolveTaste } from './tools/resolve-taste.js';
import { logSession } from './tools/log-session.js';
import { createSendLimiter, sendSms } from './tools/send-sms.js';
import { forgetGuest } from './tools/forget-guest.js';
import { observeTool, redactTrace } from './lib/memory.js';
import { conversationInit, INIT_BODY_MAX, INIT_PATH } from './hooks/conversation-init.js';
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

/**
 * Returning-guest memory tools, routed like the rest under /tools/*. Kept apart from TOOLS
 * until the agent definitions carry them (compiler/tools.js asserts TOOLS and its own
 * definitions match one for one).
 */
export const MEMORY_TOOLS = {
  forget_guest: forgetGuest,
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
 * @param {string} [deps.cacheMode]  'frozen' | 'only' | 'on' | 'off', reported by /health
 * @param {() => Date} [deps.now]
 * @param {object} [deps.dashboard]  { db, env, distDir? } to mount the innkeeper dashboard (server/api/)
 * @param {import('./lib/memory.js').GuestMemory|null} [deps.memory]  returning-guest memory; null switches it off
 * @param {Record<string, any>} [deps.agents]  voice agent id -> { property_id, persona, timezone } (CONCIERGE_AGENTS)
 * @param {() => number} [deps.initRng]  the variety pick's random source (tests pin it)
 */
export function createApp({ secret, qloo, ticketmaster, timezone, logger, sms, sessions, now, dashboard, cacheMode, memory = null, agents = {}, initRng }) {
  if (!sms || !sessions) throw new Error('createApp needs an sms sender and a session store');
  const app = new Hono();
  const ctx = { qloo, ticketmaster, timezone, now, sms, smsLimiter: createSendLimiter(), sessions, toolSecret: secret, memory };

  app.get('/health', (c) => c.json({
    ok: true,
    service: 'bellhop-concierge-tools',
    qloo: qloo.mode,
    ticketmaster: ticketmaster.mode ?? (ticketmaster.enabled ? 'live' : 'disabled'),
    sms: sms.mode,
    cache: cacheMode ?? 'on',
    tools: [...Object.keys(TOOLS), ...Object.keys(MEMORY_TOOLS)],
  }));

  // Conversation initiation webhook: answers the call's dynamic variables before the first word.
  // Its own auth inside (a bad secret still answers the default lines, so the call connects).
  app.post(INIT_PATH, bodyLimit({ maxSize: INIT_BODY_MAX, onError: (c) => c.json({ ok: false, status: 'error', error: { code: 'body_too_large' } }, 413) }),
    conversationInit({ secret, memory, agents, timezone, now, logger, rng: initRng }));

  app.use('/tools/*', requireSecret(secret));
  app.use('/tools/*', bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ ok: false, status: 'error', error: { code: 'body_too_large' } }, 413) }));

  for (const [name, handler] of Object.entries({ ...TOOLS, ...MEMORY_TOOLS })) {
    app.post(`/tools/${name}`, async (c) => {
      const started = Date.now();
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, status: 'error', error: { code: 'invalid_json' } }, 400);
      }
      try {
        const { result: { calls, memory_redact: memoryRedact, ...result }, trace } = await withTrace(name, () => handler(body, ctx));
        // Remembered ids never reach the recorded trace (dashboard, fingerprint) or the response.
        redactTrace(trace, memoryRedact);
        rememberCall(memory, name, body, result, logger);
        logger({ svc: 'tool', tool: name, status: result.status, ms: Date.now() - started });
        persistTrace(sessions, sessionIdFrom(body), name, trace, result.counterfactual, logger);
        return c.json({ ok: true, tool: name, ...result, trace, meta: { upstream: calls, ms: Date.now() - started } });
      } catch (err) {
        return c.json(...toErrorResponse(name, err, logger));
      }
    });
  }

  // Innkeeper dashboard: JSON under /api, the built React app at /, /build, /property/:id.
  // Optional, so the tool server runs without it (tests, a tools-only deploy).
  if (dashboard) mountDashboard(app, { ...dashboard, ctx, sessionsDb: dashboard.sessionsDb ?? sessions?.db, toolNames: Object.keys(TOOLS) });

  app.notFound((c) => c.json({ ok: false, status: 'error', error: { code: 'not_found' } }, 404));
  return app;
}

/** Note what a tool call means for the caller's memory. Best effort: never fails the tool call. */
function rememberCall(memory, tool, body, result, logger) {
  if (!memory) return;
  try {
    observeTool(memory, tool, body, result);
  } catch (err) {
    logger({ svc: 'memory', tool, error: 'observe_failed', detail: String(err?.message ?? err).slice(0, 120) });
  }
}

/** Store a tool's call trace under its session id. Best effort: never fails the tool call. */
function persistTrace(sessions, sessionId, tool, trace, counterfactual, logger) {
  if (!sessionId || typeof sessions?.writeTrace !== 'function') return;
  try {
    sessions.writeTrace(sessionId, tool, trace, counterfactual ?? null);
  } catch (err) {
    logger({ svc: 'tool', tool, error: 'trace_write_failed', detail: String(err?.message ?? err) });
  }
}

/** @returns {[Record<string, unknown>, 400|422|429|500|502]} */
function toErrorResponse(tool, err, logger) {
  if (err instanceof RateLimited) {
    logger({ svc: 'tool', tool, error: 'rate_limited', upstream: err.service });
    return [{ ok: false, tool, status: 'error', reason: 'rate_limited', ...(err.service === 'twilio' ? { sent: false } : {}),
      error: { code: 'rate_limited', service: err.service, retryable: false }, say: err.say }, 429];
  }
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
