// Memory is saved as the call goes, not only at the end. A call that crashes, or hangs up before
// log_session, still leaves the guest's name, the town, and what was offered and texted.
// Fictional 555-01xx number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeTool } from '../lib/memory.js';
import { PROPERTY, callInit, callTool, makeApp } from './helpers.js';

const CALLER = '+15550100077';

test('a call that never reaches log_session still leaves name, place, offers, and the text', async () => {
  const { app, memory } = makeApp({ memory: true, initRng: () => 0 });
  const sid = 'conv-cp-1';
  await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: sid });
  await callTool(app, 'remember_guest', { session_id: sid, first_name: 'Dana' });
  const hash = memory.keyFor(CALLER);
  assert.equal(memory.read(hash, 'demo').guest.name, 'Dana', 'saved right after remember_guest');
  const res = await callTool(app, 'resolve_taste', { session_id: sid, mentions: ['Sturgill Simpson'] });
  const taste = res.json.resolved.map((r) => ({ id: r.id, name: r.name }));
  const rec = await callTool(app, 'recommend_nearby', { session_id: sid, taste, ...PROPERTY, take: 2 });
  observeTool(memory, 'recommend_nearby', { session_id: sid }, { ...rec.json, locality: 'Buckhead, Georgia' });
  const comp = await callTool(app, 'compose_itinerary', { session_id: sid, picks: rec.json.places.slice(0, 1).map((p) => ({ pick_token: p.pick_token })) });
  await callTool(app, 'send_sms', { to: CALLER, body: comp.json.body, session_id: sid });
  // The call dies here: no log_session.
  const row = memory.read(hash, 'demo');
  assert.equal(row.guest.name, 'Dana');
  assert.equal(row.guest.place, 'Buckhead, Georgia');
  assert.equal(row.texted.length, 1);
  assert.ok(row.guest.last.offered.length > 0);
  const next = await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: 'conv-cp-2' });
  assert.equal(next.json.dynamic_variables.caller_name, 'Dana');
  assert.notEqual(next.json.dynamic_variables.caller_status, 'new');
});

test('the end-of-call commit after checkpoints changes nothing and counts nothing twice', async () => {
  const { app, memory } = makeApp({ memory: true, initRng: () => 0 });
  const sid = 'conv-cp-3';
  await callInit(app, { caller_id: CALLER, agent_id: 'battery', conversation_id: sid });
  await callTool(app, 'remember_guest', { session_id: sid, first_name: 'Dana' });
  const hash = memory.keyFor(CALLER);
  const strip = (r) => ({ ...r, last_call_at: 0, guest: { ...r.guest, last: r.guest.last }, tastes: r.tastes.map((t) => t.id) });
  const before = strip(memory.read(hash, 'demo'));
  memory.checkpoint(sid);
  memory.checkpoint(sid);
  await callTool(app, 'log_session', { session_id: sid, caller_id: CALLER, picks_count: 0, events_count: 0, sms_sent: false });
  const after = strip(memory.read(hash, 'demo'));
  assert.deepEqual(after, before);
  assert.equal(after.calls_count, 1);
  assert.equal(after.guest.person_calls, 1);
});
