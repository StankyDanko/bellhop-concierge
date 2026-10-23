// The worked example calls teach the agent more than any rule written next to them, so they
// must obey the stop rule exactly. This test parses every persona's "Example calls" section
// and its uncompiled "Example call checks" list and fails if an example:
//   - puts more than three concierge questions before the lookup (the opener's band question
//     counts as the first, since every example opens by answering or ignoring it),
//   - asks any question once the caller has given three named things, or
//   - ends on a question instead of the lookup line, or
//   - asks the bet once the caller has named a companion (the plus-one takes the bet's slot).
// See "Example calls and the stop rule" in compiler/README.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listPersonas, loadPersona } from '../compile.js';

const PERSONAS_DIR = new URL('../../personas/', import.meta.url);
const MAX_QUESTIONS = 3;
const STOP_AT_NAMED = 3;

/** @returns {Array<{ title: string, turns: Array<{ who: 'guest'|'concierge', text: string }> }>} */
export function parseExamples(section, displayName) {
  return section.split(/\n\s*\n/).map((block) => {
    const [title, ...lines] = block.trim().split('\n');
    const turns = lines.map((line) => {
      const m = /^([A-Za-z]+): "(.*)"$/.exec(line.trim());
      if (!m) throw new Error(`unparseable example line: ${line}`);
      if (m[1] !== 'Guest' && m[1] !== displayName) throw new Error(`unknown speaker ${m[1]} in: ${line}`);
      return { who: m[1] === 'Guest' ? 'guest' : 'concierge', text: m[2] };
    });
    return { title: title.trim().replace(/\.$/, ''), turns };
  });
}

/** "- Title: 1, 2, 3" lines under "## Example call checks". */
export function parseChecks(fileText) {
  const m = /^## Example call checks\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(fileText);
  if (!m) return null;
  /** @type {Map<string, number[]>} */
  const out = new Map();
  for (const line of m[1].split('\n')) {
    const row = /^- (.+?): ([\d, ]+)$/.exec(line.trim());
    if (row) out.set(row[1].trim(), row[2].split(',').map((n) => Number(n.trim())));
  }
  return out;
}

/** A road persona's question about where the caller is: never a taste question. */
export const PLACE_QUESTION = /\b(city|state|town)\b/i;

/** A rental persona's offer after a stay answer ("want me to plan your night?"): never a taste question. */
export const STAY_OFFER = /\bplan your night\b|\bfor the stay\b/i;

/**
 * Walk one example; return the question count and every stop-rule breach.
 * A road persona's opener asks where the caller is, not for a band, so it does not count, and
 * neither does a follow-up place question such as "Which state?".
 */
export function audit(example, named, { road = false, rental = false } = {}) {
  let questions = road ? 0 : 1; // the opener's band question
  let guestTurn = -1;
  const breaches = [];
  for (const t of example.turns) {
    if (t.who === 'guest') { guestTurn += 1; continue; }
    if (!t.text.includes('?')) continue;
    if (road && PLACE_QUESTION.test(t.text) && !/\b(band|dinner|loves)\b/i.test(t.text)) continue;
    if (rental && STAY_OFFER.test(t.text)) continue;
    questions += 1;
    if (guestTurn >= 0 && named[guestTurn] >= STOP_AT_NAMED) breaches.push(`question after ${named[guestTurn]} named things: "${t.text}"`);
  }
  return { questions, breaches };
}

/** A guest turn that says the caller is not alone: we, us, our, or my wife, my friend, and so on. */
export const COMPANION = /\b(we|we're|us|our|my (wife|husband|partner|friend|girlfriend|boyfriend|date|kid|son|daughter|mom|dad))\b/i;
/** A concierge question that is the bet (or a persona's name for it, like the hunch). */
export const BET = /\b(bet|betting|warm|way off|hunch|feeling you're)\b/i;

/** Every bet question in an example that names a companion anywhere in a guest turn. */
export function betsWithCompanion(example) {
  const named = example.turns.some((t) => t.who === 'guest' && COMPANION.test(t.text));
  if (!named) return [];
  return example.turns.filter((t) => t.who === 'concierge' && t.text.includes('?') && BET.test(t.text)).map((t) => t.text);
}

for (const id of listPersonas(PERSONAS_DIR.pathname)) {
  test(`${id}: example calls obey the stop rule`, () => {
    const persona = loadPersona(id, PERSONAS_DIR.pathname);
    const checks = parseChecks(readFileSync(new URL(`${id}.md`, PERSONAS_DIR), 'utf8'));
    assert.ok(checks, `${id}: missing "## Example call checks" section`);
    const examples = parseExamples(persona.sections['example calls'], persona.display_name);
    assert.deepEqual([...checks.keys()], examples.map((e) => e.title), `${id}: checks list must name every example, in order`);
    for (const ex of examples) {
      const named = /** @type {number[]} */ (checks.get(ex.title));
      const guestTurns = ex.turns.filter((t) => t.who === 'guest').length;
      assert.equal(named.length, guestTurns, `${id} / ${ex.title}: one count per guest turn`);
      named.forEach((n, i) => assert.ok(i === 0 || n >= named[i - 1], `${id} / ${ex.title}: counts never go down`));
      const { questions, breaches } = audit(ex, named, { road: persona.mode === 'road', rental: persona.mode === 'rental' });
      assert.ok(questions <= MAX_QUESTIONS, `${id} / ${ex.title}: ${questions} questions before the lookup`);
      assert.deepEqual(breaches, [], `${id} / ${ex.title}`);
      assert.ok(!ex.turns.at(-1).text.includes('?'), `${id} / ${ex.title}: must end on the lookup, not a question`);
      assert.equal(ex.turns.at(-1).who, 'concierge');
      assert.deepEqual(betsWithCompanion(ex), [], `${id} / ${ex.title}: a companion is named, so the plus-one takes the bet's slot`);
    }
  });

  test(`${id}: the bet detector recognizes this persona's own bet line`, () => {
    const persona = loadPersona(id, PERSONAS_DIR.pathname);
    const line = persona.sections['sample lines'].split('\n').find((l) => /^- The (bet|hunch):/.test(l));
    assert.ok(line, `${id}: no bet or hunch sample line`);
    assert.match(line, BET);
  });
}

test('audit catches a couple who hear the bet and then the plus-one question', () => {
  const bad = parseExamples([
    'A pair who hear four questions.',
    'Guest: "Sturgill Simpson."',
    'Harper: "Sturgill. Dinner, spicy and loud, or slow and candlelit?"',
    'Guest: "Spicy. We love Thai."',
    'Harper: "Thai it is. I am betting you are a Wes Anderson pair. Warm, or way off?"',
    'Guest: "Way off."',
    'Harper: "Fair. And one thing your plus-one loves?"',
    'Guest: "Kacey Musgraves."',
    'Harper: "Got it. Give me a few seconds."',
  ].join('\n'), 'Harper')[0];
  const { questions } = audit(bad, [1, 2, 2, 3]);
  assert.equal(questions, 4);
  assert.equal(betsWithCompanion(bad).length, 1);
});

test('a guest on their own may still hear the bet', () => {
  const solo = parseExamples([
    'A guest on their own.',
    'Guest: "Sturgill Simpson. It is just me this trip."',
    'Harper: "Sturgill. I am betting you are a Wes Anderson person. Warm, or way off?"',
    'Guest: "Warm."',
    'Harper: "Got it. Give me a few seconds."',
  ].join('\n'), 'Harper')[0];
  assert.deepEqual(betsWithCompanion(solo), []);
});

test('at least one example call is a couple, and the plus-one answer is the third named thing', () => {
  const found = [];
  for (const id of listPersonas(PERSONAS_DIR.pathname)) {
    const persona = loadPersona(id, PERSONAS_DIR.pathname);
    const checks = parseChecks(readFileSync(new URL(`${id}.md`, PERSONAS_DIR), 'utf8'));
    for (const ex of parseExamples(persona.sections['example calls'], persona.display_name)) {
      if (!/couple/i.test(ex.title)) continue;
      const named = /** @type {number[]} */ (checks?.get(ex.title));
      // The concierge turn just before the guest's last turn asks for the plus-one's thing,
      // and that answer takes the count to exactly three.
      const lastGuest = ex.turns.map((t) => t.who).lastIndexOf('guest');
      const ask = ex.turns[lastGuest - 1];
      assert.match(ask.text, /one thing your .+ loves\?$/, `${id} / ${ex.title}: plus-one question`);
      assert.equal(named.at(-1), STOP_AT_NAMED);
      assert.equal(named.at(-2), STOP_AT_NAMED - 1);
      found.push(`${id} / ${ex.title}`);
    }
  }
  assert.ok(found.length >= 1, 'no couple example in any persona');
});

test('audit catches the old chatty example that asked a question while holding three named things', () => {
  const old = parseExamples([
    'A chatty guest.',
    'Guest: "Oh, Sturgill Simpson, and my husband loves The National, we saw them once in"',
    'Harper: "Sturgill and The National, that is a mood. Dinner, spicy and loud, or slow and candlelit?"',
    'Guest: "Spicy. We had the best Thai ever in Chiang Mai."',
    'Harper: "Thai it is. I am betting you are a Wes Anderson pair. Warm, or way off?"',
    'Guest: "Totally. Grand Budapest is our movie."',
    'Harper: "Got it. Give me a few seconds."',
  ].join('\n'), 'Harper')[0];
  const { questions, breaches } = audit(old, [2, 3, 4]);
  assert.equal(questions, 3);
  assert.equal(breaches.length, 1);
});
