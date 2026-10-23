// events_nearby with a named artist: shows by the artists Qloo ranks close to that one.
// Every value here is fake: fx- ids, fictional artists, fictional venues.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { ResponseCache, SIMILAR_ARTISTS_TTL, TTL_SECONDS, cacheKey } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient, ENDPOINTS } from '../lib/qloo.js';
import { createTicketmasterClient, ATTRACTIONS_ENDPOINT, EVENTS_ENDPOINT } from '../lib/ticketmaster.js';
import { SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { verifyPick } from '../lib/pick-token.js';
import { inTasteWindow, MAX_HITS, nameKey, tasteSay, tasteWindow } from '../tools/events-by-taste.js';
import { callTool, makeApp, PROPERTY, SECRET, FIXED_NOW } from './helpers.js';

const NAMED = { id: 'fx-artist-juniper-rail', name: 'Juniper Rail' };
const BODY = { ...PROPERTY, when: 'tonight', classification: 'music', take: 3, artist: NAMED };
const TZ = 'America/New_York';

const artistEntity = (slug, name, affinity) => ({ name, entity_id: `fx-artist-${slug}`, subtype: 'urn:entity:artist', query: { affinity } });
const tmEvent = (id, name, iso, venue) => ({ id, name, url: `https://example.com/events/${id}`,
  dates: { start: { dateTime: iso } }, classifications: [{ segment: { name: 'Music' } }], _embedded: { venues: [{ name: venue }] } });

/**
 * An app around live-mode clients with hand-made transports, so a test decides every answer.
 * @param {{ similar?: any[], attractions?: Record<string, any[]>, events?: Record<string, any[]>, qlooFails?: boolean }} spec
 */
function liveApp({ similar = [], attractions = {}, events = {}, qlooFails = false } = {}, { tmMock = false } = {}) {
  const seen = { qloo: [], tm: [] };
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-key', mock: false, timeoutMs: 1000, retries: 0 },
    cache, logger: silentLogger,
    transport: async (endpoint, params) => {
      seen.qloo.push({ endpoint, params });
      if (qlooFails) return { status: 503, body: {} };
      return { status: 200, body: { success: true, results: { entities: similar } } };
    } });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: tmMock ? '' : 'fx-key', mock: tmMock, timeoutMs: 1000 },
    cache, logger: silentLogger,
    transport: tmMock ? undefined : async (endpoint, params) => {
      seen.tm.push({ endpoint, params });
      if (endpoint === ATTRACTIONS_ENDPOINT) return { status: 200, body: { _embedded: { attractions: attractions[params.keyword] ?? [] } } };
      if (params.attractionId) return { status: 200, body: { _embedded: { events: events[params.attractionId] ?? [] } } };
      return { status: 200, body: { _embedded: { events: [] } } };
    } });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: TZ, logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }),
    sessions: new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW }), now: () => FIXED_NOW });
  return { app, seen, cache };
}

test('the join, offline: Qloo similar artists, an exact attraction match, then that attraction\'s shows', async () => {
  const { app } = makeApp();
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.status, 200);
  const bt = res.json.by_taste;
  assert.equal(bt.status, 'ok');
  assert.deepEqual(bt.events.map((e) => e.artist), ['Marigold Ferry', 'The Saltgrass Sisters'], 'Qloo order; the near-miss name is skipped');
  for (const e of bt.events) {
    assert.equal(e.similar_to, 'Juniper Rail');
    assert.equal(e.reason_source, 'Qloo');
    assert.equal(e.source, 'Ticketmaster');
    assert.match(e.why, /^Fans of Juniper Rail also love .+, per Qloo$/);
    assert.match(e.say, /^Fans of Juniper Rail also love /);
  }
  assert.equal(bt.events[1].say, 'Fans of Juniper Rail also love The Saltgrass Sisters, playing tonight at nine at Bluff Street Lyric.');
  // The trace shows each step: one Qloo insights call that excludes the named artist, then keyword and attraction lookups.
  const q = res.json.trace.filter((t) => t.source === 'qloo');
  assert.equal(q.length, 1);
  assert.equal(q[0].params['filter.type'], 'urn:entity:artist');
  assert.equal(q[0].params['signal.interests.entities'], NAMED.id);
  assert.equal(q[0].params['filter.exclude.entities'], NAMED.id);
  const keywords = res.json.trace.filter((t) => t.endpoint === ATTRACTIONS_ENDPOINT).map((t) => t.params.keyword);
  assert.deepEqual(keywords.slice(0, 3), ['Marigold Ferry', 'Dune Lantern', 'The Saltgrass Sisters'], 'the trace reads in Qloo order');
  assert.equal(new Set(keywords).size, keywords.length, 'each similar artist looked up once, all of them at once');
  assert.ok(res.json.trace.some((t) => t.params.attractionId === 'fx-att-marigold-ferry'), 'the exact name, not the tribute night');
  assert.ok(!res.json.trace.some((t) => t.params.attractionId === 'fx-att-marigold-ferry-tribute'));
  // The plain listing is still there, unchanged.
  assert.ok(res.json.events.length > 0);
});

test('without an artist the answer is exactly the plain listing', async () => {
  const { app } = makeApp();
  const { artist: _a, ...plain } = BODY;
  const res = await callTool(app, 'events_nearby', plain);
  assert.equal(res.json.by_taste, undefined);
  assert.ok(!res.json.trace.some((t) => t.source === 'qloo' || t.endpoint === ATTRACTIONS_ENDPOINT));
});

test('the window: tonight or this weekend, a show already started or midweek is not', async () => {
  const { app } = makeApp();
  const res = await callTool(app, 'events_nearby', BODY);
  const mf = res.json.by_taste.events.find((e) => e.artist === 'Marigold Ferry');
  assert.equal(mf.name, 'Marigold Ferry: Low Tide Tour', 'the soundcheck that began before the call is skipped');
  assert.equal(mf.when_label, 'Sat 8pm');
  assert.equal(res.json.by_taste.events.find((e) => e.artist === 'The Saltgrass Sisters').when_label, 'Tonight 9pm');

  // A Monday 3pm call: tonight runs to 4am Tuesday, the weekend is Friday 5pm to Sunday 11pm.
  const monday = new Date('2026-10-19T19:00:00Z');
  const win = tasteWindow(monday, TZ);
  const at = (iso) => inTasteWindow({ start: iso }, win, TZ);
  assert.equal(at('2026-10-20T00:30:00Z'), true, 'Monday 8:30pm');
  assert.equal(at('2026-10-21T23:00:00Z'), false, 'Wednesday 7pm');
  assert.equal(at('2026-10-23T20:00:00Z'), false, 'Friday 4pm, before the weekend starts');
  assert.equal(at('2026-10-24T23:00:00Z'), true, 'Saturday 7pm');
  assert.equal(at('2026-10-26T04:00:00Z'), false, 'after Sunday 11pm');
  assert.equal(inTasteWindow({ start: '2026-10-25', local_date: '2026-10-25' }, win, TZ), true, 'a dated Sunday show with no time');
  assert.equal(inTasteWindow({ start: '2026-10-22', local_date: '2026-10-22' }, win, TZ), false, 'a dated Thursday show');
  assert.equal(win.fetch.start.getTime() % 3_600_000, 0, 'the fetch starts on the hour, so the hour shares a cache key');
});

test('the cap: at most two shows, one per artist, read in Qloo order', async () => {
  const names = ['Alder Choir', 'Bramble Union', 'Cinder Lake', 'Driftwood Mile'];
  const similar = names.map((n, i) => artistEntity(nameKey(n).replace(/ /g, '-'), n, 0.9 - i / 100));
  const attractions = Object.fromEntries(names.map((n, i) => [n, [{ id: `fx-att-${i}`, name: n }]]));
  const events = Object.fromEntries(names.map((n, i) => [`fx-att-${i}`, [
    tmEvent(`fx-evt-${i}-a`, `${n} Live`, '2026-10-17T00:00:00Z', 'Fiddlehead Room'),
    tmEvent(`fx-evt-${i}-b`, `${n} Encore`, '2026-10-17T23:00:00Z', 'Fiddlehead Room'),
  ]]));
  const { app, seen } = liveApp({ similar, attractions, events });
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.json.by_taste.events.length, MAX_HITS);
  assert.deepEqual(res.json.by_taste.events.map((e) => e.artist), ['Alder Choir', 'Bramble Union']);
  // All four are looked up at once (no wait between artists); only the first two in Qloo's order are kept.
  assert.equal(seen.tm.filter((c) => c.endpoint === ATTRACTIONS_ENDPOINT).length, 4);
  assert.equal(res.json.by_taste.similar_checked, 2);
});

test('never the named artist: an echoed id, the same name, or a co-bill carrying the name', async () => {
  const similar = [
    { ...artistEntity('juniper-rail', 'Juniper Rail', 0.99), entity_id: NAMED.id },
    artistEntity('juniper-rail-2', 'Juniper  Rail!', 0.98),
    artistEntity('foxglove-ave', 'Foxglove Avenue', 0.97),
  ];
  const attractions = { 'Foxglove Avenue': [{ id: 'fx-att-foxglove', name: 'Foxglove Avenue' }], 'Juniper Rail': [{ id: 'fx-att-named', name: 'Juniper Rail' }] };
  const events = {
    'fx-att-named': [tmEvent('fx-evt-named', 'Juniper Rail', '2026-10-17T00:00:00Z', 'Fiddlehead Room')],
    'fx-att-foxglove': [
      tmEvent('fx-evt-cobill', 'Juniper Rail with Foxglove Avenue', '2026-10-17T00:00:00Z', 'Fiddlehead Room'),
      tmEvent('fx-evt-fox', 'Foxglove Avenue', '2026-10-17T23:00:00Z', 'Saltmarsh Hall'),
    ],
  };
  const { app, seen } = liveApp({ similar, attractions, events });
  const res = await callTool(app, 'events_nearby', BODY);
  const out = res.json.by_taste.events;
  assert.deepEqual(out.map((e) => e.name), ['Foxglove Avenue']);
  assert.ok(!seen.tm.some((c) => c.params.keyword === 'Juniper Rail' || c.params.attractionId === 'fx-att-named'), 'the named artist is never looked up');
});

test('the token: each show is signed for its name and when_label, and compose_itinerary honors it', async () => {
  const { app } = makeApp();
  const res = await callTool(app, 'events_nearby', BODY);
  const hit = res.json.by_taste.events[0];
  assert.equal(verifyPick(SECRET, { name: hit.name, when_label: hit.when_label, pick_token: hit.pick_token }), true);
  assert.equal(verifyPick(SECRET, { name: hit.name, when_label: 'Tonight 8pm', pick_token: hit.pick_token }), false);
  const composed = await callTool(app, 'compose_itinerary', { picks: [
    { name: hit.name, why: hit.why, url: hit.url, when_label: hit.when_label, pick_token: hit.pick_token },
  ] });
  assert.equal(composed.json.when_dropped, 0);
  assert.equal(composed.json.tokens_dropped, 0);
  assert.ok(composed.json.body.includes(hit.when_label));
  assert.ok(composed.json.body.includes('per Qloo'));
  const forged = await callTool(app, 'compose_itinerary', { picks: [{ name: hit.name, when_label: 'Tonight 7pm', pick_token: hit.pick_token }] });
  assert.equal(forged.json.when_dropped, 1);
});

test('the guard: live Qloo with mock Ticketmaster asks Qloo nothing and reads no fictional show', async () => {
  const { app, seen } = liveApp({ similar: [artistEntity('foxglove-ave', 'Foxglove Avenue', 0.97)] }, { tmMock: true });
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'degraded');
  assert.deepEqual(res.json.events, []);
  assert.equal(res.json.by_taste, undefined);
  assert.equal(seen.qloo.length, 0);
  assert.ok(!JSON.stringify(res.json).includes('Saltgrass'));
});

test('Qloo unavailable: the plain listing still answers, by_taste says degraded', async () => {
  const { app } = liveApp({ qlooFails: true });
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.status, 200);
  assert.equal(res.json.by_taste.status, 'degraded');
  assert.deepEqual(res.json.by_taste.events, []);
});

test('a similar artist name the privacy guard refuses is skipped, never sent', async () => {
  const similar = [artistEntity('digits', 'Band 5550123456', 0.99), artistEntity('foxglove-ave', 'Foxglove Avenue', 0.97)];
  const attractions = { 'Foxglove Avenue': [{ id: 'fx-att-foxglove', name: 'Foxglove Avenue' }] };
  const events = { 'fx-att-foxglove': [tmEvent('fx-evt-fox', 'Foxglove Avenue', '2026-10-17T23:00:00Z', 'Saltmarsh Hall')] };
  const { app, seen } = liveApp({ similar, attractions, events });
  const res = await callTool(app, 'events_nearby', BODY);
  assert.deepEqual(res.json.by_taste.events.map((e) => e.artist), ['Foxglove Avenue']);
  assert.ok(!seen.tm.some((c) => /\d{7}/.test(c.params.keyword ?? '')));
});

test('artist input: an id resolve_taste could have returned and a name, or a 400', async () => {
  const { app } = makeApp();
  for (const artist of [{ id: 'not an id!', name: 'Juniper Rail' }, { id: NAMED.id }, { name: 'Juniper Rail' }, 'x']) {
    const res = await callTool(app, 'events_nearby', { ...BODY, artist });
    assert.equal(res.status, 400, JSON.stringify(artist));
  }
});

test('similar artists stay cached for 30 days; attractions too', async () => {
  let t = 1_800_000_000;
  const cache = new ResponseCache({ path: ':memory:', now: () => t });
  let calls = 0;
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-key', mock: false, timeoutMs: 1000, retries: 0 },
    cache, logger: silentLogger, transport: async () => { calls += 1; return { status: 200, body: { success: true, results: { entities: [artistEntity('foxglove-ave', 'Foxglove Avenue', 0.97)] } } }; } });
  await qloo.similarArtists({ entityId: NAMED.id });
  t += 29 * 86_400;
  await qloo.similarArtists({ entityId: NAMED.id });
  assert.equal(calls, 1, 'day 29 is a cache hit');
  t += 2 * 86_400;
  await qloo.similarArtists({ entityId: NAMED.id });
  assert.equal(calls, 2, 'day 31 asks again');
  assert.equal(SIMILAR_ARTISTS_TTL, 30 * 86_400);
  // The per-request TTL leaves every other insights request on its own daily TTL.
  const key = cacheKey('qloo', ENDPOINTS.insights, { take: '1' });
  cache.put(key, 'qloo', ENDPOINTS.insights, { ok: 1 });
  t += 2 * 86_400;
  assert.equal(cache.get(key), undefined);
  assert.equal(TTL_SECONDS[`ticketmaster:${ATTRACTIONS_ENDPOINT}`], 30 * 86_400);
  assert.equal(TTL_SECONDS[`ticketmaster:${EVENTS_ENDPOINT}`], 3600, 'shows themselves stay on the hourly TTL');
});

test('the say line keeps a weekday capitalized and lowercases tonight', () => {
  assert.equal(tasteSay('Juniper Rail', 'Foxglove Avenue', 'Saturday at eight', 'Saltmarsh Hall'),
    'Fans of Juniper Rail also love Foxglove Avenue, playing Saturday at eight at Saltmarsh Hall.');
  assert.equal(tasteSay('Juniper Rail', 'Foxglove Avenue', 'Tonight at nine', null),
    'Fans of Juniper Rail also love Foxglove Avenue, playing tonight at nine.');
});

test('the plain listing rounds its start to the hour, so a second call that hour is a cache hit', async () => {
  const { eventsNearby } = await import('../tools/events-nearby.js');
  const { createTicketmasterClient } = await import('../lib/ticketmaster.js');
  const { ResponseCache } = await import('../lib/cache.js');
  const { silentLogger } = await import('../lib/log.js');
  let sent = 0;
  const starts = [];
  const transport = async (_endpoint, params) => { sent += 1; starts.push(params.startDateTime); return { status: 200, body: { _embedded: { events: [] } } }; };
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: 'fx-key', mock: false, timeoutMs: 1000 },
    cache: new ResponseCache({ path: ':memory:' }), logger: silentLogger, transport });
  const body = { lat: 32.08, lng: -81.09, when: 'tonight', classification: 'music', take: 3 };
  const ctx = (iso) => ({ ticketmaster, timezone: 'America/New_York', now: () => new Date(iso) });
  await eventsNearby(body, ctx('2026-10-16T22:05:00Z'));
  await eventsNearby(body, ctx('2026-10-16T22:47:00Z'));
  assert.equal(sent, 1, 'the second call in the same hour never reaches Ticketmaster');
  assert.match(starts[0], /T22:00:00Z$/);
});

test('the guard, the other way: mock Qloo with live Ticketmaster makes no attraction search', async () => {
  const seen = [];
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: 'fx-key', mock: false, timeoutMs: 1000 },
    cache, logger: silentLogger, transport: async (endpoint, params) => { seen.push({ endpoint, params }); return { status: 200, body: { _embedded: { events: [] } } }; } });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: TZ, logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }),
    sessions: new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW }), now: () => FIXED_NOW });
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.status, 200);
  assert.equal(res.json.by_taste.status, 'degraded');
  assert.equal(res.json.by_taste.reason, 'similar_artists_mock');
  assert.ok(seen.every((s) => s.endpoint !== ATTRACTIONS_ENDPOINT && !s.params.attractionId), 'no search for a fixture artist on the live listing');
});

const placedEvent = (id, name, iso, venue, city, lat, lng) => ({ id, name, url: `https://example.com/events/${id}`,
  dates: { start: { dateTime: iso } }, classifications: [{ segment: { name: 'Music' } }],
  _embedded: { venues: [{ name: venue, city: { name: city }, location: { latitude: String(lat), longitude: String(lng) } }] } });

test('three weeks out and a drive away: the line names the date and the city, and the token covers both', async () => {
  const similar = [artistEntity('alder-choir', 'Alder Choir', 0.9), artistEntity('bramble-union', 'Bramble Union', 0.8), artistEntity('cinder-lake', 'Cinder Lake', 0.7)];
  const attractions = { 'Alder Choir': [{ id: 'fx-att-0', name: 'Alder Choir' }], 'Bramble Union': [{ id: 'fx-att-1', name: 'Bramble Union' }], 'Cinder Lake': [{ id: 'fx-att-2', name: 'Cinder Lake' }] };
  const events = {
    // Ten days out, in a town about 50 miles away.
    'fx-att-0': [placedEvent('fx-evt-far', 'Alder Choir Live', '2026-10-27T00:00:00Z', 'Fx Opera House', 'Fx Riverton', 32.45, -81.78)],
    // This weekend, but 30 miles out: past the inn's own radius of 10.
    'fx-att-1': [placedEvent('fx-evt-drive', 'Bramble Union', '2026-10-18T00:00:00Z', 'Fx Barn', 'Fx Millbrook', 32.5, -81.1)],
    // Twenty-three days out: past the three-week horizon, never shown.
    'fx-att-2': [placedEvent('fx-evt-late', 'Cinder Lake', '2026-11-09T00:00:00Z', 'Fx Hall', 'Fx Riverton', 32.08, -81.09)],
  };
  const { app, seen } = liveApp({ similar, attractions, events });
  const res = await callTool(app, 'events_nearby', { ...BODY, radius_miles: 10 });
  const bt = res.json.by_taste;
  assert.deepEqual(bt.events.map((e) => e.artist), ['Alder Choir', 'Bramble Union']);
  const [far, drive] = bt.events;
  assert.equal(far.when_label, 'Mon Oct 26, Fx Riverton');
  assert.equal(far.say, 'Fans of Juniper Rail also love Alder Choir, playing Monday, October 26 in Fx Riverton.');
  assert.equal(drive.when_label, 'Sat Oct 17, Fx Millbrook');
  assert.ok(drive.miles > 10 && drive.miles < 60, `${drive.miles} miles`);
  assert.ok(verifyPick(SECRET, far), 'the token covers the date and city label');
  assert.equal(verifyPick(SECRET, { ...far, when_label: 'Tonight 8pm' }), false, 'a forged day fails');
  const evReq = seen.tm.find((c) => c.params.attractionId === 'fx-att-0').params;
  assert.equal(evReq.radius, '100');
  const days = (Date.parse(evReq.endDateTime) - FIXED_NOW.getTime()) / 86_400_000;
  assert.ok(days >= 20.9 && days <= 21.1, `${days} days ahead`);
});

test('the similar-artist lookups run at once, five at most', async () => {
  const names = ['Alder Choir', 'Bramble Union', 'Cinder Lake', 'Driftwood Mile', 'Ember Coast'];
  let inFlight = 0;
  let peak = 0;
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-key', mock: false, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger,
    transport: async () => ({ status: 200, body: { success: true, results: { entities: names.map((n, i) => artistEntity(nameKey(n).replace(/ /g, '-'), n, 0.9 - i / 100)) } } }) });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: 'fx-key', mock: false, timeoutMs: 1000 }, cache, logger: silentLogger,
    transport: async (endpoint, params) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      if (endpoint === ATTRACTIONS_ENDPOINT) return { status: 200, body: { _embedded: { attractions: [{ id: `fx-att-${nameKey(params.keyword).replace(/ /g, '-')}`, name: params.keyword }] } } };
      return { status: 200, body: { _embedded: { events: [] } } };
    } });
  const { eventsByTaste } = await import('../tools/events-by-taste.js');
  const t0 = Date.now();
  const out = await eventsByTaste({ artist: NAMED, lat: PROPERTY.lat, lng: PROPERTY.lng, radiusMiles: 10, timezone: TZ }, { qloo, ticketmaster, now: () => FIXED_NOW });
  const ms = Date.now() - t0;
  assert.equal(out.status, 'empty');
  assert.equal(peak, 5, 'five lookups in flight together');
  assert.ok(ms < 5 * 2 * 40, `${ms} ms: the five artists overlapped instead of queueing`);
});

test('a singer Qloo files as a person counts as the named act, like a band', async () => {
  const { isNamedAct } = await import('../tools/events-by-taste.js');
  assert.equal(isNamedAct({ kind: 'entity', type: 'artist', id: 'fx-artist-a' }), true);
  assert.equal(isNamedAct({ kind: 'entity', type: 'person', id: 'fx-person-a' }), true);
  assert.equal(isNamedAct({ kind: 'entity', type: 'movie', id: 'fx-movie-a' }), false);
  assert.equal(isNamedAct({ kind: 'tag', type: 'tag', id: 'urn:tag:fx' }), false);
  // The request itself is the same: the person's id is the only signal of an artist query.
  const person = { id: 'fx-person-fiddle-queen', name: 'Fx Fiddle Queen' };
  const { app, seen } = liveApp({ similar: [artistEntity('alder-choir', 'Alder Choir', 0.9)] });
  const res = await callTool(app, 'events_nearby', { ...BODY, artist: person });
  assert.equal(res.status, 200);
  const q = seen.qloo.find((c) => c.params['filter.type'] === 'urn:entity:artist');
  assert.equal(q.params['signal.interests.entities'], person.id);
  assert.equal(q.params['filter.exclude.entities'], person.id);
});
