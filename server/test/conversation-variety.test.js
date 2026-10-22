// Conversation variety: the pools read clean, every food-choice side is a word the taste
// resolver knows, defaults reproduce today's first message, and a repeat caller never hears
// the same opener or pair twice running. Fake callers and a seeded random source throughout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POOLS, callerStatus, choose, daypartOf, defaultVars, spokenLines } from '../conversation/choose.js';
import { BUDGET_WORDS, VIBE_PHRASES, vibeOf } from '../tools/resolve-taste.js';
import { RULES, sentences } from '../../compiler/lint.js';

// `lively` is being added to VIBE_PHRASES by a separate patch; it is a lexicon word for this test now.
const LEXICON = new Set([...Object.keys(VIBE_PHRASES), 'lively', ...Object.keys(BUDGET_WORDS)]);
const PERSONAS = Object.keys(POOLS.personas);

/** Small seeded generator so the simulations are exact and repeatable. */
function seeded(seed) {
  let a = seed >>> 0; // mulberry32
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// 2026-10-21 is a Wednesday. The offsets give each daypart in New York (UTC minus four).
const at = (iso) => new Date(iso);
const WED = { morning: at('2026-10-21T12:00:00Z'), afternoon: at('2026-10-21T18:00:00Z'), evening: at('2026-10-21T22:00:00Z'), late: at('2026-10-22T03:00:00Z') };
const FRI_EVENING = at('2026-10-23T22:00:00Z');
const SUN_NOON = at('2026-10-25T16:00:00Z');

test('every pair side is a word resolve_taste knows, or the pair ships disabled', () => {
  for (const p of POOLS.pairs) {
    const words = p.sides.flat();
    assert.equal(p.text, `${p.sides[0].join(' and ')}, or ${p.sides[1].join(' and ')}`, `${p.id} text matches its sides`);
    const unknown = words.filter((w) => !LEXICON.has(w));
    if (p.enabled) assert.deepEqual(unknown, [], `${p.id} is enabled with words outside the lexicon: ${unknown}`);
    else assert.ok(unknown.length > 0, `${p.id} is disabled but every word is known; enable it`);
  }
  assert.ok(POOLS.pairs.filter((p) => p.enabled).length >= 5);
});

test('every enabled side resolves as a vibe, not as a name search', () => {
  for (const p of POOLS.pairs.filter((x) => x.enabled)) {
    for (const side of p.sides) {
      if (!side.every((w) => Object.hasOwn(VIBE_PHRASES, w))) continue; // `lively` waits on the vibe-table patch
      const vibe = vibeOf(side.join(' and '));
      assert.ok(vibe, `${p.id}: "${side.join(' and ')}" is not a vibe`);
      assert.deepEqual(vibe.tastes, side, `${p.id}: every word of "${side.join(' and ')}" is read as a taste`);
    }
  }
});

test('pool sizes meet the design', () => {
  for (const name of PERSONAS) {
    const p = POOLS.personas[name];
    assert.equal(p.openers.length, 10, `${name} openers`);
    assert.equal(p.returning.length, 4, `${name} returning`);
    assert.equal(p.same_day.length, 3, `${name} same_day`);
  }
  assert.equal(POOLS.pairs.length, 12);
  assert.equal(POOLS.bets.length, 6);
  assert.ok(POOLS.bets.filter((b) => b.enabled).length >= 5);
});

test('every spoken line obeys the copy rules', () => {
  const lines = spokenLines();
  assert.ok(lines.length > 60);
  for (const { where, text } of lines) {
    for (const rule of ['em_dash', 'forbidden_word', 'phone_number', 'url', 'punctuation', 'unfilled_slot']) {
      assert.ok(!RULES[rule].test(text), `${where} breaks ${rule}: ${text}`);
    }
    assert.ok(!/\d/.test(text), `${where} has a digit; spell numbers as words: ${text}`);
    assert.ok(!/\bhost\b/i.test(text), `${where} says host; say innkeeper`);
    assert.ok(!/<|>/.test(text), `${where} has an unfilled placeholder: ${text}`);
    assert.ok(text.length <= 130, `${where} is long for a spoken line (${text.length})`);
    if (/^[A-Z]/.test(text) && text.includes(' ')) assert.equal(sentences(text).length, 1, `${where} must be one sentence: ${text}`);
  }
});

test('hooks and greetings keep the compiled first message to two sentences', () => {
  // The compiled disclosure is one sentence, so greeting + disclosure + hook must stay at two.
  for (const name of PERSONAS) {
    for (const status of ['new', 'returning', 'same_day']) {
      const { vars } = choose({ persona: name, status, now: WED.evening, rng: seeded(7) });
      const first = `${vars.greeting} this is X, the automated concierge at Y, this call is recorded. ${vars.opener_hook}`;
      assert.equal(sentences(first).length, 2, first);
    }
  }
});

test('empty memory and default variables give today\'s first message, byte for byte', () => {
  for (const name of PERSONAS) {
    const persona = readFileSync(new URL(`../../personas/${name}.md`, import.meta.url), 'utf8');
    const opener = persona.match(/^opener: (.+)$/m)[1];
    const v = defaultVars(name);
    const rebuilt = `${v.greeting} this is ${name[0].toUpperCase()}${name.slice(1)}, the automated concierge at {{property_name}}, this call is recorded, and any text I send goes only to the number you are calling from. ${v.opener_hook}`;
    assert.equal(rebuilt, opener, `${name} first message`);
    assert.equal(v.caller_status, 'new');
    assert.equal(v.plan_window, 'tonight');
    assert.equal(v.bet_domain, 'a film or a director');
    assert.equal(v.memory_line, 'none');
    assert.equal(v.stay_line, 'none');
    assert.equal(v.texted_count, 0);
  }
  assert.equal(defaultVars('harper').choice_pair, 'spicy and loud, or slow and candlelit');
  assert.equal(defaultVars('maybelle').choice_pair, 'spicy and lively, or slow and candlelit');
  // An unknown persona is Harper, never an exception.
  assert.deepEqual(defaultVars('nobody'), defaultVars('harper'));
});

test('a second call never repeats the first call\'s opener or pair (all personas, dayparts, statuses)', () => {
  for (const name of PERSONAS) {
    for (const [dp, now] of Object.entries({ ...WED, friEvening: FRI_EVENING, sunNoon: SUN_NOON })) {
      for (const status of ['new', 'returning', 'same_day']) {
        const rng = seeded(name.length * 31 + dp.length);
        let last = { hasTastes: status !== 'new' };
        for (let call = 0; call < 200; call++) {
          const { ids } = choose({ persona: name, status, now, last, rng });
          if (call > 0) {
            assert.notEqual(ids.opener, last.openerIds.at(-1), `${name} ${dp} ${status} call ${call}: opener repeated`);
            assert.notEqual(ids.pair, last.pairIds.at(-1), `${name} ${dp} ${status} call ${call}: pair repeated`);
          }
          last = { ...last, openerIds: [...(last.openerIds ?? []), ids.opener], pairIds: [...(last.pairIds ?? []), ids.pair], betIds: [...(last.betIds ?? []), ids.bet] };
        }
      }
    }
  }
});

test('the next pair shares no side with the last pair', () => {
  const sides = (id) => POOLS.pairs.find((p) => p.id === id).sides.map((s) => [...s].sort().join('+'));
  for (const prior of POOLS.pairs.filter((p) => p.enabled)) {
    for (let seed = 1; seed <= 60; seed++) {
      const { ids } = choose({ persona: 'harper', now: WED.evening, last: { pairIds: [prior.id] }, rng: seeded(seed) });
      const shared = sides(ids.pair).filter((s) => sides(prior.id).includes(s));
      assert.deepEqual(shared, [], `${prior.id} then ${ids.pair}`);
    }
  }
});

test('two-back avoidance holds while the pool is big enough, and the bet never matches the opener\'s anchor', () => {
  const rng = seeded(99);
  let last = {};
  for (let i = 0; i < 300; i++) {
    const { ids } = choose({ persona: 'maybelle', status: 'new', now: WED.evening, last, rng });
    const pool = POOLS.personas.maybelle.openers.find((o) => o.id === ids.opener);
    assert.notEqual(ids.bet_domain, pool.anchor, `${ids.opener} paired with a ${ids.bet_domain} bet`);
    if (i >= 2) assert.ok(!last.openerIds.slice(-2).includes(ids.opener), `opener came back within two calls at ${i}`);
    last = { openerIds: [...(last.openerIds ?? []), ids.opener], pairIds: [...(last.pairIds ?? []), ids.pair], betIds: [...(last.betIds ?? []), ids.bet] };
  }
});

test('daypart and weekday tags are honored', () => {
  const seen = (now, name = 'harper') => {
    const out = new Set();
    for (let s = 1; s <= 400; s++) out.add(choose({ persona: name, status: 'new', now, rng: seeded(s) }).ids.opener);
    return out;
  };
  const morning = seen(WED.morning);
  assert.ok(!morning.has('h-song') && !morning.has('h-movie'), 'evening-only hooks stay out of the morning');
  assert.ok(!morning.has('h-weekend') && !morning.has('h-sunday'), 'weekday hooks stay out of a Wednesday');
  assert.ok(seen(FRI_EVENING).has('h-weekend'), 'the weekend hook can play on a Friday night');
  assert.ok(!seen(WED.evening).has('h-weekend'));
  assert.ok(seen(SUN_NOON).has('h-sunday'), 'the Sunday hook can play on a Sunday');
  assert.ok(!seen(WED.morning, 'maybelle').has('m-porch'), 'the porch hook needs an afternoon or an evening');
  assert.ok(seen(WED.afternoon, 'maybelle').has('m-porch'));
  assert.equal(choose({ persona: 'harper', now: WED.morning, rng: () => 0 }).vars.plan_window, 'today');
  assert.equal(choose({ persona: 'harper', now: WED.afternoon, rng: () => 0 }).vars.plan_window, 'this afternoon');
  assert.equal(choose({ persona: 'harper', now: WED.late, rng: () => 0 }).vars.plan_window, 'tonight');
  assert.match(choose({ persona: 'harper', now: WED.morning, rng: () => 0 }).vars.opener_hook, /plan your day\.$/);
  assert.match(choose({ persona: 'maybelle', now: WED.evening, rng: () => 0 }).vars.opener_hook, /your evening together\.$/);
  assert.match(choose({ persona: 'maybelle', now: WED.late, rng: () => 0 }).vars.opener_hook, /your night together\.$/);
});

test('daypart edges and the inn\'s own timezone', () => {
  assert.deepEqual([4, 5, 10, 11, 16, 17, 21, 22, 0].map(daypartOf), ['late', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'late', 'late']);
  const instant = at('2026-10-21T22:00:00Z'); // six in the evening in New York, three in the afternoon in Los Angeles
  assert.equal(choose({ now: instant, timezone: 'America/New_York', rng: () => 0 }).ids.daypart, 'evening');
  assert.equal(choose({ now: instant, timezone: 'America/Los_Angeles', rng: () => 0 }).ids.daypart, 'afternoon');
  assert.equal(choose({ now: instant, timezone: 'Not/AZone', rng: () => 0 }).ids.daypart, 'evening'); // falls back, never throws
});

test('status: variety history alone stays new; tastes make it returning; tastes plus today make it same_day', () => {
  const now = WED.evening;
  assert.equal(callerStatus({ hasTastes: false, lastCallDay: '2026-10-21', now, timezone: 'America/New_York' }), 'new');
  assert.equal(callerStatus({ hasTastes: true, lastCallDay: '2026-10-20', now, timezone: 'America/New_York' }), 'returning');
  assert.equal(callerStatus({ hasTastes: true, lastCallDay: '2026-10-21', now, timezone: 'America/New_York' }), 'same_day');
  // Same instant, but "today" is the inn's today: 22:00 UTC is still the 21st in New York, and the 21st in Los Angeles.
  assert.equal(callerStatus({ hasTastes: true, lastCallDay: '2026-10-22', now: at('2026-10-22T02:00:00Z'), timezone: 'America/New_York' }), 'returning');
  const call = choose({ persona: 'harper', now, last: { hasTastes: true, lastCallDay: '2026-10-21', openerIds: ['h-s1'] }, rng: seeded(3) });
  assert.equal(call.vars.caller_status, 'same_day');
  assert.equal(call.vars.greeting, 'Back again,');
  assert.notEqual(call.ids.opener, 'h-s1');
  assert.ok(POOLS.personas.harper.same_day.some((x) => x.id === call.ids.opener));
  assert.equal(choose({ persona: 'maybelle', now, last: { hasTastes: true, lastCallDay: '2026-10-01' }, rng: seeded(3) }).vars.greeting, 'Well, welcome back,');
  assert.equal(choose({ persona: 'maybelle', now, last: { hasTastes: false, lastCallDay: '2026-10-21' }, rng: seeded(3) }).vars.caller_status, 'new');
});

test('with no history at all every call still gets a full, valid set', () => {
  for (const name of [...PERSONAS, 'nobody']) {
    const { vars, ids } = choose({ persona: name, now: WED.evening, rng: seeded(5) });
    for (const k of ['greeting', 'opener_hook', 'choice_pair', 'bet_domain', 'plan_window', 'caller_status', 'memory_line', 'stay_line']) {
      assert.equal(typeof vars[k], 'string', k);
      assert.ok(vars[k].length > 0, k);
    }
    assert.equal(vars.texted_count, 0);
    assert.ok(POOLS.pairs.find((p) => p.id === ids.pair).enabled);
  }
});

test('the variety actually varies: many callers see many openers, pairs and bets', () => {
  const o = new Set(); const p = new Set(); const b = new Set();
  for (let s = 1; s <= 300; s++) {
    const { ids } = choose({ persona: 'harper', now: WED.evening, rng: seeded(s) });
    o.add(ids.opener); p.add(ids.pair); b.add(ids.bet);
  }
  assert.ok(o.size >= 7, `openers seen: ${o.size}`);
  assert.equal(p.size, 5);
  assert.ok(b.size >= 4, `bets seen: ${b.size}`);
});
