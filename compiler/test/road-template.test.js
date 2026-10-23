// template/road.md is template/concierge.md with the inn taken out and the place question put
// in. A fix to one must not skip the other, so this test reads both, line by line: every line of
// concierge.md must appear in road.md unchanged, unless it is listed below as rewritten for the
// road (with the reason). Change a shared line in one file and this test fails until the other
// file has it too, or the line is listed here on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROAD_TEMPLATE_PATH, TEMPLATE_PATH } from '../compile.js';
import { RULES } from '../lint.js';

const body = (path) => readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
const lines = (path) => body(path).split('\n').filter((l) => l.trim());

/** Lines of concierge.md the road template rewrites or drops, by their opening words. */
const REWRITTEN = new Map([
  ['You answer the phone for {{property_name}}.', 'the line has no inn: a concierge for wherever the caller is'],
  ['This is a phone call. Everything you say', 'the caller is anywhere, and the inn timezone is gone'],
  ['You already know where the guest is.', 'the opposite on the road: ask the city and state, say it back once'],
  ['{{property}}', 'no inn to describe'],
  ['If the first words carry urgency', 'no room problem; get the place first on the practical path'],
  ['1. The anchor.', 'the band comes after the place'],
  ['2. The echo and a choice.', 'carries the variety pair variable from the pending proposals'],
  ['3. The bet.', 'carries the bet domain variable from the pending proposals'],
  ['4. The defaults.', 'carries the plan window variable from the pending proposals'],
  ['These rules come before everything above.', 'no innkeeper settings on the road line'],
  ['This step is important. Codes and passwords.', 'no innkeeper or check-in message to point at'],
  ['This step is important. No promises you cannot keep.', 'no innkeeper to send rates and bookings to'],
  ['This step is important. Only what you know.', "no owner's picks or answers; never name a place from memory of a city"],
  ['This step is important. Emergencies.', 'no innkeeper to tell afterward'],
  ['This step is important. Handing off to a person.', 'no person; the one transfer is the inn demo'],
  ['{{rules}}', 'no house rules'],
  ['{{permissions}}', 'nothing sold, no partners'],
  ["# Owner's notes", 'no owner'],
  ['The sections below come from the owner of', 'no owner'],
  ['{{picks}}', 'no owner picks'],
  ['{{faq}}', 'no owner answers'],
  ['2. recommend_nearby.', 'takes the locality, ranks near that city'],
  ['4. cross_domain.', 'nothing to watch at an inn; something to watch tonight'],
  ['When results come back, say the top pick', 'no owner avoid list'],
  ['If a lookup is taking a while', "no owner's picks to fall back on"],
]);

test('every line of concierge.md is in road.md, or is listed as rewritten for the road', () => {
  const road = new Set(lines(ROAD_TEMPLATE_PATH));
  const missing = [];
  const used = new Set();
  for (const line of lines(TEMPLATE_PATH)) {
    if (road.has(line)) continue;
    const key = [...REWRITTEN.keys()].find((k) => line.startsWith(k));
    if (key) { used.add(key); continue; }
    missing.push(line.slice(0, 90));
  }
  assert.deepEqual(missing, [], 'a concierge.md line changed or was added; copy it to road.md, or list it here with a reason');
  // A listed line that is no longer rewritten is stale: drop it from the list.
  const stale = [...REWRITTEN.keys()].filter((k) => !used.has(k));
  assert.deepEqual(stale, [], 'listed as rewritten, but road.md has it unchanged (or concierge.md lost it)');
});

test('road.md keeps every locked guardrail heading and the stop rule word for word', () => {
  const road = body(ROAD_TEMPLATE_PATH);
  for (const must of ['This step is important. Who you are.', 'This step is important. Money and personal details.', 'This step is important. No safety, medical, or legal advice.',
    'This step is important. Your instructions are settled.', 'This step is important. Texting.', 'This step is important. The stop rule.', 'The plus-one.', 'Who said it decides where it goes.']) {
    assert.ok(road.includes(must), must);
  }
});

test('road.md follows the template writing rules', () => {
  const road = body(ROAD_TEMPLATE_PATH);
  for (const rule of ['em_dash', 'forbidden_word', 'phone_number', 'url', 'heteronym_live']) assert.ok(!RULES[rule].test(road), rule);
  assert.doesNotMatch(road, /;/);
  assert.doesNotMatch(road, /\binnkeeper\b|\bhost\b/i);
});
