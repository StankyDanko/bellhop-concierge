// The sixteen battery criteria. Each takes one scenario record (what the driver saw while it
// played the caller) and returns { verdict, reason }. verdict is 'pass', 'warn', 'fail', or
// 'na' (the scenario does not exercise the criterion). Reasons carry counts and codes only:
// never a place name or any other upstream value, so a scorecard can be shared.
//
// Record shape (see battery.js):
//   scenario            the scenario from scenarios.json
//   resolve             { status, json, ms } from resolve_taste
//   recommend           { status, json, ms } or null (no taste resolved)
//   reduced             { json } recommend_nearby rerun without the second named taste, or null
//   events, cross       { status, json, ms } or null
//   compose             { status, json, ms, submitted: string[] } or null
//   tools               [{ tool, ms, status }] for the chain (rerun and log_session excluded)
//   trace               every trace entry from every tool call in the scenario
//   statuses            every HTTP status seen
// Calls inside a two-call sequence (C13 to C16) also carry:
//   init                { status, json, ms } from the initiation webhook
//   prior               the previous call's record for the same caller, or null
//   committed           log_session answered ok (the call was folded into memory)
//   texted              ids of the places this call texted (submitted picks mapped through recommend)
//   forget, afterForget forget_guest's answer and a webhook probe made after it
//   memoryRows          memory rows plus live links left for the caller (mock only)
//   apiSweep            [{ path, status, text, valuesOnly? }] every dashboard route after the call
//   secrets             fake numbers, their hashes, and every memory_line and stay_line served;
//                       never written to the scorecard

import { assertNoPii } from '../lib/pii-guard.js';
import { FOOTER, MAX_CHARS, toGsm } from '../lib/sms.js';
import { vibeOf } from '../tools/resolve-taste.js';

/** A restaurant genre tag (mirrors isCuisineTag in tools/places.js). */
const CUISINE_TAG = /^urn:tag:genre:place:restaurant:[^:]+/;
/** Mirrors ADULTS_ONLY in tools/recommend-nearby.js (not exported there). */
const ADULTS_ONLY = /\b(bar|pub|nightclub|night club|lounge|brewery|cocktail|speakeasy|wine bar|tavern)s?\b/i;

export const TOOL_BUDGET_MS = 2500;
export const CHAIN_BUDGET_MS = 6000;

const v = (verdict, reason) => ({ verdict, reason });
const na = (reason) => v('na', reason);
const places = (rec) => (Array.isArray(rec?.recommend?.json?.places) ? rec.recommend.json.places : []);
/** A recommend_nearby that was called and failed: a fail for the place criteria, never "no picks". */
const recommendFailed = (rec) => (rec?.recommend && rec.recommend.status !== 200 ? v('fail', `recommend_nearby http ${rec.recommend.status}`) : null);
const allMentions = (s) => [...(s.mentions ?? []), ...(s.companion_mentions ?? [])];
const key = (p) => p.entity_id ?? p.name;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Dynamic variables the initiation webhook returns on every call (design section 6). */
const INIT_VARS = ['greeting', 'opener_hook', 'choice_pair', 'bet_domain', 'plan_window', 'caller_status', 'memory_line', 'stay_line', 'texted_count'];
const initVars = (init) => init?.json?.dynamic_variables ?? null;
export const INIT_BUDGET_MS = 300;
/** JSON keys that only the memory layer writes; none may appear in a dashboard response. */
export const MEMORY_KEYS = /"(memory_line|stay_line|caller_status|texted_count|caller_hash|guest_memory|prior_signals|tastes_json|texted_json)"/;

export const CRITERIA = [
  { id: 'C1', label: 'Every named thing resolved or reported unresolved',
    run(rec) {
      const r = rec.resolve?.json;
      if (!r || rec.resolve.status !== 200) return v('fail', `resolve_taste http ${rec.resolve?.status}`);
      const resolved = [...(r.resolved ?? []), ...(r.companion_resolved ?? [])];
      const unresolved = [...(r.unresolved ?? []), ...(r.companion_unresolved ?? [])];
      const dropped = allMentions(rec.scenario).filter((m) => {
        const budgetOnly = vibeOf(m) && vibeOf(m).tastes.length === 0;
        return !budgetOnly && !resolved.some((x) => x.mention === m) && !unresolved.includes(m);
      });
      if (dropped.length) return v('fail', `${dropped.length} mention(s) silently dropped`);
      const weak = resolved.filter((x) => typeof x.confidence === 'number' && x.confidence < 0.6).length;
      if (weak) return v('warn', `${weak} resolved at confidence below 0.6; ${unresolved.length} reported unresolved`);
      return v('pass', `${resolved.length} resolved, ${unresolved.length} reported unresolved`);
    } },

  { id: 'C2', label: 'Vibe phrases went to /v2/tags, never /search',
    run(rec) {
      const vibes = allMentions(rec.scenario).filter((m) => (vibeOf(m)?.tastes.length ?? 0) > 0);
      if (!vibes.length) return na('no vibe phrase in this scenario');
      const resolveTrace = rec.trace.filter((t) => t.tool === 'resolve_taste');
      const leaked = vibes.filter((m) => resolveTrace.some((t) => t.endpoint === '/search' && String(t.params?.query ?? '').toLowerCase() === m.toLowerCase()));
      if (leaked.length) return v('fail', `${leaked.length} vibe phrase(s) sent to /search`);
      const viaTags = vibes.filter((m) => resolveTrace.some((t) => t.endpoint === '/v2/tags' && t.mapped_from === m));
      if (viaTags.length !== vibes.length) return v('fail', `${vibes.length - viaTags.length} vibe phrase(s) never reached /v2/tags`);
      return v('pass', `${vibes.length} vibe phrase(s) mapped through /v2/tags`);
    } },

  { id: 'C3', label: 'Every place pick within the applied radius',
    run(rec) {
      const failed = recommendFailed(rec);
      if (failed) return failed;
      const ps = places(rec);
      if (!ps.length) return na('no place picks');
      const radius = rec.recommend.json.applied?.radius_miles;
      if (typeof radius !== 'number') return v('fail', 'applied.radius_miles missing');
      const outside = ps.filter((p) => typeof p.distance_miles === 'number' && p.distance_miles > radius + 0.1).length;
      const unknown = ps.filter((p) => typeof p.distance_miles !== 'number').length;
      if (outside) return v('fail', `${outside} of ${ps.length} picks beyond ${radius} mi`);
      if (unknown) return v('warn', `${unknown} of ${ps.length} picks have no distance`);
      return v('pass', `${ps.length} picks within ${radius} mi`);
    } },

  { id: 'C4', label: 'Every pick has a why (explainability, or honest fallback)',
    run(rec) {
      const failed = recommendFailed(rec);
      if (failed) return failed;
      const ps = places(rec);
      if (!ps.length) return na('no place picks');
      const bad = ps.filter((p) => !p.why || !['explainability', 'affinity'].includes(p.why_trace?.basis)).length;
      if (bad) return v('fail', `${bad} of ${ps.length} picks lack a why or a basis`);
      const ex = ps.filter((p) => p.why_trace.basis === 'explainability').length;
      return v('pass', `${ex} explainability, ${ps.length - ex} honest fallback`);
    } },

  { id: 'C5', label: 'Taste sensitivity: dropping the second named taste changes picks',
    run(rec) {
      if (!rec.recommend) return na('nothing resolved to recommend from');
      if (!rec.reduced) return na('fewer than two resolved tastes');
      const a = places(rec).map(key);
      const b = (rec.reduced.json?.places ?? []).map(key);
      if (!a.length || !b.length) return na('no picks to compare');
      if (sameList(a, b)) return v('warn', 'same picks in the same order without the second taste');
      const sameSet = new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
      return v('pass', sameSet ? 'same picks, new order' : 'pick set changed');
    } },

  { id: 'C6', label: 'Counterfactual present and distinguishable from the taste picks',
    run(rec) {
      if (!rec.recommend) return na('no recommend call');
      const cf = rec.recommend.json?.counterfactual;
      if (!cf) return v('warn', 'no counterfactual returned');
      if (cf.same === true) return v('warn', 'top pick without taste equals top pick with taste');
      return v('pass', 'counterfactual differs from the taste pick');
    } },

  { id: 'C7', label: 'Plus-one labels: not every pick "both" when tastes differ, never "both" on one cuisine',
    run(rec) {
      if (!rec.scenario.companion_mentions?.length) return na('no plus-one');
      if (!rec.recommend) return na('no recommend call');
      const ps = places(rec);
      const summary = rec.recommend.json.companion;
      if (!summary?.scored) return v('warn', `plus-one not scored${summary?.note ? ` (${summary.note})` : ''}`);
      if (!ps.length) return na('no picks');
      const both = ps.filter((p) => p.favors === 'both').length;
      const tally = ['guest', 'companion', 'both'].map((k) => `${k} ${ps.filter((p) => p.favors === k).length}`).join(', ');
      // Sharper check: with a different cuisine each, a "both" pick that carries only one
      // person's cuisine (its tag_match drivers) tells the couple a one-sided place suits both.
      const cuisineOf = (list) => new Set((list ?? []).map((r) => r.id).filter((id) => CUISINE_TAG.test(String(id))));
      const gc = cuisineOf(rec.resolve?.json?.resolved);
      const cc = cuisineOf(rec.resolve?.json?.companion_resolved);
      const sameCuisine = gc.size === cc.size && [...gc].every((id) => cc.has(id));
      if (gc.size && cc.size && !sameCuisine) {
        const carried = (p) => new Set((p.why_trace?.drivers ?? []).filter((d) => d.source === 'tag_match').map((d) => d.id));
        const oneSided = ps.filter((p) => {
          if (p.favors !== 'both') return false;
          const own = carried(p);
          return [...gc].some((id) => own.has(id)) !== [...cc].some((id) => own.has(id));
        }).length;
        if (oneSided) return v('fail', `${oneSided} pick(s) labelled both carry one person's cuisine only (${tally})`);
      }
      if (rec.scenario.tastes_differ && ps.length >= 2 && both === ps.length) return v('fail', `all ${ps.length} picks labelled both (${tally})`);
      if (rec.scenario.tastes_differ && ps.length === 1 && both === 1) return v('warn', 'the only pick is labelled both');
      return v('pass', tally);
    } },

  { id: 'C8', label: 'Kids true: no adults-only tags in picks',
    run(rec) {
      if (rec.scenario.constraints?.kids !== true) return na('no kids in this scenario');
      const ps = places(rec);
      if (!ps.length) return na('no place picks');
      const applied = rec.recommend.json.applied ?? {};
      const adults = ps.filter((p) => ADULTS_ONLY.test(p.name ?? '')).length;
      if (adults) return v('fail', `${adults} of ${ps.length} picks read as adults-only by name`);
      if (applied.kids !== true) return v('fail', 'kids flag not applied');
      return v('pass', `${ps.length} picks, ${applied.filtered_for_kids ?? 0} candidates filtered (picks expose names, not tags)`);
    } },

  { id: 'C9', label: 'Cross domain never returns an input as its own pick',
    run(rec) {
      if (!rec.cross) return na('no cross_domain call');
      if (rec.cross.status !== 200) return v('fail', `cross_domain http ${rec.cross.status}`);
      const inputs = rec.crossInputs ?? { ids: [], names: [] };
      const results = rec.cross.json.results ?? [];
      const echoed = results.filter((r) => inputs.ids.includes(r.entity_id) || inputs.names.includes(String(r.name).toLowerCase())).length;
      if (echoed) return v('fail', `${echoed} of ${results.length} results are inputs`);
      return v('pass', `${results.length} results, none an input`);
    } },

  { id: 'C10', label: 'compose_itinerary: <= 320 chars, GSM-7, every line traceable',
    run(rec) {
      if (!rec.compose) return na('nothing to compose');
      const { json, status, submitted } = rec.compose;
      if (status !== 200 || typeof json?.body !== 'string') return v('fail', `compose_itinerary http ${status}`);
      const body = json.body;
      if (body.length > MAX_CHARS) return v('fail', `${body.length} chars`);
      const lines = body.split('\n');
      if (lines.some((l) => toGsm(l) !== l)) return v('fail', 'characters outside GSM-7');
      if (lines.at(-1) !== FOOTER) return v('fail', 'footer missing');
      const names = submitted.map((n) => toGsm(n));
      const pickLines = lines.slice(0, -1).filter((l) => !(l.endsWith(':') && !names.some((n) => l.includes(n))));
      const orphans = pickLines.filter((l) => !names.some((n) => l.includes(n))).length;
      const dropped = (json.tokens_dropped ?? 0) + (json.favors_dropped ?? 0) + (json.when_dropped ?? 0);
      if (orphans) return v('fail', `${orphans} line(s) match no submitted pick`);
      if (dropped) return v('warn', `${dropped} unsigned claim(s) dropped by the tool`);
      return v('pass', `${body.length} chars, ${json.picks_included} pick(s), all signed`);
    } },

  { id: 'C11', label: `Latency: each tool under ${TOOL_BUDGET_MS} ms, chain under ${CHAIN_BUDGET_MS} ms`,
    run(rec) {
      const slow = rec.tools.filter((t) => t.ms > TOOL_BUDGET_MS);
      const chain = rec.tools.reduce((n, t) => n + t.ms, 0);
      if (slow.length || chain > CHAIN_BUDGET_MS) {
        return v('warn', `${slow.length ? `${slow.map((t) => t.tool).join('+')} over ${TOOL_BUDGET_MS} ms; ` : ''}chain ${chain} ms`);
      }
      return v('pass', `chain ${chain} ms`);
    } },

  { id: 'C12', label: 'Privacy: every outbound Qloo param passed the allowlist',
    run(rec) {
      const refused = rec.statuses.filter((s) => s === 422).length;
      if (refused) return v('fail', `${refused} tool call(s) refused with pii_refused`);
      const qloo = rec.trace.filter((t) => t.source === 'qloo');
      let bad = 0;
      for (const t of qloo) {
        try { assertNoPii(t.endpoint, t.params ?? {}); } catch { bad += 1; }
      }
      if (bad) return v('fail', `${bad} traced request(s) fail the allowlist`);
      return v('pass', `${qloo.length} traced request(s) clean`);
    } },

  { id: 'C13', label: 'Variety: a second call from one caller hears a new opener and a new choice pair',
    run(rec) {
      if (!rec.init) return na('not part of a call sequence');
      const b = initVars(rec.init);
      if (rec.init.status !== 200 || !b) return v('fail', `initiation http ${rec.init.status}`);
      const missing = INIT_VARS.filter((k) => !(k in b)).length;
      if (missing) return v('fail', `${missing} dynamic variable(s) missing`);
      if (!rec.prior) return na('first call for this caller');
      const a = initVars(rec.prior.init);
      if (!a) return v('fail', 'first call has no initiation response');
      const same = ['opener_hook', 'choice_pair'].filter((k) => a[k] === b[k]);
      if (same.length) return v('fail', `${same.join('+')} repeated on the second call`);
      const want = rec.scenario?.same_day ? 'same_day' : 'returning';
      if (rec.prior.committed && b.caller_status !== want) return v('fail', `caller_status ${b.caller_status}, expected ${want}`);
      if (rec.init.ms > INIT_BUDGET_MS) return v('warn', `opener and pair changed; initiation took ${rec.init.ms} ms`);
      return v('pass', `opener and pair changed; status ${b.caller_status}; bet ${a.bet_domain === b.bet_domain ? 'same' : 'changed'}`);
    } },

  { id: 'C14', label: 'Returning call: texted places excluded, prior tastes carried as signals',
    run(rec) {
      if (!rec.prior || !rec.prior.texted?.length) return na('no earlier texted call for this caller');
      if (!rec.recommend) return na('no recommend call on the returning call');
      const failed = recommendFailed(rec);
      if (failed) return failed;
      const mem = rec.recommend.json?.applied?.memory;
      if (!mem) return v('fail', 'applied.memory missing from recommend_nearby');
      const texted = new Set(rec.prior.texted);
      const repeats = places(rec).filter((p) => texted.has(p.entity_id)).length;
      if (repeats) return v('fail', `${repeats} already-texted place(s) picked again`);
      if (mem.excluded < texted.size) return v('fail', `${mem.excluded} excluded of ${texted.size} texted`);
      const priorIds = new Set((rec.prior.resolve?.json?.resolved ?? []).map((r) => r.id));
      if (mem.prior_signals < Math.min(priorIds.size, 12)) return v('fail', `${mem.prior_signals} prior signal(s) of ${priorIds.size} remembered`);
      const leaked = rec.trace.filter((t) => t.tool === 'recommend_nearby'
        && (String(t.params?.['filter.exclude.entities'] ?? '') !== '' || [...texted].some((id) => Object.values(t.params ?? {}).some((x) => String(x).split(',').includes(id))))).length;
      if (leaked) return v('fail', `${leaked} recorded trace entr(ies) carry remembered ids`);
      return v('pass', `${mem.excluded} excluded, ${mem.prior_signals} prior signal(s), none in the recorded trace`);
    } },

  { id: 'C15', label: 'Forget me: no memory row survives, the next call is new',
    run(rec) {
      if (!rec.forget) return na('no forget request in this call');
      if (rec.forget.status !== 200 || rec.forget.json?.forgotten !== true) return v('fail', `forget_guest http ${rec.forget.status}`);
      if (typeof rec.forget.json.say !== 'string' || !rec.forget.json.say) return v('fail', 'no say line');
      const p = initVars(rec.afterForget);
      if (!p) return v('fail', 'no probe after forget');
      if (p.caller_status !== 'new' || p.memory_line !== 'none' || p.texted_count !== 0) return v('fail', 'probe call still remembered');
      if (typeof rec.memoryRows === 'number' && rec.memoryRows !== 0) return v('fail', `${rec.memoryRows} row(s) left for the caller`);
      return v('pass', `probe new${typeof rec.memoryRows === 'number' ? ', 0 rows' : ' (row count not visible in live mode)'}`);
    } },

  { id: 'C16', label: 'Memory never appears in any /api response',
    run(rec) {
      if (!rec.apiSweep?.length) return na('no api sweep for this call');
      const bad = rec.apiSweep.filter((r) => r.status >= 500).length;
      if (bad) return v('fail', `${bad} route(s) errored`);
      const s = rec.secrets ?? {};
      const needles = [...(s.numbers ?? []), ...(s.hashes ?? []),
        ...(s.memoryLines ?? []).filter((x) => x && x !== 'none'), ...(s.stayLines ?? []).filter((x) => x && x !== 'none')];
      // The compile preview is the agent definition: placeholder NAMES may appear there, values never.
      const hits = rec.apiSweep.filter((r) => (!r.valuesOnly && MEMORY_KEYS.test(r.text)) || needles.some((n) => r.text.includes(n))).length;
      if (hits) return v('fail', `${hits} of ${rec.apiSweep.length} route(s) expose memory`);
      return v('pass', `${rec.apiSweep.length} route(s) clean`);
    } },
];

/** @param {object} rec @returns {Record<string, { verdict: string, reason: string }>} */
export function evaluate(rec) {
  const out = {};
  for (const c of CRITERIA) {
    try {
      out[c.id] = c.run(rec);
    } catch (err) {
      out[c.id] = v('fail', `criterion threw: ${String(err?.message ?? err).slice(0, 80)}`);
    }
  }
  return out;
}

/** Count verdicts per criterion across scenario results. @param {Array<Record<string, any>>} evals */
export function tally(evals) {
  const t = {};
  for (const c of CRITERIA) t[c.id] = { pass: 0, warn: 0, fail: 0, na: 0 };
  for (const e of evals) for (const c of CRITERIA) t[c.id][e[c.id]?.verdict ?? 'fail'] += 1;
  return t;
}
