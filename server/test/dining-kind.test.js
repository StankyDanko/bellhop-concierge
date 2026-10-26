// recommend_nearby kind: a guest who asks where to eat gets places to eat or drink, never a
// stadium because an artist's fans like one. dining sends the restaurant genre parent tag as
// filter.tags (a cuisine filter already is one and stays alone), activity excludes it, and any
// (or no kind at all) leaves the request as it was. The scope reaches every insights call: the
// relaxed cuisine retry and the counterfactual too.
//
// Fake values only: fx ids, fictional tags and places, a transport that writes requests down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp, PROPERTY } from './helpers.js';
import { DINING_TAG, KINDS, scopeParams } from '../tools/recommend-nearby.js';

const ARTIST = { id: 'fx-artist-porch-band', name: 'Porch Band' };
const FX_THAI = 'urn:tag:genre:place:restaurant:fx_thai';
const THAI = { id: FX_THAI, name: 'Thai food' };
const place = (n, tags = [{ tag_id: 'urn:tag:category:place:restaurant', name: 'restaurant' }]) => ({ entity_id: `fx-place-${n}`, name: `Fx ${n}`, tags, query: { affinity: 0.9 - n / 100 } });

/** A transport that records every insights request and answers with `answer(params)`. */
function recording(answer = () => [place(1), place(2), place(3)]) {
  const sent = [];
  const transport = async (endpoint, params) => {
    sent.push({ endpoint, params: { ...params } });
    return { status: 200, body: { success: true, results: { entities: answer(params) } } };
  };
  return { sent, transport };
}

const placeAsks = (sent) => sent.filter((r) => r.endpoint === '/v2/insights' && r.params['filter.type'] === 'urn:entity:place');

test('kind is dining, drinks, activity, or any', () => {
  assert.deepEqual(KINDS, ['dining', 'drinks', 'activity', 'any']);
  assert.equal(DINING_TAG, 'urn:tag:genre:place:restaurant');
});

test('dining with an artist only: every place ask carries the restaurant genre parent as filter.tags', async () => {
  const { sent, transport } = recording();
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, kind: 'dining' });
  assert.equal(status, 200);
  assert.equal(json.applied.kind, 'dining');
  const asks = placeAsks(sent);
  assert.ok(asks.length >= 1);
  for (const a of asks) assert.equal(a.params['filter.tags'], DINING_TAG, 'the main ask and the counterfactual are both dining');
  assert.ok(asks.some((a) => !Object.keys(a.params).some((k) => k.startsWith('signal.'))), 'the counterfactual ran, scoped the same way');
});

test('no kind, and kind any, send no filter.tags for an artist-only taste (backward compatible)', async () => {
  for (const extra of [{}, { kind: 'any' }]) {
    const { sent, transport } = recording();
    const { app } = makeApp({ qlooTransport: transport });
    const { status, json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, ...extra });
    assert.equal(status, 200);
    assert.equal(json.applied.kind, 'any');
    for (const a of placeAsks(sent)) {
      assert.equal(a.params['filter.tags'], undefined);
      assert.equal(a.params['filter.exclude.tags'], undefined);
    }
  }
});

test('dining with a cuisine: the cuisine is the filter alone, and a relaxed retry falls back to dining, not everything', async () => {
  // The cuisine filter finds one place; the server relaxes it once.
  const { sent, transport } = recording((p) => (p['filter.tags'] === FX_THAI ? [place(1, [{ tag_id: FX_THAI, name: 'Thai' }])] : [place(2), place(3), place(4)]));
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY, kind: 'dining' });
  assert.equal(status, 200);
  assert.equal(json.applied.cuisine_filter, 'relaxed');
  const tagsSent = placeAsks(sent).map((a) => a.params['filter.tags']);
  assert.equal(tagsSent[0], FX_THAI, 'two tags in one filter.tags mean either one, so the cuisine goes alone');
  assert.equal(tagsSent[1], DINING_TAG, 'the relaxed retry is still places to eat or drink');
  assert.ok(tagsSent.every(Boolean), 'no place ask went out unscoped');
});

test('activity: the restaurant genre is excluded, and a cuisine is a signal only', async () => {
  const { sent, transport } = recording();
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY, kind: 'activity' });
  assert.equal(status, 200);
  assert.equal(json.applied.kind, 'activity');
  assert.equal(json.applied.cuisine_filter, null);
  for (const a of placeAsks(sent)) {
    assert.equal(a.params['filter.exclude.tags'], DINING_TAG);
    assert.equal(a.params['filter.tags'], undefined);
  }
  assert.ok(placeAsks(sent).some((a) => String(a.params['signal.interests.tags'] ?? '').includes(FX_THAI)), 'the cuisine still rides as a signal');
});

test('an unknown kind is a 400, never a silent any', async () => {
  const { transport } = recording();
  const { app } = makeApp({ qlooTransport: transport });
  const { status } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, kind: 'stadium' });
  assert.equal(status, 400);
});

test('scopeParams leaves non-place asks and the per-person shortlist scoring alone', () => {
  const artistAsk = { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': 'fx-a' };
  assert.deepEqual(scopeParams(artistAsk, 'dining'), artistAsk);
  const shortlist = { 'filter.type': 'urn:entity:place', 'filter.results.entities': 'fx-place-1,fx-place-2' };
  assert.deepEqual(scopeParams(shortlist, 'activity'), shortlist);
  assert.equal(scopeParams({ 'filter.type': 'urn:entity:place', 'filter.exclude.tags': DINING_TAG }, 'activity')['filter.exclude.tags'], DINING_TAG, 'never doubled');
});

const BAR = 'urn:tag:genre:place:restaurant:bar';
const MEDIA = { id: 'urn:tag:genre:media:psychological_thriller', name: 'Psychological thriller' };

test('drinks: every place ask is filtered to the bar genres, and only bars come back', async () => {
  const { sent, transport } = recording();
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST], ...PROPERTY, kind: 'drinks' });
  assert.equal(status, 200);
  assert.equal(json.applied.kind, 'drinks');
  for (const a of placeAsks(sent)) assert.match(a.params['filter.tags'], new RegExp(`^${BAR},`));
});

test('a film or show genre is never sent to a place search, with or without other tastes', async () => {
  for (const taste of [[MEDIA], [MEDIA, ARTIST]]) {
    const { sent, transport } = recording();
    const { app } = makeApp({ qlooTransport: transport });
    const { status } = await callTool(app, 'recommend_nearby', { taste, ...PROPERTY, kind: 'drinks' });
    assert.equal(status, 200);
    for (const a of placeAsks(sent)) {
      assert.ok(!JSON.stringify(a.params).includes('genre:media'), JSON.stringify(a.params));
    }
  }
});
