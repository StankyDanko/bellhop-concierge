// The counterfactual as a whole-list contrast: the town's top five with no taste signal next
// to the guest's top five, how many overlap, how popular each list is, and an honest sentence
// for both outcomes (moved, or the town agrees). All ids and places here are invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { describeContrast, LIST_DEPTH, withListOf } from '../tools/counterfactual.js';

const place = (n, popularity = null) => ({ name: `Fx Place ${n}`, entity_id: `fx-place-${n}`, popularity });
const pick = (n) => ({ ...place(n), why: 'Fans of Fx Band love it', why_trace: { basis: 'explainability', drivers: [{ id: 'fx-band', name: 'Fx Band', score: 0.5 }] } });
const town = [place('a', 0.99), place('b', 0.97), place('c', 0.95), place('d', 0.93), place('e', 0.91)];

test('contrast: two of three picks off the town list says so, with overlap, moved and popularity', () => {
  const picks = [pick('x'), pick('c'), pick('y')];
  const ranked = [place('x', 0.6), place('c', 0.95), place('y', 0.7), place('z', 0.5), place('a', 0.99), place('w', 0.4)];
  const cf = describeContrast(town, picks, 'restaurant', { ranked });
  assert.equal(cf.verdict, 'moved');
  assert.equal(cf.same, false);
  assert.deepEqual(cf.with_list.map((p) => p.entity_id), ['fx-place-x', 'fx-place-c', 'fx-place-y', 'fx-place-z', 'fx-place-a']);
  assert.deepEqual(cf.without_list.map((p) => p.entity_id), town.map((p) => p.entity_id));
  assert.equal(cf.overlap5, 2);
  assert.equal(cf.moved5, 3);
  assert.equal(cf.picks_outside, 2);
  assert.deepEqual(cf.popularity_mean, { without: 0.95, with: 0.75 });
  assert.equal(cf.say, 'Your tastes moved the answer: two of the three restaurants Qloo ranked are not among the five most popular nearby.');
  // Each list item is a name and an id, nothing else.
  assert.deepEqual(Object.keys(cf.with_list[0]).sort(), ['entity_id', 'name']);
  // The old top-1 line rides along.
  assert.equal(cf.top1.same, false);
  assert.match(cf.top1.say, /^Without your tastes, the top pick would be Fx Place a\. With them, it is Fx Place x, because fans of Fx Band go there\.$/);
  assert.equal(cf.without_qloo_taste.name, 'Fx Place a');
  assert.equal(cf.with_qloo.name, 'Fx Place x');
});

test('contrast: when every place with taste is on the town list, the town agrees, plainly', () => {
  const cf = describeContrast(town, [pick('a'), pick('b'), pick('c')], 'place', { ranked: [place('a'), place('b'), place('c'), place('d'), place('e')] });
  assert.equal(cf.verdict, 'agrees');
  assert.equal(cf.same, true);
  assert.equal(cf.overlap5, 5);
  assert.equal(cf.moved5, 0);
  assert.equal(cf.say, 'Here your taste and the town agree: all five of your top places are among the five most popular nearby.');
  assert.equal(cf.top1.same, true);
  assert.equal(cf.popularity_mean.with, null, 'no popularity on the fakes, so no mean is invented');
});

test('contrast: popular picks with a changed tail say what changed, never more', () => {
  const cf = describeContrast(town, [pick('a'), pick('b')], 'place', { ranked: [place('a'), place('b'), place('q'), place('r'), place('c')] });
  assert.equal(cf.verdict, 'moved');
  assert.equal(cf.picks_outside, 0);
  assert.equal(cf.say, 'Your picks are popular nearby too, and your tastes changed the rest: two of your top five are not among the town\'s most popular.');
  assert.equal(cf.top1.same, true, 'the top pick agrees even though the list moved');
});

test('contrast: no list on either side is no counterfactual; the with-list never repeats or overflows', () => {
  assert.equal(describeContrast([], [pick('a')]), null);
  assert.equal(describeContrast(town, []), null);
  const many = Array.from({ length: 9 }, (_, i) => place(`m${i}`));
  assert.equal(withListOf([pick('m0'), pick('m3')], many).length, LIST_DEPTH);
  assert.deepEqual(withListOf([pick('m3')], many).map((p) => p.entity_id).slice(0, 2), ['fx-place-m3', 'fx-place-m0']);
});

test('recommend_nearby: the counterfactual carries both lists and the aggregate signal effects', async () => {
  const signaled = [
    { name: 'Fx Noodle Room', entity_id: 'fx-place-noodle', popularity: 0.62, tags: [], query: { affinity: 0.9 } },
    { name: 'Fx Corner Tavern', entity_id: 'fx-place-tavern', popularity: 0.8, tags: [{ tag_id: 'urn:tag:fx:bar', name: 'Pub' }], query: { affinity: 0.88 } },
    { name: 'Fx Garden Cafe', entity_id: 'fx-place-garden', popularity: 0.7, tags: [], query: { affinity: 0.85 } },
    { name: 'Fx Big Diner', entity_id: 'fx-place-big-diner', popularity: 0.98, tags: [], query: { affinity: 0.8 } },
  ];
  const unsignaled = [
    { name: 'Fx Big Diner', entity_id: 'fx-place-big-diner', popularity: 0.98, tags: [] },
    { name: 'Fx Sports Bar', entity_id: 'fx-place-sports', popularity: 0.96, tags: [{ tag_id: 'urn:tag:fx:bar', name: 'Sports Bar' }] },
    { name: 'Fx Pancake House', entity_id: 'fx-place-pancake', popularity: 0.94, tags: [] },
  ];
  const aggregate = { 'signal.interests.entities': {
    effect_on_top3_recs: [{ entity_id: 'fx-artist-sturgill-simpson', avg_score: 0.5 }],
    effect_on_top5_recs: [{ entity_id: 'fx-artist-sturgill-simpson', avg_score: 0.4 }],
    effect_on_top10_recs: [], effect_on_all_recs: [],
  } };
  const transport = async (_endpoint, params) => {
    const isSignaled = Object.keys(params).some((k) => k.startsWith('signal.'));
    return { status: 200, body: isSignaled
      ? { success: true, results: { entities: signaled }, query: { explainability: aggregate } }
      : { success: true, results: { entities: unsignaled } } };
  };
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', {
    taste: [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' }], ...PROPERTY, take: 2, constraints: { kids: true },
  });
  const cf = json.counterfactual;
  // Kids drops the tavern from the picks and the sports bar from the town list alike.
  assert.deepEqual(cf.with_list.map((p) => p.name), ['Fx Noodle Room', 'Fx Garden Cafe', 'Fx Big Diner']);
  assert.deepEqual(cf.without_list.map((p) => p.name), ['Fx Big Diner', 'Fx Pancake House']);
  assert.equal(cf.overlap5, 1);
  assert.equal(cf.moved5, 2);
  assert.equal(cf.picks_outside, 2);
  assert.deepEqual(cf.popularity_mean, { without: 0.96, with: 0.77 });
  assert.deepEqual(cf.signal_effects, [{ id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson', top3: 0.5, top5: 0.4, top10: null, all: null }]);
});
