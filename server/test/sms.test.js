import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeItinerary, FOOTER, MAX_CHARS, segmentCount, toGsm, httpsOnly } from '../lib/sms.js';

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
  // Header goes first, then whys are trimmed, and only then picks are dropped.
  const order = ['drop_header', 'trim_why_32', 'trim_why_20', 'drop_last_pick'];
  const seen = r.truncation.filter((s, i) => r.truncation.indexOf(s) === i);
  assert.deepEqual(seen.slice(0, order.length), order);
  assert.ok(r.picks_included < 5 && r.picks_included >= 1);
  // Whys survive (trimmed) on the picks that remain.
  assert.match(r.body, /1\. Place Number 1 - Fans of/);
});

test('trimmed whys cut at word boundaries', () => {
  const picks = Array.from({ length: 3 }, (_, i) => pick(i + 1));
  const r = composeItinerary({ picks });
  for (const line of r.body.split('\n').filter((l) => / - /.test(l))) {
    const why = line.split(' - ')[1].replace(/ https:\/\/\S+$/, '');
    assert.ok(why.length <= 32, why);
    assert.ok(!/\s$/.test(why));
  }
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
