// "Look wider" changes the call: events_nearby takes a radius and a seven-day window, and an
// empty answer names the wider values to try, so the second call is never the first one again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp, PROPERTY } from './helpers.js';
import { widerSearch } from '../tools/events-nearby.js';

test('widerSearch moves the window and the radius, and ends honestly', () => {
  assert.deepEqual(widerSearch('tonight', 10), { when: 'weekend', radius_miles: 25 });
  assert.deepEqual(widerSearch('weekend', 25), { when: 'week', radius_miles: 50 });
  assert.deepEqual(widerSearch('week', 50), null);
  assert.deepEqual(widerSearch('tonight', 40), { when: 'weekend', radius_miles: 50 });
});

test('events_nearby: the week window and a radius reach Ticketmaster, and empty names the wider call', async () => {
  const { app } = makeApp({ qlooTransport: async () => ({ status: 200, body: { success: true, results: { entities: [] } } }) });
  const { json } = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'week', radius_miles: 25 });
  assert.equal(json.window.when, 'week');
  assert.equal(json.window.radius_miles, 25);
  const span = Date.parse(json.window.end) - Date.parse(json.window.start);
  assert.equal(span, 7 * 86_400_000);
  const tooFar = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'week', radius_miles: 80 });
  assert.equal(tooFar.status, 400);
  const badWhen = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'month' });
  assert.equal(badWhen.status, 400);
});
