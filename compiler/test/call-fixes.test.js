// Four fixes from real calls on the road line, held in the compiled prompts of every persona:
//   - after a text goes out the agent asks if there is anything else; the call does not end
//   - nothing assumes a plus-one or a party of two
//   - the bet is rule-shaped, never a fixed name, and a guess is not a taste
//   - the shared taste is named at most once across a set of picks
//   - "look wider" changes the call (radius, window)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const cfg = (name) => JSON.parse(readFileSync(new URL(`../../config/examples/${name}.json`, import.meta.url), 'utf8'));
const prompts = {
  harper: compile(demo(), { ...OPTS, persona: 'harper' }),
  maybelle: compile(demo(), { ...OPTS, persona: 'maybelle' }),
  hollis: compile(cfg('road-line'), OPTS),
  marisol: compile(cfg('miami-rental'), OPTS),
};
const promptOf = (r) => r.agent.conversation_config.agent.prompt.prompt;
const tool = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config;

for (const [who, r] of Object.entries(prompts)) {
  const p = promptOf(r);

  test(`${who}: after a text goes out, ask if there is anything else and keep the call open`, () => {
    assert.match(p, /ask if there is anything else/);
    assert.match(p, /keep the call open/);
    assert.doesNotMatch(p, /wish them a good evening and end the call/);
    assert.doesNotMatch(p, /"Sent\.? [^"]*(good evening|goodbye)/i);
    assert.match(tool(r, 'send_sms').description, /sent true/);
    const end = r.agent.conversation_config.agent.prompt.built_in_tools.end_call.description;
    assert.match(end, /when the guest says they are done/);
    assert.doesNotMatch(end, /after a text is confirmed sent/);
  });

  test(`${who}: no plus-one and no party of two is assumed`, () => {
    assert.doesNotMatch(p, /assume two adults|two people,|Two of you, tonight, a short drive\. Anything|planning for two/i);
    assert.match(p, /Never assume a plus-one/);
  });

  test(`${who}: the bet is built from this call, never a fixed name`, () => {
    assert.doesNotMatch(p, /Wes Anderson (person|sort|kind of evening)/);
    assert.match(p, /Build the guess only from what this guest said on this call/);
    assert.match(p, /never send the guessed name to resolve_taste and never give it as a reason/);
  });

  test(`${who}: the shared taste is named at most once across the picks`, () => {
    assert.match(p, /Name the taste you share with the guest at most once across the whole set of picks/);
  });

  test(`${who}: look wider changes the call`, () => {
    assert.match(p, /look wider/);
    assert.match(p, /never the same call twice/);
  });
}

test('the events tool takes a radius and a week window; recommend_nearby says how to widen', () => {
  const r = prompts.hollis;
  const events = tool(r, 'events_nearby').api_schema.request_body_schema.properties;
  assert.deepEqual(events.when.enum, ['tonight', 'weekend', 'week']);
  assert.equal(events.radius_miles.type, 'number');
  assert.match(tool(r, 'recommend_nearby').api_schema.request_body_schema.properties.radius_miles.description, /look wider/);
  const compose = tool(r, 'compose_itinerary').api_schema.request_body_schema.properties.picks.items.properties;
  assert.ok(compose.blurb);
  assert.equal(compose.why, undefined);
});
