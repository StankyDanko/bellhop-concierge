// Round six: resolve_taste returned "Wes Anderson films" and "Radiohead" as unresolved, and
// the concierge said them back as tastes it was using. An unresolved name is said to be not
// found, gets one "what is it most like?", and never counts toward the three named things.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;
const tool = (r, name) => r.tools.find((t) => t.tool_config.name === name).tool_config;

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: an unresolved name is not found, asked about once, and never echoed or counted`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const p = prompt(r);
    assert.match(p, /A name the tools cannot find: when resolve_taste lists a name as unresolved, say plainly that you could not find that one, and ask once what it is most like\./);
    assert.match(p, /An unresolved name is not a signal, and you never say it back as a taste you are using\./);
    assert.match(p, /"I couldn't find that one, what is it most like\?" is right, never "Sturgill Simpson and Radiohead, got it" when Radiohead came back unresolved/);
    assert.doesNotMatch(p, /Never say you could not find it/);
    assert.match(p, /1\. resolve_taste\.[^\n]*Say back only the names in that line\.[^\n]*never pass it to the next tools\./);
    // The stop rule stays whole.
    assert.match(p, /This step is important\. The stop rule\.[^\n]*Never ask two taste questions in a row\./);
    assert.match(tool(r, 'resolve_taste').description, /A mention it returns in unresolved was not found: never say it back as a taste you are using and never count it as a named thing\./);
  });
}
