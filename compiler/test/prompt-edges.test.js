// Edges heard on real calls, held in the compiled prompts: a stated need is answered with a pick
// (a drink, not a taste interview), an hour from a web search is said as given or not at all,
// the road line never promises demos it cannot reach, and the rental's counts agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../compile.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test', memoryWebhook: true,
  searchUrl: 'https://search.example.org/voice/search', searchSecretName: 'search-secret' };
const example = (name) => JSON.parse(readFileSync(new URL(`../../config/examples/${name}.json`, import.meta.url), 'utf8'));
const promptOf = (r) => r.agent.conversation_config.agent.prompt.prompt;
const road = () => promptOf(compile(example('road-line'), OPTS));
const rental = () => promptOf(compile(example('miami-rental'), { ...OPTS, persona: 'marisol' }));
const inn = () => promptOf(compile(example('demo-inn'), OPTS));

test('every line has the drink worked example: a stated need gets a pick, never a taste question', () => {
  for (const p of [road(), rental(), inn()]) {
    assert.match(p, /Second worked example\. Guest: "I want a drink\." Right: say you are checking, call recommend_nearby with kind drinks/);
    assert.match(p, /Wrong: "What have you been listening to lately\?"/);
  }
});

test('an hour from a web search is said as given, or not at all', () => {
  assert.match(road(), /Say an hour exactly as the result gives it, in words/);
  assert.match(road(), /Never round an hour or work one out/);
});

test('the road line offers something placeless to a caller abroad, never demos it cannot reach', () => {
  const p = road();
  assert.doesNotMatch(p, /two demos|Miami rental/);
  assert.match(p, /If they still have no city to give, offer something that needs no place/);
});

test('the rental counts stay questions against the same two questions as the stop rule', () => {
  const p = rental();
  assert.doesNotMatch(p, /toward the three/);
  assert.match(p, /never counts toward the two questions in the stop rule/);
  assert.doesNotMatch(p, /Message them/);
});
