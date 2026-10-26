// template/road.md is template/concierge.md with the inn taken out and the place question put
// in. A fix to one must not skip the other, so this test reads both, line by line: every line of
// concierge.md must appear in road.md unchanged, unless it is listed below as rewritten for the
// road (with the reason). Change a shared line in one file and this test fails until the other
// file has it too, or the line is listed here on purpose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROAD_TEMPLATE_PATH, TEMPLATE_PATH } from '../compile.js';
import { createHash } from 'node:crypto';
import { RULES } from '../lint.js';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const body = (path) => readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
const lines = (path) => body(path).split('\n').filter((l) => l.trim());

/**
 * Lines of concierge.md the road template rewrites or drops, by their opening words, with the
 * reason and a pin: the first 16 hex of the sha256 of the whole concierge.md line as it was when
 * road.md was last brought in line with it. Opening words alone would excuse any later edit to
 * the rest of the line (a new sentence in Emergencies would never reach road.md), so the pin
 * makes a change anywhere in a rewritten line fail until road.md is reviewed and the pin moved.
 */
const REWRITTEN = new Map(/** @type {Array<[string, string, string]>} */ ([
  ['You answer the phone for {{property_name}}.', 'the line has no inn: a concierge for wherever the caller is', 'f454d0d009c310fb'],
  ['This is a phone call. Everything you say', 'the caller is anywhere, and the inn timezone is gone', '2799c37f63ef8909'],
  ['You already know where the guest is.', 'the opposite on the road: learn the city and state in the conversation', '2ce21cef0c994e00'],
  ['{{property}}', 'no inn to describe', '1484505eef256e4b'],
  ['If the first words carry urgency', 'no room problem; get the place first on the practical path', 'dfcfaca2cd926aac'],
  ['These rules come before everything above.', 'no innkeeper settings on the road line', 'ee81fddba1d05bfb'],
  ['This step is important. Codes and passwords.', 'no innkeeper or check-in message to point at', '79a3007fa39e361f'],
  ['This step is important. No promises you cannot keep.', 'no innkeeper to send rates and bookings to', 'e2ef37d76960a99e'],
  ['This step is important. Only what you know.', "no owner's picks or answers; never name a place from memory of a city", '1ac4a8b627c17ae0'],
  ['This step is important. Emergencies.', 'no innkeeper to tell afterward', '638cf14c71c4ca6d'],
  ['This step is important. Handing off to a person.', 'no person; the one transfer is the inn demo', 'b6ee834806ccc944'],
  ['{{rules}}', 'no house rules', '03835ae7cab2398a'],
  ['{{permissions}}', 'nothing sold, no partners', '0fc579b0f0e7fbef'],
  ["# Owner's notes", 'no owner', '04166d0b7adc4057'],
  ['The sections below come from the owner of', 'no owner', '3b3a6f2e2f81cc1d'],
  ['{{picks}}', 'no owner picks', '7a1b466493c5c0ed'],
  ['{{faq}}', 'no owner answers', '09f788d85f6836b7'],
  ['2. recommend_nearby.', 'takes the locality, ranks near that city', 'f09a01e643916b96'],
  ['4. cross_domain.', 'nothing to watch at an inn; something to watch tonight', '107766b631b93f4c'],
  ['This step is important. One pick at a time.', 'no owner avoid list', '35f23224a0eb9f06'],
  ['If a lookup is taking a while', "no owner's picks to fall back on", '73421fe20187fd81'],
]).map(([start, reason, pin]) => [start, { reason, pin }]));

test('every line of concierge.md is in road.md, or is listed as rewritten for the road', () => {
  const road = new Set(lines(ROAD_TEMPLATE_PATH));
  const missing = [];
  const changed = [];
  const used = new Set();
  for (const line of lines(TEMPLATE_PATH)) {
    if (road.has(line)) continue;
    const key = [...REWRITTEN.keys()].find((k) => line.startsWith(k));
    if (key) {
      used.add(key);
      const { pin } = REWRITTEN.get(key);
      if (sha(line) !== pin) changed.push(`${key.slice(0, 50)} (now ${sha(line)})`);
      continue;
    }
    missing.push(line.slice(0, 90));
  }
  assert.deepEqual(missing, [], 'a concierge.md line changed or was added; copy it to road.md, or list it here with a reason');
  assert.deepEqual(changed, [], 'a concierge.md line road.md rewrites has changed: bring road.md in line, then move the pin');
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
