// A guest's stated cuisine and vibe move the picks.
//
// resolve_taste: a food or place word asks /v2/tags scoped to place tags, never /search, and
// a food word takes the restaurant genre tag. recommend_nearby and cross_domain to places
// send that genre tag as a hard filter.tags (still a signal too), retry once without it when
// nothing nearby fits, and say which happened. Every pick names its own cuisine and feel tags.
//
// Fake values only: fx ids, fictional tags and places.
//
// The resolve_taste cases call the tool with a fake client, so they never reach the PII
// guard. Through the real client, filter.parents.types=urn:entity:place needs the guard
// line staged as lane-W2A/pii-guard.patch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuisineCore, placeShape, resolveTaste } from '../tools/resolve-taste.js';
import { isCuisineTag, pickTagNames, placeTasteParams, relaxCuisine, shapePlace, tagMatchDrivers } from '../tools/places.js';
import { callTool, makeApp, PROPERTY } from './helpers.js';

const FX_THAI = 'urn:tag:genre:place:restaurant:fx_thai';
const FX_ITALIAN = 'urn:tag:genre:place:restaurant:fx_italian';
const FX_COZY = 'urn:tag:ambience:qloo:fx_cozy';
const FX_DISH = 'urn:tag:specialty_dish:place:fx_noodles';
const ARTIST = { id: 'fx-artist-porch-band', name: 'Porch Band' };
const THAI = { id: FX_THAI, name: 'Thai food' };
const COZY = { id: FX_COZY, name: 'Cozy' };

/** A fake Qloo client for resolve_taste that writes every request down. */
function fakeResolver({ tags = {}, search = {} } = {}) {
  const sent = [];
  const qloo = {
    async tags(q) { sent.push({ endpoint: '/v2/tags', ...q }); return { tags: tags[q.query] ?? [], call: { endpoint: '/v2/tags' } }; },
    async search(q) { sent.push({ endpoint: '/search', ...q }); return { entities: search[q.query] ?? [], call: { endpoint: '/search' } }; },
  };
  return { qloo, sent };
}

// ---------------------------------------------------------------------------
// resolve_taste
// ---------------------------------------------------------------------------

test('placeShape: food words and place words, never names or music and film categories', () => {
  const cases = {
    'thai food': 'food', 'italian food': 'food', 'thia food': 'food', sushi: 'food', bbq: 'food', steakhouse: 'food',
    'mexican restaurants': 'food', 'tex mex': 'food', 'soul food': 'food',
    'jazz bars': 'place', 'quiet spots': 'place',
    'Porch Band': null, 'jazz music': null, 'Wes Anderson films': null, 'horror movies': null, 'French films': null,
    'Red Hot Chili Peppers': null, jazz: null,
  };
  for (const [mention, shape] of Object.entries(cases)) assert.equal(placeShape(mention), shape, mention);
  assert.equal(cuisineCore('thai food'), 'thai');
  assert.equal(cuisineCore('Mexican restaurants'), 'Mexican');
  assert.equal(cuisineCore('food'), 'food');
  assert.equal(cuisineCore('bbq'), 'barbecue');
});

test('a cuisine asks place tags for its bare word and takes the restaurant genre tag, not the first hit', async () => {
  const { qloo, sent } = fakeResolver({ tags: { italian: [
    { tag_id: FX_DISH, name: 'Fx Noodles' },
    { tag_id: FX_ITALIAN, name: 'Italian' },
  ] } });
  const out = await resolveTaste({ mentions: ['italian food'] }, { qloo });
  assert.deepEqual(sent, [{ endpoint: '/v2/tags', query: 'italian', take: 10, parentsType: 'place' }]);
  assert.equal(out.resolved[0].id, FX_ITALIAN);
  assert.equal(out.resolved[0].name, 'Italian food', 'the name stays in the guest\'s words');
  assert.equal(out.resolved[0].confidence, 1);
});

test('a near miss ranked first never wins over the cuisine the guest named', async () => {
  const { qloo } = fakeResolver({ tags: { steakhouse: [
    { tag_id: 'urn:tag:genre:place:restaurant:fx_tea_house', name: 'Tea house' },
    { tag_id: 'urn:tag:genre:place:restaurant:fx_steak_house', name: 'Steak house' },
  ] } });
  const out = await resolveTaste({ mentions: ['steakhouse'] }, { qloo });
  assert.equal(out.resolved[0].id, 'urn:tag:genre:place:restaurant:fx_steak_house');
  assert.equal(out.resolved[0].confidence, 1);
});

test('a misspelled cuisine keeps the genre tag Qloo ranked first, at low confidence', async () => {
  const { qloo } = fakeResolver({ tags: { thia: [
    { tag_id: FX_THAI, name: 'Thai' },
    { tag_id: FX_DISH, name: 'Fx Noodles' },
  ] } });
  const out = await resolveTaste({ mentions: ['thia food'] }, { qloo });
  assert.equal(out.resolved[0].id, FX_THAI);
  assert.equal(out.resolved[0].confidence, 0.5);
  assert.equal(out.resolved[0].filter_ok, false, 'a weak match is a signal only');
});

test('a cuisine that only weakly matches the guest word stays a signal, never a filter', async () => {
  // The steak house tag is missing from the results, so the best cuisine is a near miss.
  const { qloo } = fakeResolver({ tags: { steakhouse: [
    { tag_id: 'urn:tag:genre:place:restaurant:fx_tea_house', name: 'Tea house' },
    { tag_id: 'urn:tag:keyword:place:fx_steak', name: 'Fx steak cuts' },
  ] } });
  const out = await resolveTaste({ mentions: ['steakhouse'] }, { qloo });
  assert.equal(out.resolved[0].id, 'urn:tag:genre:place:restaurant:fx_tea_house');
  assert.equal(out.resolved[0].filter_ok, false);
  const { transport, sent } = placesTransport();
  const { app } = makeApp({ qlooTransport: transport });
  const taste = out.resolved.map((r) => ({ id: r.id, name: r.name, filter_ok: r.filter_ok }));
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, ...taste], ...PROPERTY });
  assert.ok(sent.every((s) => s.params['filter.tags'] === undefined), 'no tea house filter');
  assert.equal(sent[0].params['signal.interests.tags'], 'urn:tag:genre:place:restaurant:fx_tea_house', 'still a signal');
  assert.equal(json.applied.cuisine_filter, null);
  // A strong match keeps no flag and still filters.
  const good = await resolveTaste({ mentions: ['steakhouse'] }, { qloo: fakeResolver({ tags: { steakhouse: [{ tag_id: 'urn:tag:genre:place:restaurant:fx_steak_house', name: 'Steak house' }] } }).qloo });
  assert.equal(good.resolved[0].filter_ok, undefined);
});

test('bbq is asked as barbecue, the spelling barbecue places are filed under; the guest keeps their word', async () => {
  const { qloo, sent } = fakeResolver({ tags: { barbecue: [{ tag_id: 'urn:tag:genre:place:restaurant:fx_barbecue', name: 'Barbecue restaurant' }] } });
  const out = await resolveTaste({ mentions: ['bbq'] }, { qloo });
  assert.equal(sent[0].query, 'barbecue');
  assert.equal(out.resolved[0].name, 'Bbq');
  assert.ok(isCuisineTag(out.resolved[0].id));
});

test('a bare dish word never reaches /search, so it cannot become an album or a band', async () => {
  const { qloo, sent } = fakeResolver({
    tags: { sushi: [{ tag_id: 'urn:tag:genre:place:restaurant:fx_sushi', name: 'Sushi' }] },
    search: { sushi: [{ entity_id: 'fx-album-sushi', name: 'Sushi', type: 'album' }] },
  });
  const out = await resolveTaste({ mentions: ['sushi'] }, { qloo });
  assert.equal(sent.filter((s) => s.endpoint === '/search').length, 0);
  assert.equal(out.resolved[0].kind, 'tag');
  assert.ok(isCuisineTag(out.resolved[0].id));
});

test('a place word asks place tags as said; vibe words ask place tags; names and music still go their old way', async () => {
  const { qloo, sent } = fakeResolver({
    tags: {
      'jazz bars': [{ tag_id: 'urn:tag:genre:place:bar:fx_jazz', name: 'Jazz Bar' }],
      romantic: [{ tag_id: 'urn:tag:ambience:qloo:fx_romantic', name: 'Romantic' }],
      'jazz music': [{ tag_id: 'urn:tag:genre:music:fx_jazz', name: 'Jazz' }],
    },
    search: { 'Porch Band': [{ entity_id: ARTIST.id, name: 'Porch Band', type: 'artist' }] },
  });
  const out = await resolveTaste({ mentions: ['jazz bars', 'candlelit', 'Porch Band', 'jazz music'] }, { qloo });
  const tagsAsk = (query) => sent.find((s) => s.endpoint === '/v2/tags' && s.query === query);
  assert.equal(tagsAsk('jazz bars').parentsType, 'place');
  assert.equal(tagsAsk('jazz bars').take, 3);
  assert.equal(tagsAsk('romantic').parentsType, 'place');
  assert.equal(tagsAsk('jazz music').parentsType, undefined, 'a music category is not place-scoped');
  assert.ok(sent.some((s) => s.endpoint === '/search' && s.query === 'Porch Band'), 'an artist still goes through /search');
  assert.deepEqual(out.resolved.map((r) => r.kind), ['tag', 'tag', 'entity', 'tag']);
});

test('the place scope travels to Qloo as filter.parents.types (needs lane-W2A/pii-guard.patch)', async () => {
  const sent = [];
  const transport = async (endpoint, params) => {
    sent.push({ endpoint, params });
    return { status: 200, body: { success: true, results: { tags: [{ id: FX_THAI, name: 'Thai' }] } } };
  };
  const { app } = makeApp({ qlooTransport: transport });
  const { status, json } = await callTool(app, 'resolve_taste', { mentions: ['thai food'] });
  assert.equal(status, 200);
  assert.equal(json.resolved[0].id, FX_THAI);
  assert.deepEqual(sent.map((s) => [s.endpoint, s.params['filter.query'], s.params['filter.parents.types'], s.params.take]),
    [['/v2/tags', 'thai', 'urn:entity:place', '10']]);
});

// ---------------------------------------------------------------------------
// recommend_nearby
// ---------------------------------------------------------------------------

const place = (id, tags = [], affinity = 0.8) => ({
  entity_id: id, name: `Fx ${id}`, query: { affinity }, location: { lat: 32.08, lon: -81.09 },
  tags: tags.map(([tag_id, name]) => ({ tag_id, name })), properties: { address: '1 Fx Lane' },
});
const THAI_PLACES = [
  place('fx-place-a', [[FX_THAI, 'Thai'], [FX_COZY, 'Cozy'], ['urn:tag:parking:place:fx_lot', 'Lot']]),
  place('fx-place-b', [[FX_THAI, 'Thai'], ['urn:tag:noise_level:qloo:fx_quiet', 'Quiet']], 0.7),
];
const ANY_PLACES = [place('fx-place-c', [[FX_COZY, 'Cozy']]), place('fx-place-d', [], 0.6)];

/** Answers by request: a cuisine filter gets `filtered`, anything else gets `open`. */
function placesTransport({ filtered = THAI_PLACES, open = ANY_PLACES } = {}) {
  const sent = [];
  const transport = async (endpoint, params) => {
    sent.push({ endpoint, params });
    const ents = params['filter.tags'] ? filtered : open;
    return { status: 200, body: { success: true, results: { entities: ents } } };
  };
  return { transport, sent };
}

test('a stated cuisine is a hard filter.tags and still a signal; a vibe is only a signal', async () => {
  const { transport, sent } = placesTransport();
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI, COZY], ...PROPERTY, take: 2 });
  const first = sent[0].params;
  assert.equal(first['filter.tags'], FX_THAI);
  assert.equal(first['signal.interests.tags'], `${FX_THAI},${FX_COZY}`);
  assert.equal(first['signal.interests.entities'], ARTIST.id);
  assert.equal(json.applied.cuisine_filter, 'hard');
  assert.deepEqual(json.applied.cuisine, ['Thai food']);
  assert.deepEqual(json.places.map((p) => p.entity_id), ['fx-place-a', 'fx-place-b']);
  // The counterfactual is the town's popular list: no taste signal and no cuisine filter.
  const unsignaled = sent.find((s) => !Object.keys(s.params).some((k) => k.startsWith('signal.')));
  assert.equal(unsignaled.params['filter.tags'], undefined);
  assert.equal(sent.length, 2, 'taste call and counterfactual, no retry');
});

test('when the cuisine filter leaves nothing nearby, exactly one retry without it, marked relaxed', async () => {
  const { transport, sent } = placesTransport({ filtered: [] });
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY });
  const tasteCalls = sent.filter((s) => Object.keys(s.params).some((k) => k.startsWith('signal.')));
  assert.equal(tasteCalls.length, 2);
  assert.equal(tasteCalls[0].params['filter.tags'], FX_THAI);
  assert.equal(tasteCalls[1].params['filter.tags'], undefined);
  assert.equal(tasteCalls[1].params['signal.interests.tags'], FX_THAI, 'the cuisine still steers the ranking');
  assert.equal(json.applied.cuisine_filter, 'relaxed');
  assert.deepEqual(json.places.map((p) => p.entity_id), ['fx-place-c', 'fx-place-d']);
  // The counterfactual follows the request that produced the picks.
  assert.equal(sent.at(-1).params['filter.tags'], undefined);
});

test('a filter whose places are all ruled out for kids counts as empty and relaxes', async () => {
  const bars = [place('fx-place-bar', [[FX_THAI, 'Thai'], ['urn:tag:category:place:fx_bar', 'Cocktail Bar']])];
  const { transport } = placesTransport({ filtered: bars });
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY, constraints: { kids: true } });
  assert.equal(json.applied.cuisine_filter, 'relaxed');
  assert.ok(json.places.every((p) => p.entity_id !== 'fx-place-bar'));
});

test('no cuisine said: no filter.tags, cuisine_filter null', async () => {
  const { transport, sent } = placesTransport();
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, COZY], ...PROPERTY });
  assert.equal(sent[0].params['filter.tags'], undefined);
  assert.equal(json.applied.cuisine_filter, null);
  assert.deepEqual(json.applied.cuisine, []);
});

test('every pick names its own cuisine and feel tags, and the guest tags it carries are drivers', async () => {
  const { transport } = placesTransport();
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI, COZY], ...PROPERTY });
  const [a, b] = json.places;
  assert.deepEqual(a.tags, ['Thai', 'Cozy'], 'guest matches first, parking is not a cuisine or a feel');
  assert.deepEqual(b.tags, ['Thai', 'Quiet']);
  assert.deepEqual(a.why_trace.drivers.filter((d) => d.source === 'tag_match').map((d) => [d.id, d.name, d.score]),
    [[FX_THAI, 'Thai food', null], [FX_COZY, 'Cozy', null]]);
  assert.equal(a.why_trace.basis, 'affinity', 'Qloo attributed nothing, and the basis still says so');
});

test('a tag Qloo already attributed is not listed twice', () => {
  const e = { explainability: [{ tag_id: FX_THAI, score: 0.7 }], tags: [{ tag_id: FX_THAI, name: 'Thai' }] };
  const p = shapePlace({ ...e, name: 'Fx', entity_id: 'fx-1', location: null }, [THAI], { lat: 32, lng: -81 });
  assert.deepEqual(p.why_trace.drivers.map((d) => d.id), [FX_THAI]);
  assert.equal(p.why_trace.drivers[0].score, 0.7);
  assert.deepEqual(tagMatchDrivers(e, [THAI, ARTIST], [{ id: FX_THAI }]), []);
});

test('pick tag names are capped and unique', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ tag_id: `urn:tag:ambience:qloo:fx_${i}`, name: `Fx ${i % 10}` }));
  const names = pickTagNames({ tags: many }, new Set());
  assert.equal(names.length, 8);
  assert.equal(new Set(names).size, names.length);
});

test('placeTasteParams and relaxCuisine: only restaurant genre tags filter', () => {
  const taste = { entityIds: [ARTIST.id], tagIds: [FX_THAI, 'urn:tag:genre:place:restaurant', 'urn:tag:genre:place:bar:fx_jazz', FX_COZY] };
  const { params, cuisine } = placeTasteParams(taste);
  assert.deepEqual(cuisine, [FX_THAI], 'the bare category and a bar genre are not cuisines');
  assert.equal(params['filter.tags'], FX_THAI);
  assert.equal(relaxCuisine(params)['filter.tags'], undefined);
  assert.equal(relaxCuisine(params)['signal.interests.tags'], params['signal.interests.tags']);
});

// ---------------------------------------------------------------------------
// cross_domain
// ---------------------------------------------------------------------------

test('cross_domain filters places by cuisine, never films or books', async () => {
  const { transport, sent } = placesTransport();
  const { app } = makeApp({ qlooTransport: transport });
  const toPlaces = await callTool(app, 'cross_domain', { taste: [ARTIST, THAI], target: 'place', ...PROPERTY });
  assert.equal(sent[0].params['filter.tags'], FX_THAI);
  assert.equal(toPlaces.json.cuisine_filter, 'hard');
  assert.deepEqual(toPlaces.json.results[0].tags, ['Thai', 'Cozy']);
  sent.length = 0;
  const toFilms = await callTool(app, 'cross_domain', { taste: [ARTIST, THAI], target: 'movie' });
  assert.equal(sent[0].params['filter.tags'], undefined);
  assert.equal(toFilms.json.cuisine_filter, undefined);
});

test('one cuisine place when three are asked for relaxes once; the cuisine place stays first', async () => {
  const { transport, sent } = placesTransport({ filtered: [THAI_PLACES[0]] });
  const { app } = makeApp({ qlooTransport: transport });
  const { json } = await callTool(app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY, take: 3 });
  const tasteCalls = sent.filter((s) => Object.keys(s.params).some((k) => k.startsWith('signal.')));
  assert.equal(tasteCalls.length, 2, 'exactly one retry');
  assert.equal(json.applied.cuisine_filter, 'relaxed');
  assert.deepEqual(json.places.map((p) => p.entity_id), ['fx-place-a', 'fx-place-c', 'fx-place-d']);
});

test('a relaxed cuisine filter tells the agent plainly, so it cannot claim the cuisine', async () => {
  const none = placesTransport({ filtered: [] });
  const a = await callTool(makeApp({ qlooTransport: none.transport }).app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY });
  assert.equal(a.json.applied.cuisine_filter, 'relaxed');
  assert.equal(a.json.say, 'Nothing close enough for thai food nearby, so these are the best matches overall.');
  const one = placesTransport({ filtered: [THAI_PLACES[0]] });
  const b = await callTool(makeApp({ qlooTransport: one.transport }).app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY, take: 3 });
  assert.equal(b.json.say, 'Only one thai food place is close enough, so the rest are the best matches overall.');
  const hard = placesTransport();
  const c = await callTool(makeApp({ qlooTransport: hard.transport }).app, 'recommend_nearby', { taste: [ARTIST, THAI], ...PROPERTY, take: 2 });
  assert.equal(c.json.applied.cuisine_filter, 'hard');
  assert.equal(c.json.say, undefined);
});
