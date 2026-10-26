import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeItinerary, FOOTER, SENDER_TAG, MAX_CHARS, segmentCount, toGsm, httpsOnly, TRUNCATION_ORDER } from '../lib/sms.js';

const LINK = (n) => `https://concierge.southernsky.cloud/go/Tk${String(n).padStart(6, '0')}`; // 47 characters
const pick = (n, extra = {}) => ({
  name: `Place Number ${n}`,
  blurb: 'rooftop sushi, West Midtown',
  url: LINK(n),
  ...extra,
});

test('a pick is its name, a few words about the place, and a link, nothing else', () => {
  const r = composeItinerary({ picks: [
    { name: 'O-Ku', blurb: 'rooftop sushi, West Midtown', url: LINK(1) },
    { name: 'Dad\'s', blurb: 'cocktail bar, Midtown', url: LINK(2) },
  ] });
  assert.equal(r.body, [
    'Bellhop Concierge: Tonight:',
    `1. O-Ku - rooftop sushi, West Midtown ${LINK(1)}`,
    `2. Dad's - cocktail bar, Midtown ${LINK(2)}`,
    FOOTER,
  ].join('\n'));
  assert.deepEqual(r.truncation, []);
});

test('the guest\'s tastes and the ranking reason never reach the text', () => {
  const r = composeItinerary({ picks: [
    { name: 'O-Ku', blurb: 'rooftop sushi, West Midtown', url: LINK(1),
      why: 'Fans of The Man Who Killed Hitler and Then the Bigfoot love it; tagged Sushi' },
  ] });
  assert.doesNotMatch(r.body, /fans of|tagged|love it|Bigfoot/i);
  assert.match(r.body, /1?\.? ?O-Ku - rooftop sushi, West Midtown https:/);
});

test('the footer is short, names both sources, and keeps STOP', () => {
  assert.equal(FOOTER, 'via Qloo + Ticketmaster. Reply STOP to opt out.');
  assert.equal(MAX_CHARS, 480);
});

test('short itinerary keeps header, every line, and the footer', () => {
  const r = composeItinerary({ picks: [pick(1), pick(2)], guest: { when: 'tonight' } });
  assert.ok(r.body.startsWith('Bellhop Concierge: Tonight:\n1. Place Number 1'));
  assert.ok(r.body.includes('2. Place Number 2'));
  assert.ok(r.body.endsWith(FOOTER));
  assert.equal(r.char_count, r.body.length);
  assert.deepEqual(r.truncation, []);
  assert.equal(r.picks_included, 2);
});

test('the header never states a head count', () => {
  const r = composeItinerary({ picks: [pick(1)], guest: { party_size: 2, when: 'tonight' } });
  assert.ok(r.body.startsWith('Bellhop Concierge: Tonight:\n'), r.body);
  assert.doesNotMatch(r.body, /for 2/);
});

test('three picks with short links fit whole, in three GSM-7 segments or fewer', () => {
  const r = composeItinerary({ picks: [pick(1), pick(2), pick(3)], guest: { when: 'tonight' } });
  assert.deepEqual(r.truncation, []);
  assert.equal(r.picks_included, 3);
  assert.ok(r.char_count <= MAX_CHARS, String(r.char_count));
  assert.ok(r.segments <= 4);
});

test('body never exceeds the limit, footer included', () => {
  for (let n = 1; n <= 5; n++) {
    const picks = Array.from({ length: n }, (_, i) => pick(i + 1, { detail: 'Fri 8pm @ A Rather Long Venue Name Here' }));
    const r = composeItinerary({ picks, guest: { when: 'weekend' } });
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
  assert.equal(r.truncation[0], 'drop_header');
  const ranks = r.truncation.map((s) => TRUNCATION_ORDER.indexOf(s));
  assert.ok(ranks.every((x) => x >= 0), r.truncation.join(','));
  assert.ok(ranks.every((x, i) => i === 0 || x >= ranks[i - 1]), `out of order: ${r.truncation.join(',')}`);
  assert.ok(r.char_count <= MAX_CHARS);
  // The top pick keeps its whole blurb and its link.
  assert.match(r.body, new RegExp(`1\\. Place Number 1 - rooftop sushi, West Midtown ${LINK(1)}`));
});

/** Every blurb in the body, whole: the text between " - " and the link or line end. */
const blurbsIn = (body) => body.split('\n').filter((l) => / - /.test(l)).map((l) => l.split(' - ')[1].replace(/ https:\/\/\S+$/, ''));

test('a blurb is never cut mid-phrase: each one is whole or absent', () => {
  const blurbs = ['rooftop sushi, West Midtown', 'cocktail bar, Midtown', 'Thai restaurant, Five Points'];
  for (let n = 1; n <= 5; n++) {
    for (const extra of [{}, { detail: 'Fri 8pm' }, { favors: 'both' }]) {
      const picks = Array.from({ length: n }, (_, i) => ({ ...pick(i + 1), blurb: blurbs[i % 3], ...extra }));
      const r = composeItinerary({ picks, guest: { when: 'tonight' } });
      assert.ok(r.char_count <= MAX_CHARS);
      for (const b of blurbsIn(r.body)) assert.ok(blurbs.includes(b), `n=${n}: cut blurb "${b}"`);
    }
  }
});

test('a lower blurb goes whole before any pick; a pick goes only when that is not enough', () => {
  const two = (nameA) => composeItinerary({ picks: [{ name: nameA, blurb: 'Thai spot, Five Points' }, { name: 'B', blurb: 'Thai spot, Five Points' }], intro: '' });
  const base = two('A');
  const r = two(`A${'x'.repeat(MAX_CHARS - base.char_count + 5)}`);
  assert.equal(r.truncation.at(-1), 'drop_last_blurb');
  assert.equal(r.picks_included, 2);
  assert.match(r.body, /- Thai spot, Five Points\n2\. B\n/);
  const r2 = two(`A${'y'.repeat(MAX_CHARS - base.char_count + 30)}`);
  assert.ok(r2.truncation.indexOf('drop_last_blurb') < r2.truncation.indexOf('drop_last_pick'), r2.truncation.join(','));
  assert.equal(r2.picks_included, 1);
});

test('a single huge pick drops its blurb, detail, trims the name, and keeps a valid body', () => {
  const r = composeItinerary({ picks: [{ name: 'N'.repeat(600), blurb: 'w '.repeat(100), detail: 'd '.repeat(50), url: LINK(1) }] });
  assert.ok(r.char_count <= MAX_CHARS);
  assert.ok(r.body.endsWith(FOOTER));
  assert.ok(r.truncation.includes('drop_blurb'));
});

test('links are https only; others are dropped and reported', () => {
  const r = composeItinerary({ picks: [
    { name: 'A', url: 'http://example.com/a' },
    { name: 'B', url: 'javascript:alert(1)' },
    { name: 'C', url: 'https://example.com/c' },
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
  const r = composeItinerary({ picks: [{ name: 'Café “Le Coq” — bistro', blurb: 'It’s great' }] });
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
  assert.ok(r.segments <= 4, 'a 480 character body is at most 4 segments');
});

test('input validation', () => {
  assert.throws(() => composeItinerary({ picks: [] }), /non-empty/);
  assert.throws(() => composeItinerary({ picks: Array(6).fill({ name: 'x' }) }), /at most 5/);
  assert.throws(() => composeItinerary({ picks: [{ blurb: 'no name' }] }), /name is required/);
});

// The text comes from the toll-free line, a number the guest does not know, so the body
// says who it is from before anything else, and no truncation step ever drops that.
test('every body opens with the sender tag, and the tag survives every truncation step', () => {
  assert.equal(SENDER_TAG, 'Bellhop Concierge:');
  const short = composeItinerary({ picks: [pick(1)], guest: { when: 'tonight' } });
  assert.ok(short.body.startsWith(`${SENDER_TAG} Tonight:\n`));
  assert.ok(!TRUNCATION_ORDER.some((s) => /tag|sender/.test(s)), 'the tag is not a truncation step');
  for (let n = 1; n <= 5; n++) {
    const picks = Array.from({ length: n }, (_, i) => pick(i + 1, { detail: 'Fri 8pm @ A Rather Long Venue Name Here' }));
    const r = composeItinerary({ picks, guest: { when: 'weekend' } });
    assert.ok(r.body.startsWith(SENDER_TAG), `n=${n}`);
    assert.ok(r.char_count <= MAX_CHARS);
  }
  const long = composeItinerary({ picks: [{ name: 'x'.repeat(600), url: LINK(1) }] });
  assert.ok(long.body.startsWith(SENDER_TAG) && long.char_count <= MAX_CHARS);
  assert.ok(/^[\x20-\x7e\n]+$/.test(short.body), 'still GSM-7 plain');
});
