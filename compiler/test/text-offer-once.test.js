// A real call (Dublin, 2026-10-25): the text was offered five times in eight minutes, and the
// guest said it was getting obnoxious. A worked example outranks a rule, so no model-visible
// line may model the offer either. The text is offered once per call, the first time the picks
// are read, and after that the guest asks. All three templates carry the same rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../compile.js';
import { demo } from './helpers.js';

const OPTS = { toolBaseUrl: 'https://tools.example.org', toolSecretId: 'sec_test' };
const cfg = (name) => JSON.parse(readFileSync(new URL(`../../config/examples/${name}.json`, import.meta.url), 'utf8'));
const promptOf = (r) => r.agent.conversation_config.agent.prompt.prompt;
const everything = (r) => [promptOf(r), r.agent.conversation_config.agent.first_message ?? '',
  ...r.tools.map((t) => t.tool_config.description ?? '')].join('\n');

const RULE = 'Offer the text at most once on a call: the first time you read the picks, in one short clause after the last pick';
const NEVER_AGAIN = 'never offer the text again on this call: not after later picks, not after an answer, not when you say goodbye. The guest asks when they want it.';

const prompts = {
  road: () => compile(cfg('road-line'), OPTS),
  rental: () => compile(cfg('miami-rental'), { ...OPTS, persona: 'marisol' }),
  harper: () => compile(demo(), { ...OPTS, persona: 'harper' }),
  maybelle: () => compile(demo(), { ...OPTS, persona: 'maybelle' }),
};

for (const [name, make] of Object.entries(prompts)) {
  test(`${name}: the text is offered once per call, then only when the guest asks`, () => {
    const r = make();
    const p = promptOf(r);
    assert.ok(p.includes(RULE), 'the once-per-call rule');
    assert.ok(p.includes(NEVER_AGAIN), 'the never-again clause');
    assert.match(p, /Send a text only after the guest has asked for it or said yes to your offer, never on your own\./);
    assert.match(p, /If you have not offered the text yet on this call, add the offer once/);
  });

  test(`${name}: no line left that offers the text on every answer`, () => {
    const all = everything(make());
    assert.doesNotMatch(all, /before you offer the text/);
    assert.doesNotMatch(all, /Offer to text it instead/);
    assert.doesNotMatch(all, /offer the name and the text/);
    assert.doesNotMatch(all, /want it in the text\?/);
    assert.doesNotMatch(all, /Offer to text the names/);
    assert.doesNotMatch(all, /and in the text with them/);
    assert.doesNotMatch(all, /I can text you the names/);
  });

  test(`${name}: the safety rules around the text are untouched`, () => {
    const p = promptOf(make());
    for (const rule of [
      'You can only text the number the guest is calling from',
      'Never text any other number, never ask for a number, and never say a number out loud.',
      'Never say a text was sent until the text tool has returned a success.',
      'When send_sms says texting is in test mode, say that',
      'that number is the count the tools returned, never more',
    ]) assert.ok(p.includes(rule), rule);
  });
}
