// Conversation variety: which name question, mood choice and plan window a call gets.
//
// Temperature stays at zero, so a call sounds new only if its inputs are new. This module
// picks those inputs per call from pools.json and hands them over as dynamic variables.
// It is pure: the clock, the timezone, the caller's last call and the random source are all
// arguments, so a test can pin every choice. It touches no database and no network.
//
// The first message is the persona's own introduction, compiled, plus opener_hook. A caller the
// concierge has no name for hears a question asking who is calling. A caller it remembers by
// name hears that name and a question asking whether it is still that person, because a phone
// is not a person: someone else may be holding it.

import { readFileSync } from 'node:fs';

export const POOLS = Object.freeze(JSON.parse(readFileSync(new URL('./pools.json', import.meta.url), 'utf8')));
const POOLS_FILE = POOLS;

const FALLBACK_PERSONA = 'harper';
const FALLBACK_TZ = 'America/New_York';

/** @typedef {'morning'|'afternoon'|'evening'|'late'} Daypart */

/**
 * @typedef {object} LastCall What the memory layer remembers about this caller's previous call.
 * @property {string[]} [openerIds] newest last
 * @property {string[]} [pairIds] newest last
 * @property {boolean} [hasTastes] the guest named something the last time, so there is something to build on
 * @property {string} [lastCallDay] YYYY-MM-DD in the inn's timezone
 */

/** Local clock parts in an IANA timezone. A bad zone falls back rather than throwing. */
export function localParts(now, timezone) {
  const parts = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' }).formatToParts(now);
  let p;
  try { p = parts(timezone || FALLBACK_TZ); } catch { p = parts(FALLBACK_TZ); }
  const get = (t) => p.find((x) => x.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, weekday: get('weekday').slice(0, 3).toLowerCase() };
}

/**
 * morning 05:00 to 10:59, afternoon 11:00 to 16:59, evening 17:00 to 21:59, late 22:00 to 04:59.
 * @param {number} hour
 * @returns {Daypart}
 */
export function daypartOf(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late';
}

/**
 * new: nothing to build on. returning: tastes remembered from an earlier day.
 * same_day: tastes remembered and the last call was today in the inn's timezone.
 * A caller with variety history but no tastes stays new: no "welcome back" without something to build on.
 * @param {{ hasTastes?: boolean, lastCallDay?: string, now?: Date, timezone?: string }} a
 * @returns {'new'|'returning'|'same_day'}
 */
export function callerStatus({ hasTastes = false, lastCallDay = '', now = new Date(), timezone = FALLBACK_TZ } = {}) {
  if (!hasTastes) return 'new';
  return lastCallDay && lastCallDay === localParts(now, timezone).day ? 'same_day' : 'returning';
}

const fits = (tags, value) => !tags || tags.includes('any') || tags.includes(value);

/** Order so the persona's defaults come first; rng() of zero then returns the compiled line. */
function defaultsFirst(list, persona) {
  const isDefault = (x) => x.default === true || (Array.isArray(x.default) && x.default.includes(persona));
  return [...list.filter(isDefault), ...list.filter((x) => !isDefault(x))];
}

/**
 * Drop the caller's last two ids; if fewer than three candidates would remain, drop only the
 * last one. Never empties the pool: an exhausted pool repeats before it goes silent.
 */
function avoidRecent(list, recent = []) {
  const ids = recent.slice(-2);
  const keep = (drop) => list.filter((x) => !drop.includes(x.id));
  const two = keep(ids);
  if (two.length >= 3) return two;
  const one = keep(ids.slice(-1));
  return one.length ? one : list;
}

/** One entry at random; an empty list gives the fallback instead, so call setup never throws. */
function pick(list, rng, fallback) {
  if (!list.length) return fallback;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return list[i];
}

/** The persona's default entry (the compiled first message's own line), whatever the daypart. */
function defaultOf(list, persona) {
  return defaultsFirst(list ?? [], persona)[0];
}

const sideKey = (side) => [...side].sort().join('+');

/**
 * @param {object} a
 * @param {string} [a.persona] a persona id in the pools; anything else gets Harper
 * @param {'new'|'returning'|'same_day'} [a.status] computed from `last` when omitted
 * @param {string} [a.name] the first name remembered for this phone, already cleaned; empty for none
 * @param {Date} [a.now]
 * @param {string} [a.timezone] the inn's IANA timezone
 * @param {LastCall} [a.last] this caller's previous call; omit for no history (withheld number, unknown agent)
 * @param {() => number} [a.rng] uniform in [0, 1); inject for exact tests
 * @param {typeof POOLS} [a.pools] the pools to choose from; tests pass edited copies
 * @returns {{ vars: Record<string, string|number>, ids: { opener: string, pair: string, daypart: Daypart, weekday: string } }}
 */
export function choose({ persona = FALLBACK_PERSONA, status, name = '', now = new Date(), timezone = FALLBACK_TZ, last = {}, rng = Math.random, pools: POOLS = POOLS_FILE } = {}) {
  const key = Object.hasOwn(POOLS.personas, persona) ? persona : FALLBACK_PERSONA;
  const pool = POOLS.personas[key];
  const { hour, weekday } = localParts(now, timezone);
  const daypart = daypartOf(hour);
  const state = status ?? callerStatus({ hasTastes: last.hasTastes, lastCallDay: last.lastCallDay, now, timezone });

  // The line after the introduction: who is calling, or, with a name on file, is it still them.
  const known = Boolean(name) && state !== 'new';
  const hookPool = !known ? pool.openers.filter((o) => fits(o.dayparts, daypart))
    : state === 'same_day' ? pool.same_day : pool.returning;
  const hook = pick(avoidRecent(defaultsFirst(hookPool, key), last.openerIds), rng, defaultOf(pool.openers, key));
  const opener_hook = known ? hook.text.replaceAll('<name>', name) : hook.text;

  // The mood choice for a stuck caller: never the last pair, never one that shares a side with it.
  const lastPair = POOLS.pairs.find((p) => p.id === (last.pairIds ?? []).at(-1));
  const lastSides = new Set((lastPair?.sides ?? []).map(sideKey));
  const pairPool = POOLS.pairs.filter((p) => p.enabled && fits(p.dayparts, daypart)
    && !(lastPair && (p.id === lastPair.id || p.sides.some((s) => lastSides.has(sideKey(s))))));
  const base = POOLS.pairs.filter((p) => p.enabled && fits(p.dayparts, daypart));
  const pair = pick(avoidRecent(defaultsFirst(pairPool.length ? pairPool : base, key), last.pairIds), rng, defaultOf(POOLS.pairs, key));

  return {
    vars: {
      opener_hook,
      choice_pair: pair.text,
      plan_window: POOLS.plan_windows[daypart],
      caller_status: state,
      // Memory fields belong to the memory layer; these are the no-memory defaults it overrides.
      // With them a call is a first call: no name, call one, the recording note not yet heard.
      caller_name: 'none',
      call_number: 1,
      recording_noted: 'no',
      last_call_hook: 'none',
      memory_line: 'none',
      stay_line: 'none',
      texted_count: 0,
    },
    ids: { opener: hook.id, pair: pair.id, daypart, weekday },
  };
}

/** The variables a call gets when nothing is remembered and nothing varies: the compiled first message's hook. */
export function defaultVars(persona = FALLBACK_PERSONA) {
  const key = Object.hasOwn(POOLS.personas, persona) ? persona : FALLBACK_PERSONA;
  // Wednesday evening, rng at zero: every pool hands back its first entry, which is the default.
  return choose({ persona: key, status: 'new', now: new Date('2026-10-21T22:00:00Z'), timezone: 'America/New_York', rng: () => 0 }).vars;
}

/** A stand-in first name for checking the remembered-name lines (fictional, never a real caller). */
export const SAMPLE_NAME = 'Sam';

/** Every spoken string in the pools, with the name placeholder filled by SAMPLE_NAME. */
export function spokenLines() {
  const out = [];
  for (const [persona, p] of Object.entries(POOLS.personas)) {
    for (const o of [...p.openers, ...p.returning, ...p.same_day]) out.push({ where: `${persona}.${o.id}`, text: o.text.replaceAll('<name>', SAMPLE_NAME) });
  }
  out.push(...POOLS.pairs.map((p) => ({ where: p.id, text: p.text })),
    ...Object.values(POOLS.plan_windows).map((text) => ({ where: 'plan_windows', text })));
  return out;
}
