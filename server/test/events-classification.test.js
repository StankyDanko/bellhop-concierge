// Round six: a guest asked for a film, events_nearby was called with classification "film",
// and the answer still carried a string band and an improv night. The classification now
// reaches the API as classificationName and is applied again on what comes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { filterByClassification, createTicketmasterClient } from '../lib/ticketmaster.js';

const kinds = (json) => json.events.map((e) => e.category);

test('the regression: a film request returns only film events', async () => {
  const { app } = makeApp();
  const { status, json } = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'weekend', take: 3, classification: 'film' });
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
  assert.ok(json.events.length >= 1);
  assert.deepEqual([...new Set(kinds(json))], ['Film']);
  assert.ok(json.events.every((e) => typeof e.say === 'string' && typeof e.pick_token === 'string'));
});

test('a music request returns only music, and no classification returns every kind', async () => {
  const { app } = makeApp();
  const music = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight', classification: 'Music' })).json;
  assert.deepEqual(kinds(music), ['Music']);
  const all = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight' })).json;
  assert.deepEqual(kinds(all), ['Music', 'Arts & Theatre', 'Film']);
});

test('the classification is sent upstream as classificationName', async () => {
  const seen = [];
  const transport = async (endpoint, params) => {
    seen.push(params);
    return { status: 200, body: { _embedded: { events: [] } } };
  };
  const tm = createTicketmasterClient({ config: { mock: false, apiKey: 'k', baseUrl: 'https://tm.example', timeoutMs: 1000 }, cache: null,
    logger: () => {}, transport });
  await tm.events({ lat: 1, lng: 2, radiusMiles: 5, start: 'a', end: 'b', classification: 'film' });
  await tm.events({ lat: 1, lng: 2, radiusMiles: 5, start: 'a', end: 'b' });
  assert.equal(seen[0].classificationName, 'film');
  assert.equal(seen[0].segmentName, undefined);
  assert.equal('classificationName' in seen[1], false);
});

test('filterByClassification matches any level, ignores case, and keeps unclassified events', () => {
  const ev = (name, c) => ({ name, ...(c ? { classifications: [c] } : {}) });
  const body = { _embedded: { events: [
    ev('Band', { segment: { name: 'Music' } }),
    ev('Standup', { segment: { name: 'Arts & Theatre' }, genre: { name: 'Comedy' } }),
    ev('Matinee', { segment: { name: 'Film' } }),
    ev('Mystery'),
  ] } };
  const names = (b) => b._embedded.events.map((e) => e.name);
  assert.deepEqual(names(filterByClassification(body, 'film')), ['Matinee', 'Mystery']);
  assert.deepEqual(names(filterByClassification(body, 'COMEDY')), ['Standup', 'Mystery']);
  assert.deepEqual(names(filterByClassification(body, 'arts & theatre')), ['Standup', 'Mystery']);
  assert.equal(filterByClassification(body, undefined), body);
  assert.deepEqual(filterByClassification({}, 'film'), {});
});
