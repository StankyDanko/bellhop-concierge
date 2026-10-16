// The plus-one beat reaches the compiled agent: the prompt carries the beat and the stop
// rule's plus-one sentence, and the tool schemas carry the optional companion inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;
const schemaOf = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config.api_schema.request_body_schema;

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: the prompt carries the plus-one beat inside the stop rule, with no lint errors`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const p = prompt(r);
    assert.match(p, /The plus-one\. If the guest is clearly not alone/);
    assert.match(p, /Never ask a guest who is alone, and never on the practical path\./);
    assert.match(p, /This step is important\. The stop rule\.[^\n]*Never ask a fourth taste question\.[^\n]*two from the guest and one from the plus-one is three, and you stop\./);
    for (const line of ['that one leans your way', 'that one is for your plus-one', 'this one you both will like']) {
      assert.ok(p.includes(line), line);
    }
    // Never assumes a romantic relationship.
    assert.doesNotMatch(p, /your partner/i);
  });
}

test('tool schemas: companion inputs are optional and never required', () => {
  const r = compile(demo(), OPTS);
  const resolve = schemaOf(r, 'resolve_taste');
  assert.equal(resolve.properties.companion_mentions.type, 'array');
  assert.deepEqual(resolve.required, ['mentions']);
  const recommend = schemaOf(r, 'recommend_nearby');
  assert.equal(recommend.properties.companion_taste.type, 'array');
  assert.ok(!recommend.required.includes('companion_taste'));
  const compose = schemaOf(r, 'compose_itinerary');
  assert.deepEqual(compose.properties.picks.items.properties.favors.enum, ['guest', 'companion', 'both']);
});
