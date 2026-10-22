// Vibe phrases: the guest's answer to a two way food choice ("spicy and loud", "slow and
// candlelit") is a mood, not a name. It never goes to /search. Each taste word goes to
// /v2/tags on its own, the trace shows which phrase it came from, budget words stay on
// the server, and the say-back line uses the guest's own words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureTransport } from '../lib/transport.js';
import { VIBE_PHRASES, vibeOf } from '../tools/resolve-taste.js';
import { callTool, makeApp } from './helpers.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const FILES = { '/search': 'qloo.search', '/v2/tags': 'qloo.tags', '/v2/insights': 'qloo.insights', '/v2/analysis/compare': 'qloo.compare' };

/** The mock fixtures, with every request written down. `empty` lists tag queries that find nothing. */
function recording({ empty = [] } = {}) {
  const inner = fixtureTransport({ service: 'qloo', dir: FIXTURES, files: FILES });
  const sent = [];
  const transport = async (endpoint, params) => {
    sent.push({ endpoint, params });
    if (endpoint === '/v2/tags' && empty.includes(params['filter.query'])) return { status: 200, body: { success: true, results: { tags: [] } } };
    return inner(endpoint, params);
  };
  return { transport, sent };
}

async function resolve(body, opts) {
  const rec = recording(opts);
  const { app } = makeApp({ qlooTransport: rec.transport });
  const { status, json } = await callTool(app, 'resolve_taste', body);
  return { status, json, sent: rec.sent };
}

const searches = (sent) => sent.filter((s) => s.endpoint === '/search');
const tagQueries = (sent) => sent.filter((s) => s.endpoint === '/v2/tags').map((s) => s.params['filter.query']);

test('every forced choice the prompt offers is a vibe phrase, and so is each half', () => {
  for (const p of ['spicy and loud', 'slow and candlelit', 'adventurous or familiar', 'loud and fun or quiet and good', 'splurge or easy',
    'adventurous', 'familiar', 'loud and fun', 'quiet and good', 'splurge', 'easy']) {
    assert.ok(vibeOf(p), `${p} should be a vibe phrase`);
  }
  for (const w of ['spicy', 'loud', 'slow', 'candlelit', 'adventurous', 'familiar', 'quiet', 'fun']) {
    assert.ok(Array.isArray(VIBE_PHRASES[w]) && VIBE_PHRASES[w].length, `${w} needs tag words`);
  }
});

test('names and categories that share a word are not vibe phrases', () => {
  for (const m of ['Quiet Riot', 'spicy food', 'Slow Club', 'Sturgill Simpson', 'thai food', 'jazz bars']) assert.equal(vibeOf(m), null, m);
});

test('spicy and loud never reaches /search; each word gets its own tags request', async () => {
  const { status, json, sent } = await resolve({ mentions: ['spicy and loud'] });
  assert.equal(status, 200);
  assert.deepEqual(searches(sent), []);
  assert.deepEqual(tagQueries(sent), ['spicy', 'lively']);
  assert.equal(json.status, 'ok');
  assert.deepEqual(json.resolved.map((r) => [r.mention, r.kind, r.tag_id]), [
    ['spicy and loud', 'tag', 'urn:tag:keyword:place:spicy'],
    ['spicy and loud', 'tag', 'urn:tag:keyword:place:lively'],
  ]);
  assert.deepEqual(json.unresolved, []);
});

test('the trace marks each mapped tags request with the phrase it came from', async () => {
  const { json } = await resolve({ mentions: ['spicy and loud', 'Sturgill Simpson'] });
  const tags = json.trace.filter((e) => e.endpoint === '/v2/tags');
  assert.deepEqual(tags.map((e) => [e.params['filter.query'], e.mapped_from]), [['spicy', 'spicy and loud'], ['lively', 'spicy and loud']]);
  const search = json.trace.filter((e) => e.endpoint === '/search');
  assert.ok(search.length >= 1);
  for (const e of search) assert.equal('mapped_from' in e, false);
  assert.ok(search.every((e) => e.params.query !== 'spicy and loud'));
});

test('candlelit tries romantic first and only asks for intimate when romantic finds nothing', async () => {
  const first = await resolve({ mentions: ['slow and candlelit'] });
  assert.deepEqual(searches(first.sent), []);
  assert.deepEqual(tagQueries(first.sent), ['relaxed', 'romantic']);
  assert.equal(first.json.resolved.length, 2);

  const fallback = await resolve({ mentions: ['slow and candlelit'] }, { empty: ['romantic'] });
  assert.deepEqual(tagQueries(fallback.sent), ['relaxed', 'romantic', 'intimate']);
  assert.deepEqual(fallback.json.resolved.map((r) => r.tag_id), ['urn:tag:keyword:place:relaxed', 'urn:tag:keyword:place:intimate']);
});

test('a word asked twice in one call is requested once', async () => {
  const { sent } = await resolve({ mentions: ['spicy and loud', 'loud and fun'] });
  assert.deepEqual(tagQueries(sent).sort(), ['fun', 'lively', 'spicy']);
});

test('filler words are dropped: quiet and good asks only for quiet', async () => {
  const { json, sent } = await resolve({ mentions: ['quiet and good'] });
  assert.deepEqual(searches(sent), []);
  assert.deepEqual(tagQueries(sent), ['quiet']);
  assert.equal(json.resolved.length, 1);
});

test('budget words never go upstream and come back as a preference', async () => {
  const { json, sent } = await resolve({ mentions: ['splurge'] });
  assert.deepEqual(sent, []);
  assert.deepEqual(json.trace, []);
  assert.deepEqual(json.preferences, { budget: 'splurge' });
  assert.deepEqual(json.resolved, []);
  assert.deepEqual(json.unresolved, []);
  assert.equal(json.status, 'ok');

  const easy = await resolve({ mentions: ['Sturgill Simpson', 'easy'] });
  assert.deepEqual(easy.json.preferences, { budget: 'easy' });
  assert.ok(easy.sent.every((s) => !Object.values(s.params).some((v) => /easy/.test(v))));
});

test('both budget words at once is no preference, and nothing is sent', async () => {
  const { json, sent } = await resolve({ mentions: ['splurge or easy'] });
  assert.deepEqual(sent, []);
  assert.equal(json.preferences, undefined);
});

test('the say-back line uses the guest words, not the tag names', async () => {
  const { json } = await resolve({ mentions: ['Sturgill Simpson', 'spicy and loud'] });
  assert.equal(json.echo_line, 'Sturgill Simpson and spicy and loud');
  assert.doesNotMatch(json.echo_line, /lively/i);
  const solo = await resolve({ mentions: ['slow and candlelit'] });
  assert.equal(solo.json.echo_line, 'slow and candlelit');
});

test('a vibe phrase with no tag found is unresolved, still never searched', async () => {
  const { json, sent } = await resolve({ mentions: ['quiet'] }, { empty: ['quiet'] });
  assert.deepEqual(searches(sent), []);
  assert.deepEqual(json.unresolved, ['quiet']);
});

test('the plus-one can answer the choice too', async () => {
  const { json, sent } = await resolve({ mentions: ['Sturgill Simpson'], companion_mentions: ['slow and candlelit'] });
  assert.ok(searches(sent).every((s) => s.params.query !== 'slow and candlelit'));
  assert.equal(json.companion_resolved.length, 2);
  assert.ok(json.companion_resolved.every((r) => r.who === 'companion' && r.mention === 'slow and candlelit'));
  assert.equal(json.companion_echo_line, 'slow and candlelit');
});

test('the resolved vibe items feed recommend_nearby as tag signals', async () => {
  const { app } = makeApp();
  const r = await callTool(app, 'resolve_taste', { mentions: ['spicy and loud'] });
  const taste = r.json.resolved.map(({ id, name }) => ({ id, name }));
  const rec = await callTool(app, 'recommend_nearby', { taste, lat: 32.079, lng: -81.095 });
  assert.equal(rec.status, 200);
  const insights = rec.json.trace.find((e) => e.endpoint === '/v2/insights');
  assert.match(insights.params['signal.interests.tags'], /urn:tag:keyword:place:lively/);
});

test('both sides of one food choice is no answer: nothing resolves, nothing is sent', async () => {
  for (const p of ['adventurous or familiar', 'spicy or slow', 'loud and fun or quiet and good', 'candlelit or loud']) {
    assert.deepEqual(vibeOf(p)?.tastes, [], p);
    assert.equal(vibeOf(p)?.undecided, true, p);
  }
  assert.equal(vibeOf('spicy and loud').undecided, false);
  const { json, sent } = await resolve({ mentions: ['adventurous or familiar', 'Fx Nobody Band'] }, { empty: ['Fx Nobody Band'] });
  assert.ok(sent.every((s) => !Object.values(s.params).some((v) => /adventurous|comfort food/.test(String(v)))), 'neither side goes upstream');
  assert.deepEqual(json.resolved.filter((r) => r.mention === 'adventurous or familiar'), []);
  assert.ok(!json.unresolved.includes('adventurous or familiar'));
  assert.deepEqual(json.preferences, { undecided: ['adventurous or familiar'] });
});
