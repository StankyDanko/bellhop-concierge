// A genre or mood word for film, television, or books resolves to a media genre tag, never a
// place tag, and cross_domain filters a film, show, or book request by that genre.
//
// The bug this holds: a guest liked "a horror thriller show", resolve_taste matched the place tag
// glass_mirror_shop, and cross_domain answered with unrelated movies. Fake client, fx ids only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaGenresOf, resolveTaste } from '../tools/resolve-taste.js';
import { crossDomain, mediaTaste } from '../tools/cross-domain.js';
import { isMediaGenreTag, isPlaceTag } from '../tools/places.js';
import { tasteSignals } from '../lib/validate.js';

const HORROR = 'urn:tag:genre:media:horror';
const THRILLER = 'urn:tag:genre:media:thriller';
const SHOP = 'urn:tag:category:place:fx_glass_mirror_shop';
const GENRE_TAGS = {
  horror: [{ tag_id: 'urn:tag:keyword:qloo:fx_terror', name: 'Terror' }, { tag_id: HORROR, name: 'Horror' }],
  thriller: [{ tag_id: THRILLER, name: 'Thriller' }],
  'science fiction': [{ tag_id: 'urn:tag:genre:media:science_fiction', name: 'Science Fiction' }],
  'true crime': [{ tag_id: 'urn:tag:genre:media:true_crime', name: 'True Crime' }],
  'horror thriller show': [{ tag_id: SHOP, name: 'Glass Mirror Shop' }],
};

function fakeResolver() {
  const sent = [];
  const qloo = {
    async tags(q) { sent.push({ endpoint: '/v2/tags', ...q }); return { tags: GENRE_TAGS[q.query] ?? [], call: { endpoint: '/v2/tags' } }; },
    async search(q) { sent.push({ endpoint: '/search', ...q }); return { entities: [], call: { endpoint: '/search' } }; },
  };
  return { qloo, sent };
}

test('mediaGenresOf: genre and kind words only', () => {
  const cases = {
    'horror thriller show': ['horror', 'thriller'], 'a horror movie': ['horror'], 'sci-fi': ['science fiction'], 'Sci Fi series': ['science fiction'],
    'true crime': ['true crime'], 'rom com': ['romance', 'comedy'], 'documentaries': ['documentary'], anime: ['anime'], 'comedy shows': ['comedy'],
    'horror bar': [], 'Wes Anderson films': [], 'Porch Band': [], 'thai food': [], 'jazz music': [], '': [],
  };
  for (const [mention, genres] of Object.entries(cases)) assert.deepEqual(mediaGenresOf(mention), genres, mention);
});

test('resolve_taste: "horror thriller show" is two media genre tags, from movie-scoped tags, never /search or a place tag', async () => {
  const { qloo, sent } = fakeResolver();
  const r = await resolveTaste({ mentions: ['horror thriller show'] }, { qloo });
  assert.deepEqual(r.resolved.map((x) => x.id), [HORROR, THRILLER]);
  assert.ok(r.resolved.every((x) => x.domain === 'media' && x.kind === 'tag'));
  assert.equal(r.echo_line, 'horror thriller show');
  assert.ok(sent.every((s) => s.endpoint === '/v2/tags' && s.parentsType === 'movie'), JSON.stringify(sent));
  assert.deepEqual(sent.map((s) => s.query).sort(), ['horror', 'thriller']);
});

test('resolve_taste: a genre with no media genre tag comes back unresolved, not as whatever tag matched', async () => {
  const qloo = { async tags() { return { tags: [{ tag_id: SHOP, name: 'Shop' }], call: {} }; }, async search() { return { entities: [], call: {} }; } };
  const r = await resolveTaste({ mentions: ['horror show'] }, { qloo });
  assert.deepEqual(r.resolved, []);
  assert.deepEqual(r.unresolved, ['horror show']);
});

test('tag kinds: media genre and place tags tell apart', () => {
  assert.ok(isMediaGenreTag(HORROR) && !isMediaGenreTag(SHOP) && !isMediaGenreTag('urn:tag:genre:place:restaurant:thai'));
  for (const id of [SHOP, 'urn:tag:genre:place:restaurant:thai', 'urn:tag:specialty_dish:place:x', 'urn:tag:ambience:qloo:cozy']) assert.ok(isPlaceTag(id), id);
  for (const id of [HORROR, 'urn:tag:keyword:qloo:horror', 'urn:tag:genre:music:jazz']) assert.ok(!isPlaceTag(id), id);
});

test('mediaTaste: a place tag is never a media signal; a genre becomes the filter, not a signal', () => {
  const t = tasteSignals([{ id: SHOP, name: 'Shop' }, { id: HORROR, name: 'Horror' }, { id: 'fx-movie-1', name: 'Fx Film' }]);
  const m = mediaTaste(t, 'movie');
  assert.deepEqual(m.genres, [HORROR]);
  assert.deepEqual(m.taste.signals.map((s) => s.id), ['fx-movie-1']);
  assert.deepEqual(m.taste.tagIds, []);
  // A music target keeps the genre as a signal (it is not a film, show, or book request).
  const a = mediaTaste(t, 'artist');
  assert.deepEqual(a.genres, []);
  assert.deepEqual(a.taste.tagIds, [HORROR]);
});

/** A fake Qloo for cross_domain that writes every insights request down. */
function fakeInsights() {
  const sent = [];
  const qloo = {
    async insights(params) {
      sent.push(params);
      const g = (params['filter.tags'] ?? 'none').split(':').pop();
      const summary = 'A made-up title for the tests.';
      return { entities: [{ entity_id: `fx-${g}-1`, name: `Fx ${g} one`, type: 'movie', summary }, { entity_id: `fx-${g}-2`, name: `Fx ${g} two`, type: 'movie', summary }], body: {}, call: { endpoint: '/v2/insights' } };
    },
  };
  return { qloo, sent };
}

test('cross_domain: a lone genre filters the target type by that genre and sends no signal', async () => {
  const { qloo, sent } = fakeInsights();
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }], target: 'book', take: 2 }, { qloo, toolSecret: 'fx-secret' });
  assert.equal(r.status, 'ok');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]['filter.type'], 'urn:entity:book');
  assert.equal(sent[0]['filter.tags'], HORROR);
  assert.equal(sent[0]['signal.interests.tags'], undefined);
  assert.deepEqual(r.genre_filter, [HORROR]);
});

test('cross_domain: a place tag alongside a genre never reaches Qloo', async () => {
  const { qloo, sent } = fakeInsights();
  await crossDomain({ taste: [{ id: SHOP, name: 'Shop' }, { id: HORROR, name: 'Horror' }], target: 'movie' }, { qloo });
  assert.ok(!JSON.stringify(sent).includes('place'), JSON.stringify(sent));
});

test('cross_domain: only a place tag toward a film is an empty answer with a line to say, no call', async () => {
  const { qloo, sent } = fakeInsights();
  const r = await crossDomain({ taste: [{ id: SHOP, name: 'Shop' }], target: 'book' }, { qloo });
  assert.equal(r.status, 'empty');
  assert.equal(r.reason, 'no_media_signal');
  assert.equal(sent.length, 0);
});

test('cross_domain: two genres are two calls dealt out in turn, so each genre is heard', async () => {
  const { qloo, sent } = fakeInsights();
  const r = await crossDomain({ taste: [{ id: HORROR, name: 'Horror' }, { id: THRILLER, name: 'Thriller' }], target: 'movie', take: 4 }, { qloo });
  assert.deepEqual(sent.map((s) => s['filter.tags']).sort(), [HORROR, THRILLER]);
  assert.deepEqual(r.results.map((x) => x.name), ['Fx horror one', 'Fx thriller one', 'Fx horror two', 'Fx thriller two']);
});

test('cross_domain: a genre with entity signals keeps the entities as signals and the genre as the filter', async () => {
  const { qloo, sent } = fakeInsights();
  await crossDomain({ taste: [{ id: 'fx-film-9', name: 'Fx Film' }, { id: HORROR, name: 'Horror' }], target: 'tv_show' }, { qloo });
  assert.equal(sent[0]['signal.interests.entities'], 'fx-film-9');
  assert.equal(sent[0]['filter.tags'], HORROR);
  assert.equal(sent[0]['signal.interests.tags'], undefined);
});

test('a mood said for a night in reads as genres, and what the guest does not want is dropped', () => {
  assert.deepEqual(mediaGenresOf('funny romantic movie, nothing heavy'), ['comedy', 'romance']);
  assert.deepEqual(mediaGenresOf('a movie that makes me cry'), ['drama']);
  assert.deepEqual(mediaGenresOf('not scary, something funny'), ['comedy']);
  assert.deepEqual(mediaGenresOf('The Grand Budapest Hotel'), []);
});
