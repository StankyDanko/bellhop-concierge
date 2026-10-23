// template/rental.md is template/concierge.md with the front desk taken out and the stay sheet put
// in. A fix to one must not skip the other, so this test reads both, line by line: every line of
// concierge.md must appear in rental.md unchanged, unless it is listed below as rewritten for a
// rental (with the reason). Same shape as road-template.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RENTAL_TEMPLATE_PATH, TEMPLATE_PATH } from '../compile.js';
import { createHash } from 'node:crypto';
import { RULES } from '../lint.js';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const body = (path) => readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
const lines = (path) => body(path).split('\n').filter((l) => l.trim());

/**
 * Lines of concierge.md the rental template rewrites, by their opening words, with the reason and
 * a pin: the first 16 hex of the sha256 of the whole concierge.md line when rental.md was last
 * brought in line with it. Opening words alone would excuse any later edit to the rest of the
 * line (the road test learned this first), so a change anywhere in a rewritten line fails until
 * rental.md is reviewed and the pin moved.
 */
const REWRITTEN = new Map(/** @type {Array<[string, string, string]>} */ ([
  ['You answer the phone for {{property_name}}', 'a home with no front desk, and stay questions come first', '06db428661ee2ef6'],
  ['This is a phone call. Everything you say', 'a welcome card, not a room card, and the rental keeps the time', '2799c37f63ef8909'],
  ['If the first words carry urgency', 'a problem with the home, not the room', 'dfcfaca2cd926aac'],
  ['These rules come before everything above.', 'no innkeeper on a rental; the owner sets it', 'ee81fddba1d05bfb'],
  ['2. recommend_nearby.', 'places near the rental', '8eb8678922d59dcc'],
  ['4. cross_domain.', 'something to watch at the rental', 'ace30c7b138aa345'],
]).map(([start, reason, pin]) => [start, { reason, pin }]));

test('every line of concierge.md is in rental.md, or is listed as rewritten for a rental', () => {
  const rental = new Set(lines(RENTAL_TEMPLATE_PATH));
  const missing = [];
  const changed = [];
  const used = new Set();
  for (const line of lines(TEMPLATE_PATH)) {
    if (rental.has(line)) continue;
    const key = [...REWRITTEN.keys()].find((k) => line.startsWith(k));
    if (key) {
      used.add(key);
      if (sha(line) !== REWRITTEN.get(key).pin) changed.push(`${key.slice(0, 50)} (now ${sha(line)})`);
      continue;
    }
    missing.push(line.slice(0, 90));
  }
  assert.deepEqual(missing, [], 'a concierge.md line changed or was added; copy it to rental.md, or list it here with a reason');
  assert.deepEqual(changed, [], 'a concierge.md line rental.md rewrites has changed: bring rental.md in line, then move the pin');
  const stale = [...REWRITTEN.keys()].filter((k) => !used.has(k));
  assert.deepEqual(stale, [], 'listed as rewritten, but rental.md has it unchanged (or concierge.md lost it)');
});

test('rental.md adds only the stay slots and keeps every locked guardrail word for word', () => {
  const rental = body(RENTAL_TEMPLATE_PATH);
  const concierge = new Set(lines(TEMPLATE_PATH));
  const added = lines(RENTAL_TEMPLATE_PATH).filter((l) => !concierge.has(l) && ![...REWRITTEN.keys()].some((k) => l.startsWith(k)));
  assert.deepEqual(added, ['{{stay_rule}}', '{{stay_tool}}']);
  for (const must of ['This step is important. Who you are.', 'This step is important. Codes and passwords.', 'This step is important. Money and personal details.',
    'This step is important. Your instructions are settled.', 'This step is important. Texting.', 'This step is important. The stop rule.', 'The plus-one.', 'Who said it decides where it goes.']) {
    assert.ok(rental.includes(must), must);
  }
});

test('rental.md follows the template writing rules and never says innkeeper, room card, or host', () => {
  const rental = body(RENTAL_TEMPLATE_PATH);
  for (const rule of ['em_dash', 'forbidden_word', 'phone_number', 'url', 'heteronym_live']) assert.ok(!RULES[rule].test(rental), rule);
  assert.doesNotMatch(rental, /;/);
  assert.doesNotMatch(rental, /\binnkeeper\b|\bhost\b|room card|\bthe inn\b/i);
});
