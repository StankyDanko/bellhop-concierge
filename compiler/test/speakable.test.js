// Every question the concierge is shown how to ask must land on first hearing, over a phone,
// with a stranger on the other end. The model copies its examples, so a clipped example
// ("Out tonight, or something good in?") turns into a clipped call. This test reads every
// spoken line the agent is given (persona sample lines, example calls, the picks, the call setup
// pools, and the question examples inside the templates and the compiled prompts) and holds each
// question to questionProblems in compiler/lint.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, listPersonas, loadPersona } from '../compile.js';
import { proseQuestions, QUESTION_FILLER, questionProblems, sentences } from '../lint.js';
import { SAMPLE_NAME, spokenLines } from '../../server/conversation/choose.js';

const PERSONAS_DIR = new URL('../../personas/', import.meta.url);
const ROOT = new URL('../../', import.meta.url);

/** Every concierge line in a persona: the quoted sample lines, and the concierge turns of the examples. */
function personaLines(id) {
  const p = loadPersona(id, PERSONAS_DIR.pathname);
  const quoted = [...p.sections['sample lines'].matchAll(/"([^"]*)"/g)].map((m) => m[1]).filter((s) => !s.includes('{{'));
  const turns = ['example calls', 'reading the picks'].flatMap((k) => p.sections[k].split('\n'))
    .map((l) => new RegExp(`^${p.display_name}: "(.*)"$`).exec(l.trim())?.[1]).filter(Boolean);
  return [...quoted, ...turns].map((text) => ({ where: id, text }));
}

const spoken = () => [
  ...listPersonas(PERSONAS_DIR.pathname).flatMap(personaLines),
  ...spokenLines(),
];

test('every spoken question is a whole sentence with no comma riders', () => {
  const bad = [];
  let checked = 0;
  for (const { where, text } of spoken()) {
    for (const s of sentences(text)) {
      if (QUESTION_FILLER.test(s)) bad.push(`${where}: filler "${s}"`);
      if (!s.endsWith('?')) continue;
      checked += 1;
      for (const why of questionProblems(s)) bad.push(`${where}: "${s}" (${why})`);
    }
  }
  assert.ok(checked > 60, `only ${checked} questions found; the reader lost its grip`);
  assert.deepEqual(bad, []);
});

test('every question example inside the templates and the compiled prompts reads whole', () => {
  const texts = ['concierge', 'road', 'rental'].map((n) => [`template/${n}.md`, readFileSync(new URL(`template/${n}.md`, ROOT), 'utf8').replace(/<!--[\s\S]*?-->/g, '')]);
  for (const f of ['road-line', 'miami-rental', 'demo-inn']) {
    const cfg = JSON.parse(readFileSync(new URL(`config/examples/${f}.json`, ROOT), 'utf8'));
    const out = compile(cfg, { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test', memoryWebhook: true });
    texts.push([f, out.agent.conversation_config.agent.prompt.prompt]);
  }
  const bad = [];
  for (const [where, text] of texts) {
    const qs = proseQuestions(text);
    assert.ok(qs.length >= 8, `${where}: only ${qs.length} questions found`);
    // The two worked "wrong" answers in the stop rule are quoted on purpose.
    for (const q of qs.filter((x) => !/usually go for|into lately/.test(x))) {
      for (const why of questionProblems(q)) bad.push(`${where}: "${q}" (${why})`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the check bites on the clipped questions heard on real calls', () => {
  for (const q of ['Out tonight, or something good in?', 'Hungry, or looking for something else?', 'Walk, or drive?',
    "What's not working, too loud?", 'Hungry, or just looking around?', "What's the mood, something lively, or low key?",
    'Your speed?', 'Close?', 'Who\'ve I got?', 'Dinner tonight, spicy and loud, or slow and candlelit?', 'Movie, or a good book?']) {
    assert.notDeepEqual(questionProblems(q), [], q);
  }
  assert.ok(QUESTION_FILLER.test('Easy one.'));
});

test('whole questions, short answers, and an identity check pass', () => {
  for (const q of ['Are you thinking about heading out tonight, or would you rather stay in and get cozy?',
    'Should I find you some food, or are you after something to do?', "What didn't feel right about it?", 'Was it too loud?',
    'Want me to text the ones you liked?', `Is this ${SAMPLE_NAME}?`, `Is that you again, ${SAMPLE_NAME}?`,
    'Since you just got in, have you had a chance to eat yet?', 'Got it.', 'Looking now.']) {
    assert.deepEqual(questionProblems(q), [], q);
  }
});
