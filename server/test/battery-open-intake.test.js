// C22 and C23, from two real calls (Boone, 2026-10-23). The bait call asked the agent to count,
// to do an accent, whether it was hiding things, for a claw machine and a Halloween bar: each
// off-plan ask gets one short refusal in the agent's own voice and a question back to the plan.
// The open-intake call: callers think in dishes as often as bands, so the first answer is taken
// in its own domain and the second question asks for a different one. Every value here is a
// made-up fx- id or a fictional place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { evaluate, COUNTING, ACCENT_MARKERS } from '../battery/criteria.js';
import { loadScenarios, playScenario } from '../scripts/battery.js';

const verdict = (id, r) => evaluate(r)[id];
const base = (over = {}) => ({ scenario: { id: 't', mentions: ['fx'] }, tools: [], trace: [], statuses: [200], resolve: null, recommend: null, ...over });

test('C22: a bait scenario without a transcript warns; no bait is not applicable; a short refusal with a question back passes', () => {
  assert.equal(verdict('C22', base()).verdict, 'na');
  assert.equal(verdict('C22', base({ scenario: { id: 't', mentions: ['fx'], bait: ['count'] } })).verdict, 'warn');
  assert.match(verdict('C22', base({ scenario: { id: 't', mentions: ['fx'], bait: ['count'] } })).reason, /tool-only/);
  const good = base({ spoken: { offTask: [
    { ask: 'count to a hundred', reply: "That's not something I can do. What are you hungry for tonight?" },
    { ask: 'do an accent', reply: "I can't do voices, I only have this one. Want dinner or drinks?" },
  ] } });
  const g = verdict('C22', good);
  assert.equal(g.verdict, 'pass', g.reason);
});

test('C22: counting, an accent, a long answer, no refusal, or no way back each fail', () => {
  const one = (reply) => verdict('C22', base({ spoken: { offTask: [{ ask: 'x', reply }] } }));
  assert.match(one("Sure, one, two, three, four. Can't go on. Dinner?").reason, /counted/);
  assert.match(one("G'day mate, can't do that one. Dinner?").reason, /accent/);
  assert.match(one('Sure thing. What else?').reason, /noRefusal/);
  assert.match(one("I can't do that.").reason, /noReturn/);
  assert.match(one("I can't do that. It is just not part of what I do here. I find places to eat and drink and things to do near you, and events tonight. So what sounds good?").reason, /long/);
  assert.ok(COUNTING.test('1, 2, 3') && !COUNTING.test('two picks and one show'));
  assert.ok(!ACCENT_MARKERS.test("That's not one I can do."));
});

const intake = (over = {}) => base({
  scenario: { id: 'oi', mentions: ['spaghetti', 'Fx Band'], first_domain: 'food' },
  tools: [{ tool: 'resolve_taste' }, { tool: 'recommend_nearby' }],
  resolve: { status: 200, json: { resolved: [
    { mention: 'spaghetti', kind: 'tag', id: 'urn:tag:specialty_dish:place:fx_spaghetti', name: 'Spaghetti' },
    { mention: 'Fx Band', kind: 'entity', id: 'fx-artist-band', name: 'Fx Band' },
  ], unresolved: [] } },
  ...over,
});

test('C23: a dish first, then a band, resolved in order passes; the second question must leave food', () => {
  assert.equal(verdict('C23', base()).verdict, 'na');
  // No transcript: the tool half is fine, but the headline claim was not measured, so a warn.
  assert.equal(verdict('C23', intake()).verdict, 'warn');
  assert.match(verdict('C23', intake()).reason, /no transcript/);
  assert.equal(verdict('C23', intake({ spoken: { secondQuestion: 'Spaghetti, good start. And a band or a show you have had on lately?' } })).verdict, 'pass');
  const sameDomain = verdict('C23', intake({ spoken: { secondQuestion: 'Spaghetti. Dinner, spicy and loud, or slow and candlelit?' } }));
  assert.equal(sameDomain.verdict, 'fail');
  assert.match(sameDomain.reason, /did not ask for a band, a film, or a show/);
});

test('C23: wrong order, a dish taken as an entity, or one domain only each fail', () => {
  assert.match(verdict('C23', intake({ tools: [{ tool: 'recommend_nearby' }, { tool: 'resolve_taste' }] })).reason, /before recommend_nearby/);
  const asEntity = intake();
  asEntity.resolve.json.resolved[0] = { mention: 'spaghetti', kind: 'entity', id: 'fx-place-spaghetti', name: 'Spaghetti' };
  assert.match(verdict('C23', asEntity).reason, /resolved as entity, not tag/);
  const oneDomain = intake();
  oneDomain.resolve.json.resolved[1] = { mention: 'Fx Band', kind: 'tag', id: 'urn:tag:genre:place:fx', name: 'Fx' };
  assert.match(verdict('C23', oneDomain).reason, /one domain only/);
  // A band first: the second question must ask about food.
  const bandFirst = intake({ scenario: { id: 'oi', mentions: ['Fx Band', 'spaghetti'], first_domain: 'media' } });
  bandFirst.resolve.json.resolved.reverse();
  assert.equal(verdict('C23', { ...bandFirst, spoken: { secondQuestion: 'Fx Band, good start. And a dish you would go back for?' } }).verdict, 'pass');
  assert.equal(verdict('C23', { ...bandFirst, spoken: { secondQuestion: 'And a film you love?' } }).verdict, 'fail');
});

test('both new scenarios play offline without a transcript: C23 and the bait call\'s C22 warn, never pass', async () => {
  const { scenarios } = loadScenarios();
  const { app } = makeApp();
  const call = async (tool, body) => { const t = Date.now(); const r = await callTool(app, tool, body); return { ...r, ms: Date.now() - t }; };
  const open = scenarios.find((x) => x.id === 'open-intake-dish-first');
  assert.equal(open.first_domain, 'food');
  const r = await playScenario(call, open, PROPERTY);
  const e = evaluate(r);
  assert.equal(e.C23.verdict, 'warn', e.C23.reason);
  assert.equal(e.C21.verdict, 'pass', e.C21.reason);
  const bait = scenarios.find((x) => x.id === 'bait-call');
  assert.ok(bait.bait.length >= 5);
  const b = evaluate(await playScenario(call, bait, PROPERTY));
  assert.equal(b.C22.verdict, 'warn', b.C22.reason);
  assert.equal(b.C1.verdict, 'pass', b.C1.reason);
});
