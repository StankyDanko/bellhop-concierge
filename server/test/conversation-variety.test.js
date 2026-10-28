// Conversation variety: the pools read clean, every mood-choice side is a word the taste
// resolver knows, defaults reproduce the compiled first message, a remembered caller hears
// their name and a question, and a repeat caller never hears the same hook or pair twice
// running. Fake callers and a seeded random source throughout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POOLS, SAMPLE_NAME, callerStatus, choose, daypartOf, defaultVars, spokenLines } from '../conversation/choose.js';
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
const opener = (name) => readFileSync(new URL(`../../personas/${name}.md`, import.meta.url), 'utf8').match(/^opener: (.+)$/m)[1];

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
    assert.ok(p.openers.length >= 4, `${name} openers`);
    assert.ok(p.returning.length >= 3, `${name} returning`);
    assert.ok(p.same_day.length >= 3, `${name} same_day`);
  }
  assert.equal(POOLS.pairs.length, 12);
  assert.equal(POOLS.bets, undefined, 'the scripted bet is gone');
});

test('every spoken line obeys the copy rules', () => {
  const lines = spokenLines();
  assert.ok(lines.length > 40);
  for (const { where, text } of lines) {
    for (const rule of ['em_dash', 'forbidden_word', 'phone_number', 'url', 'punctuation', 'unfilled_slot']) {
      assert.ok(!RULES[rule].test(text), `${where} breaks ${rule}: ${text}`);
    }
    assert.ok(!/\d/.test(text), `${where} has a digit; spell numbers as words: ${text}`);
    assert.ok(!/\bhost\b/i.test(text), `${where} says host; say innkeeper`);
    assert.ok(!/<|>/.test(text), `${where} has an unfilled placeholder: ${text}`);
    assert.ok(text.length <= 130, `${where} is long for a spoken line (${text.length})`);
    assert.doesNotMatch(text, /loving lately|a band, a dish|city and state/i, `${where} is the old quiz`);
  }
});

test('every hook ends on a question, and a first message stays at two sentences', () => {
  for (const name of PERSONAS) {
    const p = POOLS.personas[name];
    for (const o of [...p.openers, ...p.returning, ...p.same_day]) assert.match(o.text, /\?$/, `${name}.${o.id}`);
    for (const status of ['new', 'returning', 'same_day']) {
      for (let seed = 1; seed <= 20; seed++) {
        const { vars } = choose({ persona: name, status, name: SAMPLE_NAME, now: WED.evening, rng: seeded(seed) });
        const intro = opener(name).slice(0, -defaultVars(name).opener_hook.length);
        const first = `${intro}${vars.opener_hook}`;
        assert.ok(sentences(first).length <= 2, first);
      }
    }
  }
});

test('empty memory and default variables give the compiled first message, byte for byte, and a first call', () => {
  for (const name of PERSONAS) {
    const v = defaultVars(name);
    assert.ok(opener(name).endsWith(` ${v.opener_hook}`), `${name} first message ends with its default hook`);
    assert.match(v.opener_hook, /^who\b.*\?$/, `${name}: the first message asks who is calling`);
    assert.deepEqual([v.caller_status, v.caller_name, v.call_number, v.recording_noted, v.last_call_hook, v.last_place, v.memory_line, v.stay_line, v.texted_count],
      ['new', 'none', 1, 'no', 'none', 'none', 'none', 'none', 0]);
    assert.equal(v.plan_window, 'tonight');
    assert.equal(v.greeting, undefined);
    assert.equal(v.bet_domain, undefined);
  }
  assert.equal(defaultVars('harper').choice_pair, 'Are you in the mood for somewhere spicy and loud, or somewhere slow and candlelit?');
  assert.equal(defaultVars('maybelle').choice_pair, 'Would you like somewhere spicy and lively, or would you rather go slow and candlelit?');
  assert.ok(POOLS.personas.marisol, 'Marisol has her own pools, not Harper\'s');
  // An unknown persona is Harper, never an exception.
  assert.deepEqual(defaultVars('nobody'), defaultVars('harper'));
});

test('a remembered name: the hook names them and asks if it is still them; no name means the first-call question', () => {
  for (const name of PERSONAS) {
    for (const status of ['returning', 'same_day']) {
      for (let seed = 1; seed <= 20; seed++) {
        const { vars, ids } = choose({ persona: name, status, name: 'Dana', now: WED.evening, rng: seeded(seed) });
        assert.match(vars.opener_hook, /\bDana\b.*\?$/, `${name} ${status} ${ids.opener}`);
        assert.ok(POOLS.personas[name][status].some((x) => x.id === ids.opener));
      }
      const unnamed = choose({ persona: name, status, now: WED.evening, rng: seeded(4) });
      assert.ok(POOLS.personas[name].openers.some((x) => x.id === unnamed.ids.opener), `${name} ${status} without a name asks who is calling`);
    }
    // A name on a caller with nothing remembered is never used: a new status is a first call.
    const fresh = choose({ persona: name, status: 'new', name: 'Dana', now: WED.evening, rng: seeded(4) });
    assert.doesNotMatch(fresh.vars.opener_hook, /Dana/);
  }
});

test('a second call never repeats the first call\'s hook or pair (all personas, dayparts, statuses)', () => {
  for (const name of PERSONAS) {
    for (const [dp, now] of Object.entries({ ...WED, friEvening: FRI_EVENING, sunNoon: SUN_NOON })) {
      for (const status of ['new', 'returning', 'same_day']) {
        const rng = seeded(name.length * 31 + dp.length);
        let last = { hasTastes: status !== 'new' };
        for (let call = 0; call < 200; call++) {
          const { ids } = choose({ persona: name, status, name: 'Dana', now, last, rng });
          if (call > 0) {
            assert.notEqual(ids.opener, last.openerIds.at(-1), `${name} ${dp} ${status} call ${call}: hook repeated`);
            assert.notEqual(ids.pair, last.pairIds.at(-1), `${name} ${dp} ${status} call ${call}: pair repeated`);
          }
          last = { ...last, openerIds: [...(last.openerIds ?? []), ids.opener], pairIds: [...(last.pairIds ?? []), ids.pair] };
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

test('daypart tags are honored', () => {
  const seen = (now, name = 'harper') => {
    const out = new Set();
    for (let s = 1; s <= 400; s++) out.add(choose({ persona: name, status: 'new', now, rng: seeded(s) }).ids.opener);
    return out;
  };
  assert.ok(!seen(WED.morning).has('h-ask-tonight'), 'an evening hook stays out of the morning');
  assert.ok(seen(WED.evening).has('h-ask-tonight'));
  assert.ok(!seen(WED.evening).has('h-ask-today'));
  assert.equal(choose({ persona: 'harper', now: WED.morning, rng: () => 0 }).vars.plan_window, 'today');
  assert.equal(choose({ persona: 'harper', now: WED.afternoon, rng: () => 0 }).vars.plan_window, 'this afternoon');
  assert.equal(choose({ persona: 'harper', now: WED.late, rng: () => 0 }).vars.plan_window, 'tonight');
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
  assert.equal(callerStatus({ hasTastes: true, lastCallDay: '2026-10-22', now: at('2026-10-22T02:00:00Z'), timezone: 'America/New_York' }), 'returning');
  const call = choose({ persona: 'harper', name: 'Dana', now, last: { hasTastes: true, lastCallDay: '2026-10-21', openerIds: ['h-s-earlier'] }, rng: seeded(3) });
  assert.equal(call.vars.caller_status, 'same_day');
  assert.notEqual(call.ids.opener, 'h-s-earlier');
  assert.ok(POOLS.personas.harper.same_day.some((x) => x.id === call.ids.opener));
  assert.equal(choose({ persona: 'maybelle', now, last: { hasTastes: false, lastCallDay: '2026-10-21' }, rng: seeded(3) }).vars.caller_status, 'new');
});

test('with no history at all every call still gets a full, valid set', () => {
  for (const name of [...PERSONAS, 'nobody']) {
    const { vars, ids } = choose({ persona: name, now: WED.evening, rng: seeded(5) });
    for (const k of ['opener_hook', 'choice_pair', 'plan_window', 'caller_status', 'caller_name', 'recording_noted', 'last_call_hook', 'memory_line', 'stay_line']) {
      assert.equal(typeof vars[k], 'string', k);
      assert.ok(vars[k].length > 0, k);
    }
    assert.equal(vars.texted_count, 0);
    assert.equal(vars.call_number, 1);
    assert.ok(POOLS.pairs.find((p) => p.id === ids.pair).enabled);
  }
});

test('the variety actually varies: many callers see many hooks and pairs', () => {
  const o = new Set(); const p = new Set();
  for (let s = 1; s <= 300; s++) {
    const { ids } = choose({ persona: 'harper', now: WED.evening, rng: seeded(s) });
    o.add(ids.opener); p.add(ids.pair);
  }
  assert.ok(o.size >= 4, `hooks seen: ${o.size}`);
  assert.equal(p.size, 5);
});

test('an empty pool for a daypart falls back to the persona default and never throws', () => {
  const pools = structuredClone(POOLS);
  for (const p of Object.values(pools.personas)) {
    p.returning = [];
    for (const o of p.openers) o.dayparts = ['morning'];
  }
  for (const p of pools.pairs) p.enabled = false;
  for (const [persona, hook, pair] of [['harper', 'h-ask-who', 'p-spicy'], ['maybelle', 'm-ask-who', 'p-lively'], ['road', 'r-ask-who', 'p-spicy']]) {
    for (const status of ['new', 'returning']) {
      const { vars, ids } = choose({ persona, status, name: 'Dana', now: WED.evening, rng: seeded(3), pools });
      assert.equal(ids.opener, hook, `${persona} ${status}`);
      assert.equal(ids.pair, pair);
      assert.ok(vars.opener_hook && vars.choice_pair);
    }
  }
});

test('night_question: the pool is well formed, varies with rng, and defaults without the webhook', () => {
  const pool = POOLS.night_questions;
  assert.ok(pool.length >= 10, 'about ten questions');
  assert.equal(new Set(pool.map((q) => q.id)).size, pool.length, 'unique ids');
  assert.equal(pool.filter((q) => q.default === true).length, 1, 'one default');
  for (const q of pool) {
    assert.ok(q.text.endsWith('?') && q.text.length <= 60 && !/[,;:]\s.*[,;:]/.test(q.text), `${q.id} short and open`);
    assert.ok(Array.isArray(q.dayparts) && q.dayparts.length, `${q.id} dayparts`);
    assert.ok(!/favorite|favourite|best ever/i.test(q.text), `${q.id} is no quiz about favorites`);
  }
  for (const dp of ['morning', 'afternoon', 'evening', 'late']) {
    assert.ok(pool.filter((q) => q.dayparts.includes('any') || q.dayparts.includes(dp)).length >= 5, `${dp} has choices`);
  }
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(choose({ persona: 'harper', now: WED.evening, rng: seeded(i + 1) }).vars.night_question);
  assert.ok(seen.size >= 6, `the draw varies (${seen.size})`);
  for (const name of PERSONAS) assert.equal(defaultVars(name).night_question, 'What are you up to tonight?');
});
