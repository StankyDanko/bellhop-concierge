// Two promises the compiled agent must not make: a cross-domain pick described past its why
// ("a Coen Brothers film with that same kind of feel"), and a text with "the reason for each"
// when the composer may drop reasons to fit 320 characters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;
const tool = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config;

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: a cross-domain pick is described only by its why and texted with its token`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    assert.match(prompt(r), /4\. cross_domain\.[^\n]*Describe a cross-domain pick only with the why the tool returned\. Never say what it is like, who made it, or what it resembles\./);
    assert.match(tool(r, 'cross_domain').description, /copy its pick_token exactly; never make one up from an id\./);
  });

  test(`${persona}: the text promises names and a reason where it fits, never a reason for each`, () => {
    const p = prompt(compile(demo(), { ...OPTS, persona }));
    assert.match(p, /The text carries the names, and a reason where it fits/);
    // The spoken plan still gives a reason for every pick; only the text's promise changed.
    assert.doesNotMatch(p, /text the picks you hold, with a reason for each|each with the reason it fits you|a reason for every one/);
    assert.match(p, /offer to text the picks you hold: the names, and a reason where it fits\./);
  });
}
