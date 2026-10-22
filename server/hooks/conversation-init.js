// POST /hooks/conversation-init: the voice platform's conversation initiation webhook.
//
// On an inbound phone call the platform posts { caller_id, agent_id, called_number, call_sid,
// conversation_id } while the line is still ringing, and starts the call with the dynamic
// variables this answers. They pick the opener, the food choice, the bet and the plan window
// for this call (server/conversation/choose.js), and, for a caller the concierge has heard from
// in the last few days, what it remembers (server/lib/memory.js).
//
// A failed or slow answer can keep the call from connecting, so this handler never throws and
// answers 200 with the default lines on anything unexpected: bad or missing auth, an unknown
// agent, a withheld number, a memory error. Only a body over the size limit gets a non-200.
// Defaults are the same public lines a call hears today, so they leak nothing.
//
// The raw number, called_number and call_sid are never stored and never logged. It lives
// outside server/api/ on purpose: the dashboard holds no handle to guest memory.

import { secretMatches, SECRET_HEADER } from '../lib/auth.js';
import { callerFrom, memoryLine, sessionFrom, stayLine } from '../lib/memory.js';
import { choose, defaultVars } from '../conversation/choose.js';

export const INIT_PATH = '/hooks/conversation-init';
export const INIT_BODY_MAX = 8 * 1024;
const SLUG = /^[a-z0-9-]{1,64}$/;

/** The response envelope the platform expects. Variables only, never a config override. */
export const initResponse = (vars) => ({ type: 'conversation_initiation_client_data', dynamic_variables: vars });

/**
 * CONCIERGE_AGENTS: which inn and persona each voice agent id belongs to, as JSON
 * { "<agent id>": { "property_id": "demo", "persona": "harper", "timezone": "America/New_York" } }.
 * Entries with a bad slug are dropped; bad JSON means no agents (every call gets defaults).
 * @param {string|undefined} raw
 * @returns {Record<string, { property_id: string, persona: string, timezone?: string }>}
 */
export function parseAgents(raw) {
  if (!raw) return {};
  let v;
  try { v = JSON.parse(raw); } catch { return {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [id, a] of Object.entries(v)) {
    if (!a || !SLUG.test(String(a.property_id ?? '')) || !SLUG.test(String(a.persona ?? ''))) continue;
    out[id] = { property_id: a.property_id, persona: a.persona, ...(typeof a.timezone === 'string' ? { timezone: a.timezone } : {}) };
  }
  return out;
}

/**
 * The variables for one call. Pure apart from memory reads and writes.
 * @param {object} a
 * @param {any} a.body                 the platform's payload
 * @param {boolean} a.authorized
 * @param {Record<string, any>} a.agents
 * @param {import('../lib/memory.js').GuestMemory|null} a.memory
 * @param {string} a.timezone          the server's default zone
 * @param {Date} a.now
 * @param {() => number} [a.rng]
 * @returns {{ vars: Record<string, string|number>, status: string, returning: boolean }}
 */
export function buildInit({ body, authorized, agents, memory, timezone, now, rng = Math.random }) {
  const agent = Object.hasOwn(agents, String(body?.agent_id ?? '')) ? agents[body.agent_id] : null;
  const persona = agent?.persona ?? 'harper';
  // Bad auth or an agent we do not know: today's lines, nothing read, nothing written.
  if (!authorized) return { vars: defaultVars(persona), status: 'unauthorized', returning: false };
  if (!agent) return { vars: defaultVars('harper'), status: 'unknown_agent', returning: false };
  const tz = agent.timezone ?? timezone;
  const callerId = callerFrom(body?.caller_id);
  const hash = memory && callerId ? memory.keyFor(callerId) : null;
  // A withheld number (or memory switched off): fresh variety, nothing stored.
  if (!hash) return { vars: choose({ persona, now, timezone: tz, rng }).vars, status: 'no_memory', returning: false };

  const row = memory.read(hash, agent.property_id);
  const last = row ? {
    openerIds: row.variety?.opener ?? [], pairIds: row.variety?.pair ?? [], betIds: row.variety?.bet ?? [],
    hasTastes: row.tastes.length > 0, lastCallDay: row.last_call_day,
  } : {};
  const picked = choose({ persona, now, timezone: tz, last, rng });
  const returning = picked.vars.caller_status !== 'new';
  const vars = { ...picked.vars };
  if (returning) {
    vars.memory_line = memoryLine(row.tastes);
    vars.stay_line = stayLine(row.party);
    vars.texted_count = row.texted.length;
  }
  memory.startCall({ hash, sessionId: sessionFrom(body?.conversation_id), propertyId: agent.property_id, persona, timezone: tz,
    variety: { opener: picked.ids.opener, pair: picked.ids.pair, bet: picked.ids.bet } });
  return { vars, status: 'ok', returning };
}

/**
 * Hono handler.
 * @param {{ secret: string, memory: import('../lib/memory.js').GuestMemory|null, agents: Record<string, any>,
 *           timezone: string, now?: () => Date, logger: (o: object) => void, rng?: () => number }} deps
 */
export function conversationInit({ secret, memory, agents, timezone, now = () => new Date(), logger, rng }) {
  return async (c) => {
    const started = Date.now();
    let body = null;
    try { body = await c.req.json(); } catch { body = null; }
    const authorized = secretMatches(c.req.header(SECRET_HEADER), secret);
    let out;
    try {
      out = buildInit({ body, authorized, agents, memory, timezone, now: now(), rng });
    } catch (err) {
      logger({ svc: 'init', error: 'internal', detail: String(err?.message ?? err).slice(0, 120) });
      out = { vars: defaultVars('harper'), status: 'error', returning: false };
    }
    logger({ svc: 'init', status: out.status, ms: Date.now() - started, returning: out.returning });
    return c.json(initResponse(out.vars));
  };
}
