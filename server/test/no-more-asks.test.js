// A guest is never asked for more input to unlock a pick. When a taste cannot drive a request,
// the server falls back on its own; films and shows come fresh; indie caps popularity; a title
// is never offered twice on one call; a bare genre word is a genre, never an album.
//
// Fake Qloo clients with fx ids only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UpstreamError } from '../lib/errors.js';
import { crossDomain, LESSER_KNOWN_MAX } from '../tools/cross-domain.js';
import { bareKindWords, mediaGenresOf, resolveTaste } from '../tools/resolve-taste.js';
import { UNUSABLE_TASTE_SAY } from '../tools/places.js';

const HORROR = 'urn:tag:genre:media:horror';
const DRAMA = 'urn:tag:genre:media:drama';
const NOW = () => new Date('2026-10-25T12:00:00Z');
const SHOW = { id: 'fx-show-too-new', name: 'Fx Too New Show' };
const unusable = () => new UpstreamError('All of the provided signal.interests.entities were invalid', { service: 'qloo', code: 'bad_request', status: 400 });

/** An entity signal is always "invalid" (the show is too new); everything else answers. */
function fake({ entityTags = [HORROR, DRAMA], entityType = 'tv_show', lookupFails = false, empty = () => false } = {}) {
  const sent = [];
  let n = 0;
  return {
    sent,
    async entities() {
      if (lookupFails) throw new UpstreamError('down', { service: 'qloo', code: 'timeout' });
      return { entities: [{ entity_id: SHOW.id, name: SHOW.name, type: entityType, tags: entityTags.map((t) => ({ tag_id: t, name: t.split(':').pop() })) }], call: { endpoint: '/entities' } };
    },
    async insights(params) {
      sent.push(params);
      if (params['signal.interests.entities']) throw unusable();
      if (empty(params)) return { entities: [], body: {}, call: {} };
      n += 1;
      return { entities: [{ entity_id: `fx-pick-${n}`, name: `Fx Pick ${n}`, type: 'movie', year: 2025, summary: 'A made-up film for the tests.' }], body: {}, call: { endpoint: '/v2/insights' } };
    },
  };
}

test('no server say line asks the guest for more', () => {
  assert.doesNotMatch(UNUSABLE_TASTE_SAY, /tell me|one more|something else|\?/i);
  for (const file of ['../tools/places.js', '../tools/cross-domain.js', '../tools/recommend-nearby.js']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /tell me one more|give me something else|what's it most like/i, file);
  }
});

test('fallback 1: a taste Qloo cannot use falls back on the genres it carries, as the filter, still fresh', async () => {
  const qloo = fake();
  const r = await crossDomain({ taste: [SHOW], target: 'movie', take: 1 }, { qloo, now: NOW });
  assert.equal(r.status, 'ok');
  assert.equal(r.fallback, 'genre_tags');
  assert.equal(r.say, undefined, 'a pick that matched says nothing about the vibe');
  const last = qloo.sent.at(-1);
  assert.equal(last['filter.tags'], HORROR);
  assert.equal(last['signal.interests.entities'], undefined);
  assert.equal(last['filter.release_year.min'], '2023');
  assert.match(r.results[0].why, /vein of Fx Too New Show/);
  assert.doesNotMatch(r.results[0].why, /Fans of/);
});

test('fallback 2: no genres to go on, the show is tried toward shows, then the recent releases carry the pick', async () => {
  const qloo = fake({ entityTags: [], entityType: 'tv_show' });
  const r = await crossDomain({ taste: [SHOW], target: 'movie', take: 1 }, { qloo, now: NOW });
  assert.ok(qloo.sent.some((p) => p['filter.type'] === 'urn:entity:tv_show' && p['signal.interests.entities']), 'the show was tried toward shows');
  assert.equal(r.status, 'ok');
  assert.equal(r.fallback, 'recent_by_vibe');
  assert.equal(qloo.sent.at(-1)['filter.release_year.min'], '2023');
});

test('fallback 4: every step fails, the answer is empty with a line that asks for nothing', async () => {
  const qloo = { async entities() { return { entities: [], call: {} }; }, async insights() { throw unusable(); } };
  const r = await crossDomain({ taste: [SHOW], target: 'movie', take: 1 }, { qloo, now: NOW });
  assert.equal(r.status, 'empty');
  assert.doesNotMatch(r.say, /\?|tell me|one more/i);
  assert.match(r.next, /Do not ask the guest/);
});

test('fallback 3: the lookup is down, the other tags of the call still carry a pick', async () => {
  const qloo = fake({ lookupFails: true });
  const r = await crossDomain({ taste: [SHOW, { id: HORROR, name: 'Horror' }], target: 'tv_show', take: 1 }, { qloo, now: NOW });
  assert.equal(r.status, 'ok');
  assert.equal(qloo.sent.at(-1)['filter.tags'], HORROR);
});

test('a film or show defaults to the last three years; older_ok lifts it; a book never gets it', async () => {
  const qloo = fake();
  await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie' }, { qloo, now: NOW });
  await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', older_ok: true }, { qloo, now: NOW });
  await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'book' }, { qloo, now: NOW });
  assert.deepEqual(qloo.sent.map((p) => p['filter.release_year.min']), ['2023', undefined, undefined]);
});

test('lesser_known caps popularity; no cap otherwise; an empty capped answer is asked again uncapped', async () => {
  const qloo = fake({ empty: (p) => Boolean(p['filter.popularity.max']) });
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', lesser_known: true }, { qloo, now: NOW });
  assert.equal(qloo.sent[0]['filter.popularity.max'], String(LESSER_KNOWN_MAX));
  assert.equal(qloo.sent[1]['filter.popularity.max'], undefined);
  assert.equal(qloo.sent[1]['filter.release_year.min'], undefined);
  assert.equal(r.status, 'ok');
  assert.equal(r.bound, 'relaxed');
});

test('a title offered on this call is excluded from the next answer on the same call only', async () => {
  const qloo = fake();
  const a = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', session_id: 'probe-x' }, { qloo, now: NOW });
  await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', session_id: 'probe-x' }, { qloo, now: NOW });
  await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'movie', session_id: 'probe-y' }, { qloo, now: NOW });
  assert.equal(qloo.sent[0]['filter.exclude.entities'], undefined);
  assert.equal(qloo.sent[1]['filter.exclude.entities'], a.results[0].entity_id);
  assert.equal(qloo.sent[2]['filter.exclude.entities'], undefined);
});

test('place tastes only, toward a film: a recent pick from the mood, not a question', async () => {
  const qloo = fake();
  const r = await crossDomain({ taste: [{ id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai' }], target: 'movie' }, { qloo, now: NOW });
  assert.equal(r.status, 'ok');
  assert.equal(r.fallback, 'recent_by_vibe');
});

test('bare genre and kind words never reach /search: fiction is a genre, novel is a kind', async () => {
  assert.deepEqual(mediaGenresOf('fiction'), ['fiction']);
  assert.deepEqual(mediaGenresOf('non-fiction'), ['documentary']);
  assert.ok(bareKindWords('novel') && bareKindWords('a good movie') && !bareKindWords('The Good Place') && !bareKindWords('Fiction Plane'));
  const sent = [];
  const qloo = {
    async tags(q) { sent.push(['tags', q.query]); return { tags: q.query === 'fiction' ? [{ tag_id: 'urn:tag:genre:media:fiction', name: 'Fiction' }] : [], call: {} }; },
    async search(q) { sent.push(['search', q.query]); return { entities: [{ entity_id: 'fx-album-fiction', name: 'Fiction', type: 'album' }], call: {} }; },
  };
  const r = await resolveTaste({ mentions: ['fiction', 'novel'] }, { qloo });
  assert.deepEqual(r.resolved.map((x) => x.id), ['urn:tag:genre:media:fiction']);
  assert.ok(!sent.some(([kind]) => kind === 'search'), JSON.stringify(sent));
  assert.deepEqual(r.unresolved, []);
});
