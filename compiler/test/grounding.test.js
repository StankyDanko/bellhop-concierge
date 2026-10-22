// What the concierge may add to a tool's words, checked in the compiled agent: after an
// event's say line, only the day and the venue, never a fit, a mood, or an occasion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';
import { shapePlace } from '../../server/tools/places.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;
const tool = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config;

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: after an event's say line, only the day and the venue, with a wrong and right pair`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const p = prompt(r);
    assert.match(p, /Say that line as given\. After it you may add only the day and the venue, never a word about fit, mood, or who it suits, and never tie it to an occasion the tool did not mention/);
    assert.match(p, /"that one's on Friday" is fine, never "that's a good fit for your anniversary"/);
    assert.match(tool(r, 'events_nearby').description, /add only the day or the venue, never a fit, a mood, or an occasion\./);
  });
}

// A fact the tool did not return is not listed, never inferred. recommend_nearby returns each
// place's own cuisine and feel tag names and nothing about hours or parking
// (server/tools/places.js shapePlace).
for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: a fact the tool did not return is "not listed", never guessed from a name`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const p = prompt(r);
    assert.match(p, /This step is important\. Only what you know\.[^\n]*If a guest asks something the tool did not return, like the cuisine, the hours, the price, or parking, say you do not have that listed, and offer the name and the text so they can check\. Never work it out from a place's name/);
    // The sentences the guardrail already had are still there, whole.
    assert.match(p, /Describe a place only with the words in its tool result or its reason line\. If the result does not say what a place feels like, do not say what it feels like\./);
    assert.match(p, /never "the name suggests Thai"/);
    assert.match(tool(r, 'recommend_nearby').description, /Each place lists its own cuisine and feel words in tags; it returns no hours or parking, so never state them or guess them from a name\./);
  });
}

test('a shaped place names only its own cuisine and feel tags, and no hours or parking', () => {
  const entity = { name: 'Fx Place', entity_id: 'fx-place', address: '1 Sample Sq', price_level: 2, rating: 4.5,
    location: { lat: 32.08, lng: -81.09 }, affinity: 0.9, tags: [
      { tag_id: 'urn:tag:genre:place:restaurant:fx_thai', name: 'Fx Thai' },
      { tag_id: 'urn:tag:ambience:qloo:fx_cozy', name: 'Fx Cozy' },
      { tag_id: 'urn:tag:parking:place:fx_lot', name: 'Fx Lot' },
    ] };
  const place = shapePlace(entity, [], { lat: 32.08, lng: -81.09 });
  assert.deepEqual(place.tags, ['Fx Thai', 'Fx Cozy']);
  for (const key of ['cuisine', 'hours', 'parking']) assert.equal(key in place, false, key);
  // No tags of its own, nothing named: the list is never filled in from the place's name.
  assert.deepEqual(shapePlace({ ...entity, name: 'Fx Thai Kitchen', tags: [] }, [], { lat: 32.08, lng: -81.09 }).tags, []);
});
