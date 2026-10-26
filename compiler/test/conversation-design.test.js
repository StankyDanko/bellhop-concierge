// How the concierge talks, held in every compiled agent:
//   - the first message only asks who is calling, and the recording note comes in the next turn
//   - the old taste quiz ("what have you been loving lately, a band, a dish, a show?") is gone
//     from every file the agent is built from, and from every compiled prompt
//   - tastes come from the chat, the guest talks more, nothing is read back
//   - the examples are shapes: bracketed placeholders, and a rule that their wording is never reused
//   - a personality section with banter rules and what is never fair game

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../compile.js';
import { RECORDING_NOTE } from '../lint.js';
import { demo } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const cfg = (name) => JSON.parse(readFileSync(join(ROOT, 'config/examples', `${name}.json`), 'utf8'));
const AGENTS = {
  harper: (o) => compile(demo(), { ...OPTS, ...o, persona: 'harper' }),
  maybelle: (o) => compile(demo(), { ...OPTS, ...o, persona: 'maybelle' }),
  hollis: (o) => compile(cfg('road-line'), { ...OPTS, ...o }),
  marisol: (o) => compile(cfg('miami-rental'), { ...OPTS, ...o }),
};
const QUIZ = /loving lately|in your feed|your reading lately|been into lately|a band, a dish, a show|what city and state you're in|city and state, so/i;

/** Every file under a directory, recursively. */
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test('the old taste quiz is gone from every source the agents are built from', () => {
  // Tests may name the phrase to forbid it; the template may only forbid it, in its one rule.
  const RULE = 'Never ask what they have been loving lately';
  const sources = ['template', 'personas', 'server/conversation', 'config', 'compiler'].flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => /\.(md|json|js)$/.test(f) && !f.includes(`${join('compiler', 'test')}`));
  const hits = sources.filter((f) => QUIZ.test(readFileSync(f, 'utf8').replaceAll(RULE, ''))).map((f) => f.slice(ROOT.length));
  assert.deepEqual(hits, []);
});

for (const [who, build] of Object.entries(AGENTS)) {
  for (const memoryWebhook of [false, true]) {
    test(`${who}${memoryWebhook ? ' with memory' : ''}: opens by asking the name, then the recording note, and never quizzes`, () => {
      const r = build({ memoryWebhook });
      const a = r.agent.conversation_config.agent;
      const first = a.first_message.replace('{{opener_hook}}', a.dynamic_variables.dynamic_variable_placeholders.opener_hook);
      assert.match(first, /^.*\bthis is \w+, your .*concierge.*, who (am I|have I got)\b.*\?$/i, first);
      assert.doesNotMatch(first, /recorded|text|city|state|band|dish/i, 'the first message is only the name question');
      const p = a.prompt.prompt;
      assert.ok(p.includes(RECORDING_NOTE));
      assert.match(p, /The recording note is never skipped on a first call/);
      assert.match(p, /is not a name and not a place\. Ask again lightly/);
      assert.match(p, /Never ask what they have been loving lately/, 'the one place the phrase may appear is the rule against it');
      assert.equal(p.match(/loving lately/g).length, 1);
      assert.match(p, /Tastes come as a side effect of the chat/);
      assert.match(p, /One signal plus what they want tonight is enough for a first pick/);
      assert.match(p, /Never read back what they told you, never sum up the call/);
      assert.match(p, /The examples below show shapes, never lines\. Never reuse their wording/);
      assert.match(p, /Words in square brackets are placeholders/);
      assert.match(p, /How you are fun\./);
      assert.match(p, /Never fair game: loneliness, money, looks/);
      assert.match(p, /Tease choices, never the person's pain/);
      assert.doesNotMatch(p, /Wes Anderson|Kacey Musgraves|Khruangbin|Bad Bunny|Celia Cruz/, 'no memorable name in a line the agent could repeat');
      assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
    });
  }
}

test('every example line in every persona keeps its names in brackets', () => {
  for (const f of readdirSync(join(ROOT, 'personas')).filter((x) => x.endsWith('.md') && x !== 'README.md')) {
    const text = readFileSync(join(ROOT, 'personas', f), 'utf8');
    const calls = /^## Example calls \(compiled\)\n([\s\S]*?)(?=^## )/m.exec(text)[1];
    assert.match(calls, /\[name\]|\[town\]|\[a dish\]/, `${f}: placeholders in the example calls`);
  }
});
