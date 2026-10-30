// A film or show is pitched by its premise: described titles come first, a short is never
// pitched for a night in, and an undescribed answer under the freshness bound is asked once more
// without the year floor before it is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossDomain, MIN_RUNTIME_MINUTES, MEDIA_POOL, HORROR_TAG } from '../tools/cross-domain.js';
import { buildWhy } from '../lib/why.js';
import { normalizeEntity } from '../lib/qloo.js';

const NOW = () => new Date('2026-10-30T20:00:00Z');
const HORROR = 'urn:tag:genre:media:horror';
const film = (id, extra = {}) => ({ entity_id: id, name: `Fx ${id}`, type: 'movie', year: 2026, ...extra });

function fakeQloo(answer) {
  const sent = [];
  return { sent, async insights(params) { sent.push(params); return { entities: answer(params), body: {}, call: { endpoint: '/v2/insights' } }; } };
}

test('an undescribed recent answer is asked again without the year floor, and the described titles lead', async () => {
  const qloo = fakeQloo((p) => (p['filter.release_year.min']
    ? [film('fx-new-short')]
    : [film('fx-older', { year: 2019, summary: 'A made-up film about a lighthouse keeper.' })]));
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', take: 2 }, { qloo, now: NOW });
  assert.equal(qloo.sent.length, 2);
  assert.equal(qloo.sent[0]['filter.release_year.min'], '2023');
  assert.equal(qloo.sent[1]['filter.release_year.min'], undefined);
  assert.deepEqual(r.results.map((x) => x.entity_id), ['fx-older', 'fx-new-short']);
  assert.equal(r.bound, 'described');
});

test('a described recent answer needs no second call, and keeps described titles first', async () => {
  const qloo = fakeQloo(() => [film('fx-bare'), film('fx-told', { summary: 'A made-up film about a road trip.' })]);
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', take: 2 }, { qloo, now: NOW });
  assert.equal(qloo.sent.length, 1);
  assert.deepEqual(r.results.map((x) => x.entity_id), ['fx-told', 'fx-bare']);
});

test('nothing described anywhere still answers with the undescribed titles', async () => {
  const qloo = fakeQloo(() => [film('fx-only')]);
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', take: 1 }, { qloo, now: NOW });
  assert.equal(r.status, 'ok');
  assert.equal(r.results[0].entity_id, 'fx-only');
  assert.equal(r.results[0].description, null);
});

test('a short is never pitched; a title with no runtime on file is kept', async () => {
  const qloo = fakeQloo(() => [
    film('fx-four-minutes', { duration: 4, summary: 'A made-up short film.' }),
    film('fx-feature', { duration: 104, summary: 'A made-up feature film.' }),
    film('fx-no-runtime', { summary: 'A made-up film with no runtime listed.' }),
  ]);
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', take: 3 }, { qloo, now: NOW });
  assert.deepEqual(r.results.map((x) => x.entity_id), ['fx-feature', 'fx-no-runtime']);
  assert.ok(MIN_RUNTIME_MINUTES >= 30);
});

test('normalizeEntity reads a runtime only when it is a number', () => {
  assert.equal(normalizeEntity({ entity_id: 'x', properties: { duration: 98 } }).duration, 98);
  assert.equal(normalizeEntity({ entity_id: 'x', properties: { duration: '98 min' } }).duration, null);
  assert.equal(normalizeEntity({ entity_id: 'x', properties: {} }).duration, null);
});

test('a result Qloo did not attribute never says "strong match"', () => {
  const signals = [{ id: 'fx-artist-a', name: 'Fx Artist' }];
  assert.equal(buildWhy({ explainability: null, tags: [] }, signals).why, '');
  assert.doesNotMatch(buildWhy({ explainability: null }, signals).why, /strong match/i);
});

test('one film asked for is still chosen from a pool, so a described title leads', async () => {
  const qloo = fakeQloo((p) => [film('fx-bare'), film('fx-told', { summary: 'A made-up film about a late train.' })].slice(0, Number(p.take)));
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', take: 1 }, { qloo, now: NOW });
  assert.equal(qloo.sent[0].take, String(MEDIA_POOL));
  assert.deepEqual(r.results.map((x) => x.entity_id), ['fx-told']);
});

test('horror is left out unless the guest asked for something scary', async () => {
  const comedy = fakeQloo(() => [film('fx-told', { summary: 'A made-up comedy.' })]);
  await crossDomain({ taste: [{ id: 'urn:tag:genre:media:comedy', name: 'Comedy' }], target: 'movie', take: 1 }, { qloo: comedy, now: NOW });
  assert.equal(comedy.sent[0]['filter.exclude.tags'], HORROR_TAG);
  const scary = fakeQloo(() => [film('fx-told', { summary: 'A made-up horror film.' })]);
  await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', take: 1 }, { qloo: scary, now: NOW });
  assert.equal(scary.sent[0]['filter.exclude.tags'], undefined);
});
