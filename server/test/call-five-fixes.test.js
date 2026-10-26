// Fixes from one real call: an event is pitched with what kind of show it is, a returning guest
// is not offered a title an earlier call already offered, and forget me starts the count over.
// Fictional ids and numbers only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDescription, normalizeEvents } from '../lib/ticketmaster.js';
import { sayLine } from '../tools/events-nearby.js';
import { MAX_OFFERED_IDS } from '../lib/memory.js';
import { callInit, callTool, makeApp } from './helpers.js';

const CALLER = '+15550100088';
const DAY = 86_400_000;
const init = async (app, sid) => (await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: sid })).json.dynamic_variables;
const endCall = (app, sid) => callTool(app, 'log_session', { session_id: sid, caller_id: CALLER, picks_count: 0, events_count: 0, sms_sent: false });

test('an event carries its genre and subgenre, and the say line closes with them', () => {
  const raw = { id: 'x', name: 'Like Roses', _embedded: { venues: [{ name: 'The Hall' }] },
    classifications: [{ primary: true, segment: { name: 'Music' }, genre: { name: 'Rock' }, subGenre: { name: 'Emo' } }] };
  const [e] = normalizeEvents({ _embedded: { events: [raw] } });
  assert.equal(e.description, 'rock, emo');
  assert.equal(sayLine(e, 'Tonight at six'), 'Tonight at six, The Hall, Like Roses, rock and emo.');
});

test('placeholder genres say nothing and are dropped; no genre leaves the line as before', () => {
  assert.equal(eventDescription({ classifications: [{ genre: { name: 'Undefined' }, subGenre: { name: 'Other' } }] }), null);
  assert.equal(eventDescription({ classifications: [{ genre: { name: 'Rock' }, subGenre: { name: 'Rock' } }] }), 'rock');
  assert.equal(sayLine({ name: 'N', venue: 'V', description: null }, 'Friday at eight'), 'Friday at eight, V, N.');
});

test('a title offered on an earlier call is excluded from the next call', async () => {
  const { app, clock, memory } = makeApp({ memory: true, initRng: () => 0 });
  await init(app, 'v-1');
  const r1 = await callTool(app, 'resolve_taste', { session_id: 'v-1', mentions: ['Wes Anderson films'] });
  const taste = r1.json.resolved.map((r) => ({ id: r.id, name: r.name }));
  const c1 = await callTool(app, 'cross_domain', { session_id: 'v-1', taste, target: 'movie', take: 2 });
  const offered = c1.json.results.map((r) => r.entity_id);
  assert.ok(offered.length >= 1);
  await endCall(app, 'v-1');
  clock.advance(DAY);
  await init(app, 'v-2');
  const c2 = await callTool(app, 'cross_domain', { session_id: 'v-2', taste, target: 'movie', take: 2 });
  const recall = memory.recallFor('v-2');
  for (const id of offered) assert.ok(recall.offered.includes(id), `earlier offer ${id} is remembered for exclusion`);
  assert.ok(c2.json.results.every((r) => !offered.includes(r.entity_id)), 'nothing offered before comes back');
  assert.ok(MAX_OFFERED_IDS >= 10);
});

test('forget me resets the call counter: the next call is call one, new', async () => {
  const { app, clock } = makeApp({ memory: true, initRng: () => 0 });
  for (let i = 1; i <= 4; i += 1) {
    await init(app, `f-${i}`);
    await callTool(app, 'remember_guest', { session_id: `f-${i}`, first_name: 'Dana' });
    await endCall(app, `f-${i}`);
    clock.advance(DAY);
  }
  assert.equal((await init(app, 'f-5')).call_number, 5);
  await callTool(app, 'forget_guest', { session_id: 'f-5', caller_id: CALLER });
  await endCall(app, 'f-5');
  const next = await init(app, 'f-6');
  assert.equal(next.caller_status, 'new');
  assert.equal(next.call_number, 1);
});
