// The dashboard API, mounted at /api by server/app.js.
//
// Read routes are open: they serve the public demo and never return a guest's identity
// (no caller hash, no numbers, no transcripts) or a property's door and wifi notes.
// Write routes (PUT a config, publish) need the admin token in X-Admin-Token, and are
// refused outright when DASHBOARD_ADMIN_TOKEN is not set, so a deploy without one is
// read-only rather than open.
//
// Tool logic runs in-process: the routes import the same handlers the voice agent calls
// over HTTP, with the same Qloo and Ticketmaster clients, so the dashboard shows exactly
// what a call would get.

import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PERSONA_IDS, validateConfig } from '../../config/schema.js';
import { secretMatches } from '../lib/auth.js';
import { InputError, PiiViolation, UpstreamError } from '../lib/errors.js';
import { areaInsights } from '../tools/area-insights.js';
import { composeItinerary } from '../tools/compose-itinerary.js';
import { eventsNearby } from '../tools/events-nearby.js';
import { recommendNearby } from '../tools/recommend-nearby.js';
import { resolveTaste } from '../tools/resolve-taste.js';
import { DEMO_PROPERTY_ID, hasSessionsTable } from './db.js';
import { LOCKED_RULES, OWNER_TOGGLES } from './guardrails.js';

export const ADMIN_HEADER = 'X-Admin-Token';
/** Guest-taste panels stay dark until this many sessions exist (k-anonymity floor). */
export const SESSION_GATE = 5;
/** Shown in place of a secret note on read routes; a PUT that sends it back keeps the stored note. */
export const MASK = '(hidden)';
export const PROMPT_PREVIEW_CHARS = 1200;
/** What the landing page's sample guest "says". Resolved through Qloo like a real call. */
export const SAMPLE_MENTIONS = Object.freeze(['Sturgill Simpson', 'thai food', 'Wes Anderson']);
const CACHE_MS = 10 * 60 * 1000;
// The compiler imports the tool list from server/app.js, which imports this module, so it is
// loaded on first use rather than at import time (no import cycle at startup).
const compiler = () => import('../../compiler/compile.js');
const ID_RE = /^[a-z0-9-]{1,40}$/;
const SECRET_PATHS = [['logistics', 'access_note'], ['logistics', 'wifi_note']];

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db          properties (and, usually, sessions)
 * @param {import('better-sqlite3').Database} [deps.sessionsDb] where the sessions table lives, if elsewhere
 * @param {{ qloo: any, ticketmaster: any, timezone: string, now?: () => Date }} deps.ctx
 * @param {{ adminToken?: string, demoNumber?: string, repoUrl?: string, publishWebhookUrl?: string, publishWebhookSecret?: string }} [deps.env]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string[]} [deps.toolNames]
 */
export function createApiRoutes({ db, sessionsDb, ctx, env = {}, fetchImpl = fetch, toolNames = [] }) {
  const api = new Hono();
  const now = () => (ctx.now ? ctx.now() : new Date());
  const cache = new Map();
  const sdb = sessionsDb ?? db;

  /** Memoize an upstream-backed computation for CACHE_MS (keeps a demo page from spending quota). */
  const cached = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await fn();
    cache.set(key, { value, until: Date.now() + CACHE_MS });
    return value;
  };

  const getProperty = (id) => db.prepare('SELECT id, config_json, status, updated_at, published_at FROM properties WHERE id = ?').get(id);

  const isAdmin = (c) => Boolean(env.adminToken) && secretMatches(c.req.header(ADMIN_HEADER), env.adminToken);
  const requireAdmin = async (c, next) => {
    if (!env.adminToken) return c.json({ ok: false, error: { code: 'writes_disabled', message: 'Saving is turned off on this server.' } }, 403);
    if (!isAdmin(c)) return c.json({ ok: false, error: { code: 'unauthorized', message: 'That admin key did not match.' } }, 401);
    await next();
  };

  const validId = (c) => {
    const id = c.req.param('id');
    return ID_RE.test(id) ? id : null;
  };

  // ---- sessions (read-only, defensive) ---------------------------------------

  const sessionsAvailable = () => {
    try { return hasSessionsTable(sdb); } catch { return false; }
  };

  /** @returns {number} */
  const sessionCount = (propertyId) => (sessionsAvailable()
    ? sdb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE property_id = ?').get(propertyId).n : 0);

  /** Aggregate rows only. caller_hash is never selected. */
  const listSessions = (propertyId, limit = 50) => {
    if (!sessionsAvailable()) return [];
    return sdb.prepare(`SELECT started_at, persona, entities_json, picks_count, events_count, sms_sent
                        FROM sessions WHERE property_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(propertyId, limit)
      .map((r) => ({
        started_at: r.started_at,
        persona: r.persona,
        entities: entityNames(r.entities_json),
        picks_count: Number(r.picks_count ?? 0),
        events_count: Number(r.events_count ?? 0),
        sms_sent: Boolean(r.sms_sent),
      }));
  };

  /** The names guests mentioned most across all sessions, most frequent first. */
  const topEntities = (propertyId, max = 5) => {
    if (!sessionsAvailable()) return [];
    const counts = new Map();
    for (const r of sdb.prepare('SELECT entities_json FROM sessions WHERE property_id = ?').all(propertyId)) {
      for (const name of new Set(entityNames(r.entities_json).map((n) => n.toLowerCase()))) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name, n]) => ({ name, sessions: n }));
  };

  const lastSessionAt = () => {
    if (!sessionsAvailable()) return null;
    return sdb.prepare('SELECT MAX(started_at) AS t FROM sessions').get().t ?? null;
  };

  // ---- routes ------------------------------------------------------------------

  api.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ ok: false, error: { code: 'body_too_large' } }, 413) }));
  api.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  api.get('/health-summary', (c) => {
    const demo = getProperty(DEMO_PROPERTY_ID);
    const toolsOk = Boolean(ctx.qloo);
    const number = env.demoNumber || null;
    // The badge only says "answering" when the tool server is up, a number is configured,
    // and the demo property has been published. Anything less is "test" or "busy".
    const state = !toolsOk ? 'busy' : number && demo?.status === 'published' ? 'answering' : 'test';
    return c.json({
      ok: true,
      checked_at: now().toISOString(),
      line: { state },
      tools: {
        ok: toolsOk,
        qloo: ctx.qloo?.mode ?? 'unknown',
        ticketmaster: ctx.ticketmaster?.enabled ? 'enabled' : 'disabled',
        names: toolNames,
      },
      last_session_at: lastSessionAt(),
      demo: demo ? { id: demo.id, name: safeName(demo.config_json), status: demo.status, published_at: demo.published_at } : null,
      demo_number: number,
      repo_url: env.repoUrl || null,
    });
  });

  api.get('/personas', async (c) => c.json({ ok: true, personas: await personaCards() }));

  api.get('/guardrails', (c) => c.json({ ok: true, locked: LOCKED_RULES, toggles: OWNER_TOGGLES }));

  api.get('/sample-pick', async (c) => {
    const demo = getProperty(DEMO_PROPERTY_ID);
    const { lat, lng } = demo ? JSON.parse(demo.config_json).property : { lat: 32.0749, lng: -81.0943 };
    try {
      const out = await cached(`pick:${lat},${lng}`, () => samplePicks(ctx, lat, lng));
      return c.json({ ok: true, sample: true, ...out });
    } catch (err) {
      return c.json(toolFailure(err), 502);
    }
  });

  api.get('/properties/:id', (c) => {
    const id = validId(c);
    const row = id && getProperty(id);
    if (!row) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
    const config = JSON.parse(row.config_json);
    return c.json({
      ok: true,
      id: row.id,
      status: row.status,
      updated_at: row.updated_at,
      published_at: row.published_at,
      config: isAdmin(c) ? config : maskSecrets(config),
      sessions_count: sessionCount(row.id),
    });
  });

  api.put('/properties/:id', requireAdmin, async (c) => {
    const id = validId(c);
    if (!id) return c.json({ ok: false, error: { code: 'invalid_id' } }, 400);
    const body = await readJson(c);
    if (!body) return c.json({ ok: false, error: { code: 'invalid_json' } }, 400);
    const existing = getProperty(id);
    const config = unmaskSecrets(body.config ?? body, existing ? JSON.parse(existing.config_json) : null);
    const v = validateConfig(config);
    if (!v.ok) return c.json({ ok: false, error: { code: 'invalid_config' }, errors: v.errors }, 400);
    const ts = now().toISOString();
    // Any change puts the property back to draft: the published agent no longer matches it.
    db.prepare(`INSERT INTO properties (id, config_json, status, updated_at) VALUES (?, ?, 'draft', ?)
                ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, status = 'draft', updated_at = excluded.updated_at`)
      .run(id, JSON.stringify(config), ts);
    return c.json({ ok: true, id, status: 'draft', updated_at: ts });
  });

  api.post('/properties/:id/compile', async (c) => {
    const id = validId(c);
    const row = id && getProperty(id);
    const body = (await readJson(c)) ?? {};
    // A draft config may be sent for preview without saving it; secrets left masked fall
    // back to the stored ones. Nothing is written.
    const base = row ? JSON.parse(row.config_json) : null;
    if (!row && !body.config) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
    const config = body.config ? unmaskSecrets(body.config, base) : base;
    const persona = body.persona ?? config?.voice?.persona_id;
    if (!PERSONA_IDS.includes(persona)) return c.json({ ok: false, error: { code: 'invalid_persona', message: `persona must be one of ${PERSONA_IDS.join(', ')}` } }, 400);
    const v = validateConfig(config);
    if (!v.ok) return c.json({ ok: false, error: { code: 'invalid_config' }, errors: v.errors }, 400);
    const { compile } = await compiler();
    const out = compile(config, { persona });
    const prompt = out.agent.conversation_config.agent.prompt.prompt;
    return c.json({
      ok: true,
      persona,
      lint: out.lint,
      meta: out.meta,
      prompt_preview: prompt.slice(0, PROMPT_PREVIEW_CHARS),
      prompt_truncated: prompt.length > PROMPT_PREVIEW_CHARS,
      first_message: out.agent.conversation_config.agent.first_message,
      tools: out.tools.map((t) => t?.tool_config?.name ?? t?.name).filter(Boolean),
    });
  });

  api.post('/properties/:id/publish', requireAdmin, async (c) => {
    const id = validId(c);
    const row = id && getProperty(id);
    if (!row) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
    const config = JSON.parse(row.config_json);
    const v = validateConfig(config);
    if (!v.ok) return c.json({ ok: false, error: { code: 'invalid_config' }, errors: v.errors }, 400);
    const { compile } = await compiler();
    const out = compile(config);
    if (out.meta.errors > 0) {
      return c.json({ ok: false, error: { code: 'lint_failed', message: 'The compiled concierge has lint errors. Nothing was published.' }, lint: out.lint }, 409);
    }
    const ts = now().toISOString();
    db.prepare(`UPDATE properties SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
    const webhook = await notifyPublish(env, fetchImpl, { property_id: id, published_at: ts, persona: out.meta.persona, trust_level: out.meta.trust_level });
    return c.json({ ok: true, id, status: 'published', published_at: ts, webhook });
  });

  api.get('/properties/:id/sessions', (c) => {
    const id = validId(c);
    const row = id && getProperty(id);
    if (!row) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
    const total = sessionCount(id);
    return c.json({
      ok: true,
      available: sessionsAvailable(),
      total,
      gate: { min: SESSION_GATE, count: total, open: total >= SESSION_GATE },
      sessions: listSessions(id),
    });
  });

  api.get('/properties/:id/insights', async (c) => {
    const id = validId(c);
    const row = id && getProperty(id);
    if (!row) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
    const { lat, lng } = JSON.parse(row.config_json).property;
    const radius = [1, 2, 5].includes(Number(c.req.query('radius'))) ? Number(c.req.query('radius')) : 2;
    const sample = c.req.query('sample') === '1';
    const count = sessionCount(id);
    const gateOpen = count >= SESSION_GATE;
    const top = gateOpen ? topEntities(id) : [];
    const mentions = sample ? [...SAMPLE_MENTIONS] : top.map((t) => t.name);
    try {
      const out = await cached(`ins:${id}:${radius}:${sample}:${mentions.join('|')}`, () => insightsFor(ctx, { lat, lng, radius, mentions }));
      const gated = { status: 'gated', count, min: SESSION_GATE };
      const guestPanels = sample || gateOpen;
      return c.json({
        ok: true,
        sample,
        as_of: out.as_of,
        area: out.area,
        gate: { min: SESSION_GATE, count, open: gateOpen },
        interests: guestPanels ? out.interests : [],
        // The heatmap is area-level when the gate is closed (no guest signal is sent).
        heatmap: { ...out.heatmap, basis: out.interests.length ? 'guest_taste' : 'area' },
        demographics: guestPanels ? out.demographics : gated,
        compare: guestPanels ? out.compare : gated,
        upstream: out.upstream,
      });
    } catch (err) {
      return c.json(toolFailure(err), 502);
    }
  });

  api.get('/properties/:id/itinerary-sample', async (c) => {
    const id = validId(c);
    const row = id && getProperty(id);
    if (!row) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
    const config = JSON.parse(row.config_json);
    const { lat, lng } = config.property;
    try {
      const out = await cached(`itin:${id}:${row.updated_at}`, () => sampleItinerary(ctx, config, lat, lng));
      return c.json({ ok: true, sample: true, ...out });
    } catch (err) {
      return c.json(toolFailure(err), 502);
    }
  });

  api.notFound((c) => c.json({ ok: false, error: { code: 'not_found' } }, 404));
  api.onError((err, c) => {
    console.error(JSON.stringify({ svc: 'api', error: 'internal', detail: String(err?.stack ?? err) }));
    return c.json({ ok: false, error: { code: 'internal', message: 'Something broke on our side. Nothing you entered was lost.' } }, 500);
  });
  return api;
}

// ---- helpers (exported for tests) -----------------------------------------------

/** entities_json is written as a string array; tolerate objects with a name too. */
export function entityNames(json) {
  try {
    const v = JSON.parse(json ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.map((e) => (typeof e === 'string' ? e : e?.name)).filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 80));
  } catch {
    return [];
  }
}

export function maskSecrets(config) {
  const out = structuredClone(config);
  for (const [a, b] of SECRET_PATHS) if (out?.[a]?.[b]) out[a][b] = MASK;
  return out;
}

export function unmaskSecrets(config, stored) {
  if (!config || typeof config !== 'object') return config;
  const out = structuredClone(config);
  for (const [a, b] of SECRET_PATHS) {
    if (out?.[a]?.[b] === MASK) {
      if (stored?.[a]?.[b]) out[a][b] = stored[a][b];
      else delete out[a][b];
    }
  }
  return out;
}

function safeName(json) {
  try { return JSON.parse(json).property?.name ?? null; } catch { return null; }
}

async function readJson(c) {
  try { return await c.req.json(); } catch { return null; }
}

async function personaCards() {
  const { listPersonas, loadPersona, PERSONAS_DIR } = await compiler();
  return listPersonas().filter((id) => PERSONA_IDS.includes(id)).map((id) => {
    const p = loadPersona(id);
    const text = readFileSync(`${PERSONAS_DIR}/${id}.md`, 'utf8');
    const title = /^# (.+)$/m.exec(text)?.[1] ?? p.display_name;
    const quotes = [...p.sections['sample lines'].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const character = p.sections.voice.split(/(?<=\.)\s+/).slice(1, 2).join(' ');
    return { id: p.id, display_name: p.display_name, title, humor_ceiling: p.humor_ceiling, character, sample: quotes[0] ?? '', opener: p.opener };
  });
}

/** One upstream record per call, without parameters: which service, which endpoint, how answered. */
const upstreamSummary = (calls) => (calls ?? []).map((k) => ({ service: k.service, endpoint: k.endpoint, via: k.via }));

async function samplePicks(ctx, lat, lng) {
  const taste = await resolveTaste({ mentions: [...SAMPLE_MENTIONS] }, ctx);
  if (!taste.resolved.length) return { mentions: [...SAMPLE_MENTIONS], places: [], upstream: upstreamSummary(taste.calls), as_of: new Date().toISOString() };
  const rec = await recommendNearby({ taste: taste.resolved.map(({ id, name }) => ({ id, name })), lat, lng, radius_miles: 3, take: 2 }, ctx);
  return {
    mentions: [...SAMPLE_MENTIONS],
    echo_line: taste.echo_line,
    places: rec.places,
    status: rec.status,
    upstream: upstreamSummary([...taste.calls, ...rec.calls]),
    as_of: new Date().toISOString(),
  };
}

async function insightsFor(ctx, { lat, lng, radius, mentions }) {
  const calls = [];
  let interests = [];
  let resolveFailure = null;
  if (mentions.length) {
    try {
      const t = await resolveTaste({ mentions: mentions.slice(0, 6) }, ctx);
      calls.push(...t.calls);
      interests = t.resolved.map(({ id, name }) => ({ id, name }));
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      resolveFailure = err.code;
    }
  }
  const entityIds = interests.filter((i) => !i.id.startsWith('urn:tag:'));
  const compare = entityIds.length >= 2 ? { a: [entityIds[0]], b: [entityIds[1]] } : undefined;
  const res = await areaInsights({ lat, lng, radius_miles: radius, ...(interests.length ? { interests } : {}), ...(compare ? { compare } : {}) }, ctx);
  calls.push(...res.calls);
  const demographics = resolveFailure ? { status: 'degraded', reason: resolveFailure } : res.demographics;
  const cmp = compare ? { ...res.compare, groups: { a: compare.a[0].name, b: compare.b[0].name } } : res.compare;
  return {
    as_of: new Date().toISOString(),
    area: res.area,
    interests: interests.map((i) => i.name),
    heatmap: res.heatmap,
    demographics,
    compare: cmp,
    upstream: upstreamSummary(calls),
  };
}

async function sampleItinerary(ctx, config, lat, lng) {
  const picks = [];
  const calls = [];
  try {
    const s = await samplePicks(ctx, lat, lng);
    calls.push(...s.upstream);
    if (s.places[0]) picks.push({ name: s.places[0].name, why: s.places[0].why, url: s.places[0].url, source: 'Qloo' });
  } catch (err) {
    if (!(err instanceof UpstreamError)) throw err;
  }
  try {
    const ev = await eventsNearby({ lat, lng, when: 'tonight', classification: 'music', take: 1, timezone: config.property.timezone }, ctx);
    calls.push(...upstreamSummary(ev.calls));
    const e = ev.events?.[0];
    if (e) picks.push({ name: e.name, detail: e.when_label, why: e.venue ? `At ${e.venue}` : undefined, url: e.url ?? undefined, source: 'Ticketmaster' });
  } catch (err) {
    if (!(err instanceof UpstreamError)) throw err;
  }
  const own = config.picks?.[0];
  if (own) picks.push({ name: own.name, why: own.why, source: 'Owner' });
  if (!picks.length) return { picks: [], itinerary: null, upstream: calls, as_of: new Date().toISOString() };
  const it = await composeItinerary({ picks: picks.map(({ source, ...p }) => p), guest: { party_size: 2, when: 'tonight' } });
  const { calls: _ignored, ...itinerary } = it;
  return { picks, itinerary, upstream: calls, as_of: new Date().toISOString() };
}

async function notifyPublish(env, fetchImpl, payload) {
  if (!env.publishWebhookUrl) return 'not_configured';
  try {
    const res = await fetchImpl(env.publishWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.publishWebhookSecret ? { 'X-Publish-Secret': env.publishWebhookSecret } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

function toolFailure(err) {
  if (err instanceof UpstreamError) return { ok: false, status: 'error', error: { code: err.code, service: err.service, retryable: err.retryable } };
  if (err instanceof InputError || err instanceof PiiViolation) return { ok: false, status: 'error', error: { code: 'invalid_input' } };
  throw err;
}
