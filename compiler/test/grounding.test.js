// What the concierge may add to a tool's words, checked in the compiled agent: after an
// event's say line, only the day and the venue, never a fit, a mood, or an occasion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

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
