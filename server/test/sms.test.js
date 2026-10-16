import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeItinerary, FOOTER, MAX_CHARS, segmentCount, toGsm, httpsOnly, TRUNCATION_ORDER } from '../lib/sms.js';

const pick = (n, extra = {}) => ({
  name: `Place Number ${n}`,
  why: 'Fans of Sturgill Simpson and Wes Anderson love it',
  url: `https://example.com/p${n}`,
  ...extra,
});

test('short itinerary keeps header, every line, and the footer', () => {
  const r = composeItinerary({ picks: [pick(1), pick(2)], guest: { party_size: 2, when: 'tonight' } });
  assert.ok(r.body.startsWith('Tonight for 2:\n1. Place Number 1'));
  assert.ok(r.body.includes('2. Place Number 2'));
  assert.ok(r.body.endsWith(FOOTER));
  assert.equal(r.char_count, r.body.length);
  assert.deepEqual(r.truncation, []);
  assert.equal(r.picks_included, 2);
});

test('body never exceeds 320 characters, footer included', () => {
  for (let n = 1; n <= 5; n++) {
    const picks = Array.from({ length: n }, (_, i) => pick(i + 1, { detail: 'Fri 8pm @ A Rather Long Venue Name Here' }));
    const r = composeItinerary({ picks, guest: { party_size: 4, when: 'weekend' } });
    assert.ok(r.char_count <= MAX_CHARS, `n=${n}: ${r.char_count}`);
    assert.ok(r.body.endsWith(FOOTER), 'footer survives every truncation');
  }
});

test('footer counts toward the limit', () => {
  const name = 'x'.repeat(MAX_CHARS - FOOTER.length - 1); // exactly fills the budget with the footer
  const r = composeItinerary({ picks: [{ name }] });
  assert.equal(r.char_count, MAX_CHARS);
  assert.equal(r.truncation.includes('drop_header'), true);
});

test('truncation follows the documented order', () => {
  const picks = Array.from({ length: 5 }, (_, i) => pick(i + 1));
  const r = composeItinerary({ picks, guest: { when: 'tonight' } });
  // Header goes first, then lower reasons, then the link scheme, and every step applied
  // appears in documented order. Five picks that fit once their words are gone all stay.
  assert.equal(r.truncation[0], 'drop_header');
  const ranks = r.truncation.map((s) => TRUNCATION_ORDER.indexOf(s));
  assert.ok(ranks.every((x) => x >= 0), r.truncation.join(','));
  assert.ok(ranks.every((x, i) => i === 0 || x >= ranks[i - 1]), `out of order: ${r.truncation.join(',')}`);
  assert.equal(r.truncation.includes('drop_last_pick'), false);
  assert.equal(r.picks_included, 5);
  assert.ok(r.char_count <= MAX_CHARS);
  // The top pick keeps its whole reason.
  assert.match(r.body, /1\. Place Number 1 - Fans of Sturgill Simpson and Wes Anderson love it /);
});

/** Every reason in the body, whole: the text between " - " and the link (with or without its scheme) or line end. */
const whysIn = (body) => body.split('\n').filter((l) => / - /.test(l)).map((l) => l.split(' - ')[1].replace(/ (https:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/\S*$/i, ''));

test('a reason is never cut mid-phrase: each one is whole or absent', () => {
  const reasons = ['Fans of Sturgill Simpson and Wes Anderson love it', 'Strong match for your overall taste', 'Fans of Thai food love it'];
  for (let n = 1; n <= 5; n++) {
    for (const extra of [{}, { detail: 'Fri 8pm' }, { favors: 'both' }]) {
      const picks = Array.from({ length: n }, (_, i) => ({ ...pick(i + 1), why: reasons[i % 3], ...extra }));
      const r = composeItinerary({ picks, guest: { party_size: 2, when: 'tonight' } });
      assert.ok(r.char_count <= MAX_CHARS);
      for (const why of whysIn(r.body)) assert.ok(reasons.includes(why), `n=${n}: cut reason "${why}"`);
      assert.ok(!r.truncation.some((s) => s.startsWith('trim_why')), 'no trim step for reasons exists');
    }
  }
});

test('the regression: "Strong match for your overall taste" is never sent as "Strong match for"', () => {
  // The shape of the text that went out cut: two picks, generic second reason, both links.
  const picks = [
    { name: 'Lemongrass Lantern', why: 'Fans of Thai food love it', url: 'https://example.com/lemongrass-lantern' },
    { name: 'The Low Lantern Listening Room', why: 'Strong match for your overall taste', url: 'https://example.com/low-lantern' },
    { name: 'Pastel Diner & Pie', why: 'Strong match for your overall taste', url: 'https://example.com/pastel-diner-and-pie' },
  ];
  const r = composeItinerary({ picks, guest: { party_size: 2, when: 'tonight' } });
  assert.ok(r.char_count <= MAX_CHARS);
  assert.doesNotMatch(r.body, /Strong match for(?! your overall taste)/);
  assert.doesNotMatch(r.body, /Fans of Thai food(?! love it)/);
  assert.match(r.body, /1\. Lemongrass Lantern - Fans of Thai food love it /);
});

test('a lower reason goes whole before any pick; a pick goes only when that is not enough', () => {
  // Two picks just over budget: dropping the second reason is enough, both picks stay.
  const base = composeItinerary({ picks: [{ name: 'A', why: 'Fans of Thai food love it' }, { name: 'B', why: 'Fans of Thai food love it' }], intro: '' });
  const pad = 'x'.repeat(MAX_CHARS - base.char_count + 5);
  const r = composeItinerary({ picks: [{ name: `A${pad}`, why: 'Fans of Thai food love it' }, { name: 'B', why: 'Fans of Thai food love it' }], intro: '' });
  assert.equal(r.truncation.at(-1), 'drop_last_why');
  assert.equal(r.picks_included, 2);
  assert.match(r.body, /- Fans of Thai food love it\n2\. B\n/);
  // Far over budget: the lower reason goes first, it is not enough, so the pick goes, and the
  // top reason stays whole.
  const big = 'y'.repeat(MAX_CHARS - base.char_count + 30); // the reason frees 28, the pick 8 more
  const r2 = composeItinerary({ picks: [{ name: `A${big}`, why: 'Fans of Thai food love it' }, { name: 'B', why: 'Fans of Thai food love it' }], intro: '' });
  assert.ok(r2.truncation.indexOf('drop_last_why') < r2.truncation.indexOf('drop_last_pick'), r2.truncation.join(','));
  assert.equal(r2.picks_included, 1);
  assert.match(r2.body, / - Fans of Thai food love it\n/);
});

test('a single huge pick drops whys, detail, trims name, and keeps a valid body', () => {
  const r = composeItinerary({ picks: [{ name: 'N'.repeat(400), why: 'w '.repeat(100), detail: 'd '.repeat(50), url: 'https://example.com/' + 'a'.repeat(150) }] });
  assert.ok(r.char_count <= MAX_CHARS);
  assert.ok(r.body.endsWith(FOOTER));
  assert.ok(r.truncation.includes('drop_why'));
});

test('links are https only; others are dropped and reported', () => {
  const r = composeItinerary({ picks: [
    { name: 'A', why: 'x', url: 'http://example.com/a' },
    { name: 'B', why: 'y', url: 'javascript:alert(1)' },
    { name: 'C', why: 'z', url: 'https://example.com/c' },
  ] });
  assert.ok(!r.body.includes('http://'));
  assert.ok(!r.body.includes('javascript:'));
  assert.ok(r.body.includes('https://example.com/c'));
  assert.equal(r.rejected_links.length, 2);
  const urls = r.body.match(/\b[a-z]+:\/\/\S+/gi) ?? [];
  for (const u of urls) assert.ok(u.startsWith('https://'), u);
});

test('httpsOnly rejects whitespace, non-ASCII, and overlong URLs', () => {
  assert.equal(httpsOnly('https://ex ample.com'), null);
  assert.equal(httpsOnly('https://exämple.com'), null);
  assert.equal(httpsOnly('https://example.com/' + 'a'.repeat(300)), null);
  assert.equal(httpsOnly('https://example.com/ok'), 'https://example.com/ok');
});

test('text is GSM-7 safe: smart punctuation and accents are normalized', () => {
  assert.equal(toGsm('Café “Le Coq” — bistro…'), 'Cafe "Le Coq" - bistro...');
  assert.equal(toGsm('Ramen 🍜 night'), 'Ramen night');
  const r = composeItinerary({ picks: [{ name: 'Café “Le Coq” — bistro', why: 'It’s great' }] });
  assert.equal(r.encoding, 'GSM-7');
  assert.ok(!/[^\x0a\x20-\x7e]/.test(r.body), 'ascii only after normalization');
});

test('segment math: 1 up to 160, then 153 per segment; extended chars cost two', () => {
  assert.equal(segmentCount('a'.repeat(160)), 1);
  assert.equal(segmentCount('a'.repeat(161)), 2);
  assert.equal(segmentCount('a'.repeat(306)), 2);
  assert.equal(segmentCount('a'.repeat(307)), 3);
  assert.equal(segmentCount('a'.repeat(159) + '{'), 2); // 161 septets
  const r = composeItinerary({ picks: [pick(1), pick(2), pick(3)] });
  assert.equal(r.segments, segmentCount(r.body));
  assert.ok(r.segments <= 3);
});

test('input validation', () => {
  assert.throws(() => composeItinerary({ picks: [] }), /non-empty/);
  assert.throws(() => composeItinerary({ picks: Array(6).fill({ name: 'x' }) }), /at most 5/);
  assert.throws(() => composeItinerary({ picks: [{ why: 'no name' }] }), /name is required/);
});
