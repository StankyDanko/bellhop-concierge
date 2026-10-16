// The plus-one beat: companion_mentions in resolve_taste, companion_taste in
// recommend_nearby (two extra Qloo calls at most), favors per pick, and the shared-pick
// marker in compose_itinerary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { BOTH_MARKER, composeItinerary, MAX_CHARS, TRUNCATION_ORDER } from '../lib/sms.js';
import { BOTH_FLOOR, classifyFavors, FAVORS_LINES } from '../lib/why.js';
import { PER_PERSON_FILTER, recommendNearby } from '../tools/recommend-nearby.js';
import { ResponseCache } from '../lib/cache.js';
import { createQlooClient } from '../lib/qloo.js';
import { silentLogger } from '../lib/log.js';
import { assertNoPii } from '../lib/pii-guard.js';

const STURGILL = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
const THAI = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };
const KACEY = { id: 'fx-artist-kacey-musgraves', name: 'Kacey Musgraves' };
const JAZZ = { id: 'urn:tag:genre:place:bar:jazz', name: 'Jazz bars' };

test('classifyFavors: both needs two good, close scores; otherwise the higher one wins', () => {
  assert.equal(classifyFavors(0.8, 0.83), 'both');
  assert.equal(classifyFavors(0.92, 0.48), 'guest');
  assert.equal(classifyFavors(0.55, 0.88), 'companion');
  // Close but both weak is not "you both will like".
  assert.equal(classifyFavors(BOTH_FLOOR - 0.1, BOTH_FLOOR - 0.05), 'companion');
  assert.equal(classifyFavors(0.7, null), 'guest');
  assert.equal(classifyFavors(null, 0.7), 'companion');
  assert.equal(classifyFavors(null, undefined), null);
  // A tie on weak scores goes to the guest, deterministically.
  assert.equal(classifyFavors(0.3, 0.3), 'guest');
});

test('favors lines are plain, assume nothing about the relationship, and use no dashes', () => {
  assert.deepEqual(Object.keys(FAVORS_LINES).sort(), ['both', 'companion', 'guest']);
  for (const line of Object.values(FAVORS_LINES)) {
    assert.doesNotMatch(line, /[\u2013\u2014]|partner|wife|husband|\bAI\b/i);
  }
});

test('resolve_taste: companion_mentions resolve in a parallel list, tagged who=companion', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'resolve_taste', {
    mentions: ['Sturgill Simpson', 'thai food'], companion_mentions: ['Kacey Musgraves'],
  });
  assert.equal(status, 200);
  assert.deepEqual(json.resolved.map((r) => r.id), [STURGILL.id, THAI.id]);
  assert.equal(json.echo_line, 'Sturgill Simpson and Thai food');
  assert.deepEqual(json.companion_resolved.map((r) => [r.id, r.who]), [[KACEY.id, 'companion']]);
  assert.equal(json.companion_echo_line, 'Kacey Musgraves');
  assert.deepEqual(json.companion_unresolved, []);
});

test('resolve_taste: no companion fields for a solo guest; companion list is bounded', async () => {
  const { app } = makeApp();
  const solo = (await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson'] })).json;
  assert.equal('companion_resolved' in solo, false);
  const tooMany = await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson'], companion_mentions: ['a', 'b', 'c'] });
  assert.equal(tooMany.status, 400);
  const notList = await callTool(app, 'resolve_taste', { mentions: ['Sturgill Simpson'], companion_mentions: 'Kacey' });
  assert.equal(notList.status, 400);
});

test('recommend_nearby: a plus-one gets per-person fit and a favors line on every pick', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'recommend_nearby', {
    taste: [STURGILL, THAI], companion_taste: [KACEY], ...PROPERTY, take: 3,
  });
  assert.equal(status, 200);
  assert.deepEqual(json.places.map((p) => [p.name, p.favors]), [
    ['Lemongrass Lantern', 'guest'],
    ['The Low Lantern Listening Room', 'both'],
    ['Pastel Diner & Pie', 'companion'],
  ]);
  assert.deepEqual(json.places[0].fit, { guest: 0.92, companion: 0.48 });
  assert.equal(json.places[1].favors_line, 'This one you both will like.');
  assert.equal(json.places[2].favors_line, 'That one is for your plus-one.');
  assert.deepEqual(json.companion, { scored: true, shared_pick: true, promoted_shared_pick: null });
  // One shortlist call plus exactly two scoring calls.
  assert.equal(json.meta.upstream.length, 4); // taste + two scoring calls + the counterfactual
});

test('recommend_nearby: the param shape for per-person scoring', async () => {
  /** @type {Record<string,string>[]} */
  const seen = [];
  const shortlist = ['fx-place-a', 'fx-place-b'].map((id, i) => ({ entity_id: id, name: `P${i}`, query: { affinity: 0.9 - i / 10 } }));
  const transport = async (_endpoint, params) => {
    seen.push(params);
    return { status: 200, body: { success: true, results: { entities: shortlist } } };
  };
  const { app } = makeApp({ qlooTransport: transport });
  await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], companion_taste: [KACEY, JAZZ], ...PROPERTY });
  // taste call + two per-person scoring calls + the unsignaled counterfactual call
  assert.equal(seen.length, 4, 'never more than two extra scoring calls (plus the counterfactual)');
  const [primary, guest, companion] = seen.filter((p) => Object.keys(p).some((k) => k.startsWith('signal.')));
  // The shortlist is drawn from both people's signals combined.
  assert.equal(primary['signal.interests.entities'], `${STURGILL.id},${KACEY.id}`);
  assert.equal(primary['signal.interests.tags'], `${THAI.id},${JAZZ.id}`);
  assert.equal(primary[PER_PERSON_FILTER], undefined);
  // Each scoring call carries one person's signals and the shortlist ids only.
  assert.equal(PER_PERSON_FILTER, 'filter.results.entities');
  for (const p of [guest, companion]) {
    assert.equal(p['filter.type'], 'urn:entity:place');
    assert.equal(p[PER_PERSON_FILTER], 'fx-place-a,fx-place-b');
    assert.equal(p.take, '2');
    assert.equal(p['filter.location'], undefined);
  }
  assert.equal(guest['signal.interests.entities'], STURGILL.id);
  assert.equal(guest['signal.interests.tags'], THAI.id);
  assert.equal(companion['signal.interests.entities'], KACEY.id);
  assert.equal(companion['signal.interests.tags'], JAZZ.id);
});

test('recommend_nearby: a pick for both is promoted into the last slot when the top picks lack one', async () => {
  const { app } = makeApp();
  // Kids drops the listening room (the first "both"), so the top two are guest + companion.
  const { json } = await callTool(app, 'recommend_nearby', {
    taste: [STURGILL, THAI], companion_taste: [KACEY], ...PROPERTY, take: 2, constraints: { kids: true },
  });
  assert.deepEqual(json.places.map((p) => [p.name, p.favors]), [
    ['Lemongrass Lantern', 'guest'],
    ['Riverbend Smokehouse', 'both'],
  ]);
  assert.equal(json.companion.promoted_shared_pick, 'Riverbend Smokehouse');
});

test('recommend_nearby: solo guest and an empty companion_taste make one call and add no favors', async () => {
  const { app } = makeApp();
  for (const extra of [{}, { companion_taste: [] }]) {
    const { json } = await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], ...PROPERTY, ...extra });
    assert.equal(json.meta.upstream.length, 2); // the taste call plus the counterfactual, no scoring calls
    assert.equal('companion' in json, false);
    assert.ok(json.places.every((p) => !('favors' in p)));
  }
});

test('recommend_nearby: a failed scoring call still returns the places, without favors', async () => {
  const transport = async (_endpoint, params) => {
    if (params[PER_PERSON_FILTER]) return { status: 500, body: { success: false } };
    return { status: 200, body: { success: true, results: { entities: [{ entity_id: 'fx-place-a', name: 'A', query: { affinity: 0.9 } }] } } };
  };
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [STURGILL], companion_taste: [KACEY], ...PROPERTY });
  assert.equal(status, 200);
  assert.equal(json.places.length, 1);
  assert.equal(json.places[0].favors, undefined);
  assert.equal(json.companion.scored, false);
  assert.match(json.companion.note, /^scoring unavailable/);
});

test('pii guard: the shortlist param takes entity ids and nothing else', () => {
  assertNoPii('/v2/insights', { [PER_PERSON_FILTER]: 'fx-place-lemongrass-lantern,fx-place-low-lantern' });
  assertNoPii('/v2/insights', { 'filter.entities': 'fx-place-lemongrass-lantern' });
  assert.throws(() => assertNoPii('/v2/insights', { [PER_PERSON_FILTER]: 'call me at 555 123 4567' }), /not an entity id/);
});

test('recommend_nearby: in live mode a repeat call is served from the upstream cache, scoring included', async () => {
  let upstreamHits = 0;
  const shortlist = [{ entity_id: 'fx-place-a', name: 'A', query: { affinity: 0.9 } }];
  const transport = async () => { upstreamHits += 1; return { status: 200, body: { success: true, results: { entities: shortlist } } }; };
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({
    config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'test-key', mock: false, timeoutMs: 1000, retries: 0 },
    cache, logger: silentLogger, transport,
  });
  const body = { taste: [STURGILL, THAI], companion_taste: [KACEY], ...PROPERTY };
  const first = await recommendNearby(body, { qloo });
  const again = await recommendNearby(body, { qloo });
  assert.deepEqual(first.calls.map((c) => c.via), ['live', 'live', 'live', 'live']);
  assert.deepEqual(again.calls.map((c) => c.via), ['cache', 'cache', 'cache', 'cache']);
  assert.equal(upstreamHits, 4);
});

test('compose_itinerary: the shared pick carries the (both) marker', async () => {
  const { app } = makeApp();
  const recs = (await callTool(app, 'recommend_nearby', { taste: [STURGILL, THAI], companion_taste: [KACEY], ...PROPERTY, take: 3 })).json.places;
  const picks = recs.map((p) => ({ name: p.name, why: p.why, url: p.url, favors: p.favors }));
  const { json } = await callTool(app, 'compose_itinerary', { picks, guest: { party_size: 2, when: 'tonight' } });
  assert.ok(json.char_count <= MAX_CHARS);
  assert.ok(json.body.includes(`The Low Lantern Listening Room${BOTH_MARKER}`));
  assert.ok(!json.body.includes(`Lemongrass Lantern${BOTH_MARKER}`), 'only the shared pick is marked');
});

test('sms: the marker fits when there is room and costs nothing when absent', () => {
  const short = composeItinerary({ picks: [{ name: 'Place A', favors: 'both' }, { name: 'Place B', favors: 'guest' }] });
  assert.match(short.body, /1\. Place A \(both\)\n2\. Place B\n/);
  assert.deepEqual(short.truncation, []);
  const plain = composeItinerary({ picks: [{ name: 'Place A' }] });
  assert.ok(!plain.body.includes(BOTH_MARKER));
});

const longPick = (n, favors) => ({ name: `Place Number ${n}`, why: 'Fans of Sturgill Simpson and Wes Anderson love it', url: `https://example.com/p${n}`, favors });

test('sms: drop_marker sits after drop_last_pick and before drop_why in the documented order', () => {
  const at = (s) => TRUNCATION_ORDER.indexOf(s);
  assert.ok(at('drop_marker') > at('drop_last_pick'));
  assert.ok(at('drop_marker') < at('drop_why'));
});

test('sms: a marker is never cut for nothing; dropping lower picks keeps it', () => {
  // Five long picks: lower picks go, and the shared pick at rank two keeps its marker.
  const r = composeItinerary({ picks: [longPick(1, 'guest'), longPick(2, 'both'), longPick(3, 'companion'), longPick(4, 'guest'), longPick(5, 'guest')] });
  assert.ok(r.char_count <= MAX_CHARS);
  assert.equal(r.truncation.includes('drop_marker'), false);
  assert.ok(r.body.includes(`Place Number 2${BOTH_MARKER}`));
});

test('sms: when the marker alone is the overflow, it goes before a pick does', () => {
  // Pad the first name until the two-pick text is over budget by fewer chars than the marker.
  const base = composeItinerary({ picks: [{ name: 'A', url: 'https://example.com/a' }, { name: 'B', url: 'https://example.com/b' }], intro: '' });
  const pad = 'x'.repeat(MAX_CHARS - base.char_count - 3);
  const r = composeItinerary({ picks: [{ name: `A${pad}`, url: 'https://example.com/a' }, { name: 'B', url: 'https://example.com/b', favors: 'both' }], intro: '' });
  // Header and why steps are recorded (no-ops here), then the marker goes and both picks stay.
  assert.equal(r.truncation.at(-1), 'drop_marker');
  assert.equal(r.truncation.includes('drop_last_pick'), false);
  assert.equal(r.picks_included, 2);
  assert.ok(r.char_count <= MAX_CHARS);
});

test('sms: a single marked pick that cannot fit loses the marker before its why', () => {
  const r = composeItinerary({ picks: [{ ...longPick(1, 'both'), name: 'N'.repeat(250) }] });
  assert.ok(r.char_count <= MAX_CHARS);
  const seen = r.truncation;
  assert.ok(seen.includes('drop_marker'));
  if (seen.includes('drop_why')) assert.ok(seen.indexOf('drop_marker') < seen.indexOf('drop_why'));
});

test('sms: without a marker, drop_marker never appears in truncation', () => {
  const pick = (n) => ({ name: `Place Number ${n}`, why: 'Fans of Sturgill Simpson and Wes Anderson love it', url: `https://example.com/p${n}` });
  const r = composeItinerary({ picks: [1, 2, 3, 4, 5].map(pick) });
  assert.equal(r.truncation.includes('drop_marker'), false);
});
