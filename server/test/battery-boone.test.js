// C20 and C21, from a real call that gave no band (Boone, 2026-10-23): the agent read one pick
// of three before offering the text (C20 now expects one pick a turn and no offer in it), and two dish words came back as businesses that the reason
// line then called fan favorites. Every value here is a made-up fx- id or a fictional place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, callTool, PROPERTY } from './helpers.js';
import { evaluate } from '../battery/criteria.js';
import { loadScenarios, playScenario } from '../scripts/battery.js';

const place = (name, why = 'A spot for spaghetti') => ({ name, entity_id: `fx-${name}`, why, why_trace: { basis: 'affinity', drivers: [] }, distance_miles: 1 });
const three = [place('Fx Noodle House'), place('Fx Pie & Co'), place('Fx Late Cafe')];
const rec = (over = {}) => ({
  scenario: { id: 't', mentions: ['spaghetti'], companion_mentions: ['cheesecake'] }, tools: [], trace: [], statuses: [200],
  resolve: { status: 200, json: { resolved: [{ mention: 'spaghetti', kind: 'tag', id: 'urn:tag:specialty_dish:place:fx_spaghetti', name: 'Spaghetti', confidence: 1 }],
    companion_resolved: [{ mention: 'cheesecake', kind: 'tag', id: 'urn:tag:specialty_dish:place:fx_cheesecake', name: 'Cheesecake', confidence: 1 }], unresolved: [] } },
  recommend: { status: 200, json: { places: three, applied: { radius_miles: 3, kids: false }, counterfactual: { same: false } } },
  reduced: null, cross: null, compose: null, ...over,
});
const verdict = (id, r) => evaluate(r)[id];

test('C20: exactly one pick named and no text offer passes; two picks or an offer fails; a tool-only run is not applicable', () => {
  assert.equal(verdict('C20', rec()).verdict, 'na');
  const one = verdict('C20', rec({ spoken: { afterRecommend: 'First pick, Fx Noodle House. A spot for spaghetti.' } }));
  assert.equal(one.verdict, 'pass');
  assert.equal(one.reason, '1 of 3 picks named, no text offer');
  const two = verdict('C20', rec({ spoken: { afterRecommend: 'Fx Noodle House for spaghetti, and Fx Pie and Co for the cheesecake.' } }));
  assert.equal(two.verdict, 'fail');
  assert.equal(two.reason, '2 of 3 picks named in the turn, expected exactly one');
  assert.equal(verdict('C20', rec({ spoken: { afterRecommend: 'Fx Noodle House is a spot for spaghetti.' } })).verdict, 'pass');
  const offered = verdict('C20', rec({ spoken: { afterRecommend: 'Fx Noodle House for spaghetti. Want me to text you that?' } }));
  assert.equal(offered.verdict, 'fail');
  assert.match(offered.reason, /text was offered/);
  assert.equal(verdict('C20', rec({ spoken: { afterRecommend: 'Nothing named.' } })).verdict, 'fail');
  const none = rec({ spoken: { afterRecommend: 'Hmm.' } });
  none.recommend.json.places = [];
  assert.equal(verdict('C20', none).verdict, 'na');
});

test('C21: a dish resolved as an entity, sent to /search, or named as a fan favorite fails', () => {
  assert.equal(verdict('C21', rec()).verdict, 'pass');
  const entity = rec();
  entity.resolve.json.resolved[0] = { mention: 'spaghetti', kind: 'entity', id: 'fx-place-spaghetti', name: 'Spaghetti', confidence: 1 };
  assert.equal(verdict('C21', entity).verdict, 'fail');
  assert.equal(verdict('C21', rec({ trace: [{ tool: 'resolve_taste', endpoint: '/search', params: { query: 'cheesecake' } }] })).verdict, 'fail');
  const fans = rec();
  fans.recommend.json.places = [place('Fx Noodle House', 'Fans of Spaghetti and Cheesecake love it')];
  assert.equal(verdict('C21', fans).verdict, 'fail');
  assert.equal(verdict('C21', rec({ scenario: { id: 't', mentions: ['Sturgill Simpson'] } })).verdict, 'na');
});

test('boone-no-band plays offline: any city shape, no band, and C1, C21 pass', async () => {
  const { scenarios } = loadScenarios();
  const s = scenarios.find((x) => x.id === 'boone-no-band');
  assert.ok(s, 'the scenario exists');
  assert.equal(s.constraints.party_size, 2);
  assert.ok(s.companion_mentions.length === 1 && s.mentions.length === 2);
  const { app } = makeApp();
  const call = async (tool, body) => { const t = Date.now(); const r = await callTool(app, tool, body); return { ...r, ms: Date.now() - t }; };
  const r = await playScenario(call, s, PROPERTY);
  const e = evaluate(r);
  assert.equal(e.C1.verdict, 'pass', e.C1.reason);
  assert.equal(e.C21.verdict, 'pass', e.C21.reason);
  assert.equal(r.resolve.json.preferences.occasion, 'celebration');
});
