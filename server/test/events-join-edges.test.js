// Edges of the shows path. Every value is fake: fx- ids, fictional artists and venues.
//   - the plain listing asks Ticketmaster from the top of the hour (one cache key per hour), so
//     a show that began earlier this hour must not be offered as still to come
//   - one co-billed show found through two similar artists is one show, not two
//   - the named artist's own show is told by whole words, so a short name does not knock out
//     every show whose name happens to contain its letters

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../app.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { ATTRACTIONS_ENDPOINT, createTicketmasterClient } from '../lib/ticketmaster.js';
import { SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { callTool, PROPERTY, SECRET } from './helpers.js';
import { CRITERIA } from '../battery/criteria.js';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-16T22:45:00Z'); // 6:45 pm Friday in New York
const tmEvent = (id, name, iso) => ({ id, name, url: `https://example.com/events/${id}`,
  dates: { start: { dateTime: iso } }, classifications: [{ segment: { name: 'Music' } }], _embedded: { venues: [{ name: 'Fx Hall' }] } });
const artist = (slug, name) => ({ name, entity_id: `fx-artist-${slug}`, subtype: 'urn:entity:artist', query: { affinity: 0.9 } });

/** Live-mode clients over hand-made transports; Ticketmaster honors startDateTime like the real API. */
function app({ similar = [], attractions = {}, byAttraction = {}, listing = [] }) {
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-key', mock: false, timeoutMs: 1000, retries: 0 },
    cache, logger: silentLogger, transport: async () => ({ status: 200, body: { success: true, results: { entities: similar } } }) });
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: 'fx-key', mock: false, timeoutMs: 1000 },
    cache, logger: silentLogger,
    transport: async (endpoint, params) => {
      if (endpoint === ATTRACTIONS_ENDPOINT) return { status: 200, body: { _embedded: { attractions: attractions[params.keyword] ?? [] } } };
      const from = Date.parse(params.startDateTime);
      const list = (params.attractionId ? byAttraction[params.attractionId] ?? [] : listing).filter((e) => Date.parse(e.dates.start.dateTime) >= from);
      return { status: 200, body: { _embedded: { events: list } } };
    } });
  return createApp({ secret: SECRET, qloo, ticketmaster, timezone: TZ, logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }),
    sessions: new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => NOW }), now: () => NOW });
}

test('a show that began earlier this hour is not offered as tonight', async () => {
  const a = app({ listing: [tmEvent('fx-ev-early', 'Fx Early Set', '2026-10-16T22:10:00Z'), tmEvent('fx-ev-late', 'Fx Late Set', '2026-10-17T00:30:00Z')] });
  const res = await callTool(a, 'events_nearby', { ...PROPERTY, when: 'tonight', classification: 'music', take: 5 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.events.map((e) => e.id), ['fx-ev-late']);
});

test('one co-billed show found through two similar artists is listed once', async () => {
  const both = tmEvent('fx-ev-cobill', 'Fx Copper and Fx Wren', '2026-10-17T00:00:00Z');
  const a = app({
    similar: [artist('copper', 'Fx Copper'), artist('wren', 'Fx Wren')],
    attractions: { 'Fx Copper': [{ id: 'fxattcopper', name: 'Fx Copper' }], 'Fx Wren': [{ id: 'fxattwren', name: 'Fx Wren' }] },
    byAttraction: { fxattcopper: [both], fxattwren: [both] },
  });
  const res = await callTool(a, 'events_nearby', { ...PROPERTY, when: 'tonight', classification: 'music', take: 3, artist: { id: 'fx-artist-named', name: 'Fx Named' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.by_taste.events.length, 1, JSON.stringify(res.json.by_taste.events.map((e) => e.name)));
});

test('a short artist name drops only shows that carry it as a word', async () => {
  const a = app({
    similar: [artist('copper', 'Fx Copper')],
    attractions: { 'Fx Copper': [{ id: 'fxattcopper', name: 'Fx Copper' }] },
    byAttraction: { fxattcopper: [tmEvent('fx-ev-strand', 'Fx Copper at the Strand', '2026-10-17T00:00:00Z')] },
  });
  const res = await callTool(a, 'events_nearby', { ...PROPERTY, when: 'tonight', classification: 'music', take: 3, artist: { id: 'fx-artist-ra', name: 'Ra' } });
  assert.deepEqual(res.json.by_taste.events.map((e) => e.name), ['Fx Copper at the Strand']);
});

test('C18 agrees with the tool on both edges', () => {
  const c18 = CRITERIA.find((c) => c.id === 'C18');
  const named = { id: 'fx-artist-ra', name: 'Ra' };
  const trace = [{ source: 'qloo', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': named.id } },
    { endpoint: '/attractions.json', params: { keyword: 'Fx Copper' } }];
  const hit = { name: 'Fx Copper at the Strand', artist: 'Fx Copper', url: 'https://example.com/events/fx-1', start: '2026-10-17T00:00:00Z',
    reason_source: 'Qloo', when_label: 'Tonight at 8 PM', pick_token: 'fx-token', why: 'Fans of Ra also love Fx Copper, per Qloo' };
  const rec = (events) => ({ namedArtist: named, trace, events: { status: 200, json: { ok: true, status: 'ok', by_taste: { status: 'ok', events } } } });
  assert.equal(c18.run(rec([hit])).verdict, 'pass', 'a short name inside another word is not the named artist');
  assert.equal(c18.run(rec([hit, { ...hit, artist: 'Fx Copper' }])).verdict, 'fail', 'one show twice fails');
});
