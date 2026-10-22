// The fixture events are fictional. A server that answers real callers with live Qloo must never
// read them to a caller: with Ticketmaster in mock mode it answers no events and a line to say.
// A server that is mock all the way through still serves them (tests, the offline demo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { EVENTS_UNAVAILABLE_SAY } from '../tools/events-nearby.js';
import { callTool, makeApp, PROPERTY, SECRET, FIXED_NOW } from './helpers.js';

const BODY = { ...PROPERTY, when: 'tonight', classification: 'music', take: 3 };

test('live Qloo with mock Ticketmaster: no fixture event reaches a caller, and the trace says why', async () => {
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: 'fx-key', mock: false, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger,
    transport: async () => ({ status: 200, body: { success: true, results: { entities: [] } } }) });
  assert.equal(qloo.mode, 'live');
  const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 }, cache, logger: silentLogger });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger: silentLogger,
    sms: createSmsSender({ config: { mock: true }, logger: silentLogger }), sessions: new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW }), now: () => FIXED_NOW });
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.events, []);
  assert.equal(res.json.status, 'degraded');
  assert.equal(res.json.say, EVENTS_UNAVAILABLE_SAY);
  assert.ok(res.json.trace.some((t) => t.source === 'ticketmaster' && t.error === 'ticketmaster_unavailable'));
});

test('a server mock all the way through still serves the fixture events', async () => {
  const { app } = makeApp();
  const res = await callTool(app, 'events_nearby', BODY);
  assert.equal(res.status, 200);
  assert.ok(res.json.events.length > 0, 'the offline demo keeps its events');
  assert.equal(res.json.say, undefined);
});
