// The battery harness, offline: the criteria on hand-written records, the scenario file's
// shape, and a full run through the mock app (fixtures) to prove the driver and scorecard work.
// Every value here is a made-up fx- id or a fictional place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { CRITERIA, evaluate, tally } from '../battery/criteria.js';
import { exitCodeFor, loadScenarios, playScenario, renderScorecard, runBattery } from '../scripts/battery.js';
import { FOOTER } from '../lib/sms.js';

const place = (over = {}) => ({ name: 'Fx Cafe', entity_id: 'fx-place-1', why: 'Fans of X love it', why_trace: { basis: 'explainability', drivers: [] },
  distance_miles: 1, favors: null, ...over });
const base = (over = {}) => ({
  scenario: { id: 't', mentions: ['a', 'b'] }, tools: [{ tool: 'resolve_taste', ms: 10 }], trace: [], statuses: [200],
  resolve: { status: 200, json: { resolved: [{ mention: 'a', confidence: 1 }, { mention: 'b', confidence: 1 }], unresolved: [] } },
  recommend: { status: 200, json: { places: [place()], applied: { radius_miles: 3, kids: false }, counterfactual: { same: false } } },
  reduced: null, cross: null, compose: null, ...over,
});
const verdict = (id, rec) => evaluate(rec)[id].verdict;

test('scenarios.json: 12 to 16 callers, unique ids, guest words only', () => {
  const { scenarios } = loadScenarios();
  assert.ok(scenarios.length >= 12 && scenarios.length <= 16);
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  for (const s of scenarios) assert.ok(Array.isArray(s.mentions) && s.mentions.length >= 1, s.id);
  assert.doesNotMatch(JSON.stringify(scenarios), /@|\d{7}|room\s*\d/i);
});

test('criteria: exactly twelve, C1 to C12', () => {
  assert.deepEqual(CRITERIA.map((c) => c.id), Array.from({ length: 12 }, (_, i) => `C${i + 1}`));
});

test('C1: a mention in neither list fails; reported unresolved passes', () => {
  assert.equal(verdict('C1', base()), 'pass');
  const dropped = base({ resolve: { status: 200, json: { resolved: [{ mention: 'a', confidence: 1 }], unresolved: [] } } });
  assert.equal(verdict('C1', dropped), 'fail');
  const reported = base({ resolve: { status: 200, json: { resolved: [{ mention: 'a', confidence: 1 }], unresolved: ['b'] } } });
  assert.equal(verdict('C1', reported), 'pass');
});

test('C2: a vibe phrase sent to /search fails; sent to /v2/tags passes', () => {
  const sc = { id: 't', mentions: ['spicy and loud'] };
  const bad = base({ scenario: sc, trace: [{ tool: 'resolve_taste', endpoint: '/search', params: { query: 'spicy and loud' } }] });
  assert.equal(verdict('C2', bad), 'fail');
  const good = base({ scenario: sc, trace: [{ tool: 'resolve_taste', endpoint: '/v2/tags', params: { 'filter.query': 'spicy' }, mapped_from: 'spicy and loud' }] });
  assert.equal(verdict('C2', good), 'pass');
  assert.equal(verdict('C2', base()), 'na');
});

test('C3: a pick beyond the applied radius fails', () => {
  const far = base();
  far.recommend.json.places = [place({ distance_miles: 9 })];
  assert.equal(verdict('C3', far), 'fail');
  assert.equal(verdict('C3', base()), 'pass');
});

test('C4: a pick with no why fails; the honest fallback passes', () => {
  const none = base();
  none.recommend.json.places = [place({ why: '' })];
  assert.equal(verdict('C4', none), 'fail');
  const fallback = base();
  fallback.recommend.json.places = [place({ why_trace: { basis: 'affinity', drivers: [] } })];
  assert.equal(verdict('C4', fallback), 'pass');
});

test('C5: identical picks without the second taste warn; a different set passes', () => {
  const same = base({ reduced: { json: { places: [place()] } } });
  assert.equal(verdict('C5', same), 'warn');
  const moved = base({ reduced: { json: { places: [place({ entity_id: 'fx-place-2', name: 'Fx Diner' })] } } });
  assert.equal(verdict('C5', moved), 'pass');
  assert.equal(verdict('C5', base()), 'na');
});

test('C6: a counterfactual equal to the pick warns; a missing one warns', () => {
  const same = base();
  same.recommend.json.counterfactual = { same: true };
  assert.equal(verdict('C6', same), 'warn');
  const missing = base();
  missing.recommend.json.counterfactual = null;
  assert.equal(verdict('C6', missing), 'warn');
  assert.equal(verdict('C6', base()), 'pass');
});

test('C7: every pick "both" for differing tastes fails', () => {
  const sc = { id: 't', mentions: ['a'], companion_mentions: ['b'], tastes_differ: true };
  const rec = base({ scenario: sc });
  rec.recommend.json.places = [place({ favors: 'both' }), place({ entity_id: 'fx-place-2', favors: 'both' })];
  rec.recommend.json.companion = { scored: true };
  assert.equal(verdict('C7', rec), 'fail');
  rec.recommend.json.places[1].favors = 'companion';
  assert.equal(verdict('C7', rec), 'pass');
  rec.recommend.json.companion = { scored: false };
  assert.equal(verdict('C7', rec), 'warn');
});

test('C8: kids with an adults-only name fails', () => {
  const sc = { id: 't', mentions: ['a'], constraints: { kids: true } };
  const rec = base({ scenario: sc });
  rec.recommend.json.applied = { radius_miles: 3, kids: true, filtered_for_kids: 2 };
  assert.equal(verdict('C8', rec), 'pass');
  rec.recommend.json.places = [place({ name: 'Fx Tavern' })];
  assert.equal(verdict('C8', rec), 'fail');
});

test('C9: a cross_domain result that is an input fails', () => {
  const rec = base({ cross: { status: 200, json: { results: [{ name: 'Fx Film', entity_id: 'fx-movie-1' }] } }, crossInputs: { ids: ['fx-movie-1'], names: [] } });
  assert.equal(verdict('C9', rec), 'fail');
  rec.crossInputs = { ids: ['fx-other'], names: [] };
  assert.equal(verdict('C9', rec), 'pass');
});

test('C10: over 320, non-GSM, or an untraceable line fails', () => {
  const ok = { status: 200, submitted: ['Fx Cafe'], json: { body: `Tonight:\n1. Fx Cafe - a reason\n${FOOTER}`, picks_included: 1 } };
  assert.equal(verdict('C10', base({ compose: ok })), 'pass');
  assert.equal(verdict('C10', base({ compose: { ...ok, json: { body: `x${'y'.repeat(330)}\n${FOOTER}` } } })), 'fail');
  assert.equal(verdict('C10', base({ compose: { ...ok, json: { body: `Fx Cafe 中\n${FOOTER}` } } })), 'fail');
  assert.equal(verdict('C10', base({ compose: { ...ok, json: { body: `Tonight:\nSomewhere else\n${FOOTER}` } } })), 'fail');
  assert.equal(verdict('C10', base({ compose: { ...ok, json: { ...ok.json, tokens_dropped: 1 } } })), 'warn');
});

test('C11: a slow tool or a long chain warns', () => {
  assert.equal(verdict('C11', base()), 'pass');
  assert.equal(verdict('C11', base({ tools: [{ tool: 'recommend_nearby', ms: 2600 }] })), 'warn');
  assert.equal(verdict('C11', base({ tools: [2000, 2000, 2100].map((ms, i) => ({ tool: `t${i}`, ms })) })), 'warn');
});

test('C12: a refusal or an off-allowlist traced param fails', () => {
  assert.equal(verdict('C12', base()), 'pass');
  assert.equal(verdict('C12', base({ statuses: [200, 422] })), 'fail');
  const leak = base({ trace: [{ source: 'qloo', endpoint: '/search', params: { query: 'call me at 555 123 4567' } }] });
  assert.equal(verdict('C12', leak), 'fail');
});

test('end to end through the mock app: every scenario plays, every criterion answers, scorecard renders', async () => {
  const { app } = makeApp();
  const call = async (tool, body) => {
    const t0 = performance.now();
    const res = await callTool(app, tool, body);
    return { ...res, ms: Math.round(performance.now() - t0) };
  };
  const scenarios = [
    { id: 'solo', mentions: ['Sturgill Simpson', 'thai food'], events: true },
    { id: 'couple', mentions: ['Sturgill Simpson'], companion_mentions: ['thai food'], constraints: { party_size: 2 }, tastes_differ: true },
    { id: 'kids', mentions: ['thai food', 'wes anderson'], constraints: { kids: true } },
    { id: 'vibe', mentions: ['Sturgill Simpson', 'spicy and loud'] },
    { id: 'nothing', mentions: ['zzqx unknown thing'] },
  ];
  const result = await runBattery({ call, scenarios, property: PROPERTY });
  assert.equal(result.records.length, scenarios.length);
  assert.equal(result.liveUsed, 0);
  for (const rec of result.records) {
    for (const c of CRITERIA) assert.ok(['pass', 'warn', 'fail', 'na'].includes(rec.eval[c.id].verdict), `${rec.scenario.id} ${c.id}`);
    assert.equal(rec.eval.C12.verdict, 'pass', rec.scenario.id);
    assert.equal(rec.eval.C1.verdict, 'pass', rec.scenario.id);
  }
  const card = renderScorecard({ ...result, mode: 'mock', startedAt: '2026-01-01T00:00:00.000Z' });
  assert.match(card, /## Counts per criterion/);
  assert.match(card, /\| solo \|/);
  assert.ok(!card.includes(String.fromCharCode(0x2014)));
  const counts = tally(result.records.map((r) => r.eval));
  assert.equal(Object.keys(counts).length, 12);
});

test('playScenario never calls send_sms and logs a session row', async () => {
  const { app, sessions } = makeApp();
  const seen = [];
  const call = async (tool, body) => {
    seen.push(tool);
    return { ...(await callTool(app, tool, body)), ms: 1 };
  };
  await playScenario(call, { id: 'solo', mentions: ['Sturgill Simpson', 'thai food'] }, PROPERTY);
  assert.ok(!seen.includes('send_sms'));
  assert.equal(seen.at(-1), 'log_session');
  assert.ok(sessions.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n >= 1);
});

test('the run stops before the cap would be exceeded', async () => {
  const call = async () => ({ status: 200, json: { trace: Array.from({ length: 10 }, () => ({ mode: 'live', cache: 'miss' })) }, ms: 1 });
  const out = await runBattery({ call, scenarios: [{ id: 'a', mentions: ['x'] }, { id: 'b', mentions: ['x'] }, { id: 'c', mentions: ['x'] }], property: PROPERTY, cap: 30, perScenarioReserve: 14 });
  assert.ok(out.stoppedBy);
  assert.ok(out.skipped.length >= 1);
  assert.ok(out.liveUsed <= 30);
});

test('--strict: exits 1 on any criterion fail, never on warns alone', () => {
  const rec = (verdicts) => ({ eval: Object.fromEntries(verdicts.map((v, i) => [`C${i + 1}`, { verdict: v, reason: '' }])) });
  assert.equal(exitCodeFor([rec(['pass', 'warn', 'na'])], true), 0);
  assert.equal(exitCodeFor([rec(['pass', 'warn']), rec(['fail'])], true), 1);
  assert.equal(exitCodeFor([rec(['fail'])], false), 0);
  assert.equal(exitCodeFor([], false), 1);
});
