// A guest is never asked for another taste to unlock a pick: the compiled prompt says so, no
// compiled prompt tells the concierge to ask what a thing is most like, and cross_domain
// carries the two flags (lesser_known, older_ok) the prompt tells the agent to set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;
const tool = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config;

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: the prompt never asks for another taste, and always makes a pick`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const p = prompt(r);
    assert.match(p, /Never make the guest work for a pick\. Always make a pick with what you already have/);
    assert.match(p, /A miss is your problem, never the guest's/);
    assert.match(p, /The guest's reaction to a pick is how you learn more/);
    assert.match(p, /set older_ok/);
    assert.match(p, /set lesser_known/);
    assert.match(p, /Never offer a title you already offered on this call/);
    assert.doesNotMatch(p, /and ask once what it is most like/);
    assert.doesNotMatch(p, /what's it most like\?|Give me something else|tell me one more/i);
  });
}

test('cross_domain carries lesser_known and older_ok, and its description says never to ask for a taste', () => {
  const t = tool(compile(demo(), { ...OPTS, persona: 'harper' }), 'cross_domain');
  const props = t.api_schema.request_body_schema.properties;
  assert.equal(props.lesser_known.type, 'boolean');
  assert.equal(props.older_ok.type, 'boolean');
  assert.ok(!(t.api_schema.request_body_schema.required ?? []).some((k) => k === 'lesser_known' || k === 'older_ok'));
  assert.match(t.description, /never ask the guest for another taste/);
});
