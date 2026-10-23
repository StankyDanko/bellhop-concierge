// "Texted" is what the server sent. compose_itinerary can drop a whole pick to fit 320
// characters, and an agent can compose twice and send the first text. Either way, only the
// places in the body that went out are recorded as texted. Fake places and a fictional line.

import assert from 'node:assert/strict';
import test from 'node:test';
import { GuestMemory } from '../lib/memory.js';

const CALLER = '+15550100041';
const SECRET = 'fx-memory-secret-0123456789';
const NOW = new Date('2026-10-22T20:00:00Z');

function call(sid) {
  const m = new GuestMemory({ path: ':memory:', secret: SECRET, now: () => NOW });
  m.startCall({ hash: m.keyFor(CALLER), sessionId: sid, propertyId: 'demo', persona: 'harper', timezone: 'America/New_York', variety: { opener: 'h-band', pair: 'p-spicy', bet: 'b-film' } });
  m.noteOffered(sid, [{ entity_id: 'fx-place-a', name: 'Fx Alpha Kitchen' }, { entity_id: 'fx-place-b', name: 'Fx Beta Grill' }, { entity_id: 'fx-place-c', name: 'Fx Gamma Diner' }]);
  return m;
}
const textedIds = (m) => m.read(m.keyFor(CALLER), 'demo').texted.map((t) => t.id).sort();

test('a pick compose dropped to fit the text is never recorded as texted', () => {
  const m = call('conv_fx_t1');
  const body = 'Fx Alpha Kitchen: fans of Fx Band love it\nFx Beta Grill\nReply STOP to opt out';
  m.noteComposed('conv_fx_t1', ['Fx Alpha Kitchen', 'Fx Beta Grill', 'Fx Gamma Diner'], body); // Gamma was cut
  assert.equal(m.noteTexted(CALLER, body, 'conv_fx_t1'), true);
  m.commit('conv_fx_t1');
  assert.deepEqual(textedIds(m), ['fx-place-a', 'fx-place-b']);
});

test('two compositions in one call: the one that was sent is the one recorded', () => {
  const m = call('conv_fx_t2');
  const first = 'Fx Alpha Kitchen\nReply STOP to opt out';
  const second = 'Fx Gamma Diner\nReply STOP to opt out';
  m.noteComposed('conv_fx_t2', ['Fx Alpha Kitchen'], first);
  m.noteComposed('conv_fx_t2', ['Fx Gamma Diner'], second);
  assert.equal(m.noteTexted(CALLER, first, 'conv_fx_t2'), true, 'the earlier composition was sent');
  m.commit('conv_fx_t2');
  assert.deepEqual(textedIds(m), ['fx-place-a']);
});

test('a body changed after compose matches nothing, so nothing is recorded', () => {
  const m = call('conv_fx_t3');
  m.noteComposed('conv_fx_t3', ['Fx Alpha Kitchen'], 'Fx Alpha Kitchen\nReply STOP to opt out');
  assert.equal(m.noteTexted(CALLER, 'Fx Alpha Kitchen (shortened)', 'conv_fx_t3'), false);
  m.commit('conv_fx_t3');
  assert.deepEqual(textedIds(m), []);
});
