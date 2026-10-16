// Round six: after naming a film from cross_domain, the concierge said it could only recommend
// what was playing nearby and sent the guest to a streaming service, and it called a film
// night "a different genre". A cross-domain pick is offered as something to enjoy at the inn,
// never taken back, and a genre comparison is a fit claim like any other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org/', toolSecretId: 'sec_test' };
const prompt = (r) => r.agent.conversation_config.agent.prompt.prompt;

for (const persona of ['harper', 'maybelle']) {
  test(`${persona}: a cross-domain pick is offered for the inn and never disclaimed`, () => {
    const r = compile(demo(), { ...OPTS, persona });
    assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    const p = prompt(r);
    assert.match(p, /4\. cross_domain\.[^\n]*A cross-domain pick is something to watch, read, or listen to at the inn, and you offer it as that, with the other picks and in the text with them\./);
    assert.match(p, /4\. cross_domain\.[^\n]*Never take it back afterward, so "[^"]+" is right, never "I can only recommend what's playing nearby" or "you'd want a streaming service"\./);
    assert.match(p, /4\. cross_domain\.[^\n]*Never compare its genre either, so never "a different genre"\./);
  });

  test(`${persona}: a genre is a fit claim after an event's say line too`, () => {
    const p = prompt(compile(demo(), { ...OPTS, persona }));
    assert.match(p, /3\. events_nearby\.[^\n]*A genre is a fit claim too, so never "different genre" or "not your genre"/);
    // The pinned wrong and right pair is still whole.
    assert.match(p, /"that one's on Friday" is fine, never "that's a good fit for your anniversary"/);
  });
}
