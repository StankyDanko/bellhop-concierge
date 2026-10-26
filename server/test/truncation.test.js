// The truncation order, one step at a time. A long text keeps every pick the guest heard for
// as long as it can: lower blurbs go first, then lower links (each whole, never shortened),
// then the (both) markers, and only then a whole pick, with an event the guest asked for by
// name last. The remaining pick then loses its blurb, detail, name length, and link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeItinerary, MAX_CHARS, TRUNCATION_ORDER } from '../lib/sms.js';
import { honorClaims } from '../tools/compose-itinerary.js';
import { signPick } from '../lib/pick-token.js';
import { callTool, makeApp, PROPERTY, SECRET } from './helpers.js';

const WHY = 'Thai spot, Five Points St'; // a blurb; " - " + it is 28 characters
const URL_OF = (n) => `https://example.com/p${n}`; // " " + URL is 23 characters
const LINK = 23;

/** Pad the top pick's name so the untruncated text (no header) is `over` characters past 320. */
function overBy(picks, over) {
  const base = composeItinerary({ picks, intro: '' });
  assert.deepEqual(base.truncation, [], 'the base must fit before padding');
  const pad = 'x'.repeat(MAX_CHARS - base.char_count + over);
  return picks.map((p, i) => (i === 0 ? { ...p, name: `${p.name}${pad}` } : p));
}
// Every body opens with the sender tag line (intro '' leaves it alone) and ends with the footer.
const lines = (body) => body.split('\n').slice(1, -1);
/** Applied steps, each named once, in the order they first ran. */
const steps = (r) => r.truncation.filter((s, i) => r.truncation.indexOf(s) === i && s !== 'drop_header');

test('the documented order is blurbs, links, markers, picks, then the last pick', () => {
  assert.deepEqual(TRUNCATION_ORDER, [
    'drop_header', 'drop_last_blurb', 'drop_last_link', 'drop_marker', 'drop_last_pick',
    'drop_blurb', 'drop_detail', 'trim_name', 'drop_link',
  ]);
  assert.ok(!TRUNCATION_ORDER.includes('drop_scheme'), 'a link is never shortened');
});

test('step 2: lower blurbs go whole, lowest-ranked first, and the top blurb stays', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, blurb: WHY }));
  const one = composeItinerary({ picks: overBy(picks, 10), intro: '' });
  assert.deepEqual(steps(one), ['drop_last_blurb']);
  assert.equal(one.truncation.filter((s) => s === 'drop_last_blurb').length, 1);
  assert.match(one.body, /\n2\. P2 - Thai spot, Five Points St\n3\. P3\n/);
  const two = composeItinerary({ picks: overBy(picks, 40), intro: '' });
  assert.equal(two.truncation.filter((s) => s === 'drop_last_blurb').length, 2);
  assert.match(two.body, /^Bellhop Concierge:\n1\. P1x+ - Thai spot, Five Points St\n2\. P2\n3\. P3\n/);
  assert.equal(two.picks_included, 3);
});

test('step 3: lower links go whole, lowest-ranked first, and the top link stays whole', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, url: URL_OF(n) }));
  const one = composeItinerary({ picks: overBy(picks, 10), intro: '' });
  assert.deepEqual(steps(one), ['drop_last_link']);
  assert.deepEqual(lines(one.body).map((l) => l.replace(/^1\. P1x+/, '1. P1')),
    ['1. P1 https://example.com/p1', '2. P2 https://example.com/p2', '3. P3']);
  const two = composeItinerary({ picks: overBy(picks, LINK + 5), intro: '' });
  assert.deepEqual(steps(two), ['drop_last_link']);
  assert.deepEqual(lines(two.body).map((l) => l.replace(/^1\. P1x+/, '1. P1')),
    ['1. P1 https://example.com/p1', '2. P2', '3. P3']);
  assert.equal(two.picks_included, 3);
});

test('steps 2 and 3: blurbs go before links, and no link loses its scheme', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, blurb: WHY, url: URL_OF(n) }));
  const r = composeItinerary({ picks: overBy(picks, 56 + 5), intro: '' });
  assert.deepEqual(steps(r), ['drop_last_blurb', 'drop_last_link']);
  assert.ok(r.char_count <= MAX_CHARS);
  assert.equal(r.picks_included, 3);
  assert.match(r.body, / - Thai spot, Five Points St https:\/\/example\.com\/p1\n/, 'top blurb and link stay');
  assert.match(r.body, /\n2\. P2 https:\/\/example\.com\/p2\n3\. P3\n/);
  assert.doesNotMatch(r.body, /(^|\s)example\.com/, 'every link in the body is whole');
});

test('step 4: the (both) marker goes after the links and before any pick', () => {
  const picks = [{ name: 'P1', url: URL_OF(1) }, { name: 'P2', url: URL_OF(2), favors: 'both' }, { name: 'P3', url: URL_OF(3) }];
  // 2 x 23 for the lower links, then 3 more: only the marker frees it.
  const r = composeItinerary({ picks: overBy(picks, 2 * LINK + 3), intro: '' });
  assert.deepEqual(steps(r), ['drop_last_link', 'drop_marker']);
  assert.equal(r.picks_included, 3);
  assert.ok(!r.body.includes('(both)'));
  assert.ok(r.body.includes(' https://example.com/p1\n'));
  assert.ok(r.char_count <= MAX_CHARS);
});

test('step 5: a whole pick goes only after all that, lowest-ranked first', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, blurb: WHY, url: URL_OF(n) }));
  const r = composeItinerary({ picks: overBy(picks, 56 + 2 * LINK + 5), intro: '' });
  assert.deepEqual(steps(r), ['drop_last_blurb', 'drop_last_link', 'drop_last_pick']);
  assert.equal(r.picks_included, 2);
  assert.match(r.body, /\n2\. P2\n/);
  assert.match(r.body, / - Thai spot, Five Points St https:\/\/example\.com\/p1\n/);
});

test('steps 6 to 8: the last pick loses its blurb, then detail, then name length, link kept', () => {
  const pick = { name: 'Lemongrass Lantern', detail: 'Fri 8pm', blurb: WHY, url: URL_OF(1) };
  // 28 for the blurb, 8 for the detail, then 5 more: only a shorter name frees it.
  const r = composeItinerary({ picks: overBy([pick], 28 + 8 + 5), intro: '' });
  assert.deepEqual(steps(r), ['drop_blurb', 'drop_detail', 'trim_name']);
  assert.equal(r.picks_included, 1);
  assert.ok(r.char_count <= MAX_CHARS);
  assert.match(r.body, /^Bellhop Concierge:\nLemongrass Lanternx+ https:\/\/example\.com\/p1\n/);
});

test('step 9 waits behind a shorter name: a very long name still keeps the whole link', () => {
  const r = composeItinerary({ picks: [{ name: 'x'.repeat(500), url: URL_OF(1) }], intro: '' });
  assert.equal(r.truncation.at(-1), 'trim_name');
  assert.ok(!r.truncation.includes('drop_link'));
  assert.ok(r.body.includes(` ${URL_OF(1)}\n`));
  assert.ok(r.char_count <= MAX_CHARS);
});

test('step 5: an event the guest asked for by name is the last pick to go', () => {
  const picks = [
    { name: 'P1', blurb: WHY, url: URL_OF(1) },
    { name: 'P2', blurb: WHY, url: URL_OF(2) },
    { name: 'P3', blurb: WHY, url: URL_OF(3) },
    { name: 'Hollow Pines String Band', detail: 'Fri 8pm', url: URL_OF(4), requested: true },
  ];
  // Words and links free 56 + 3 x 23; 8 more means picks must go. P3 and P2 go, the show stays.
  const two = composeItinerary({ picks: overBy(picks, 56 + 3 * LINK + 8), intro: '' });
  assert.equal(two.picks_included, 2);
  assert.match(two.body, /\n2\. Hollow Pines String Band Fri 8pm\n/);
  // So far over that only one pick fits: even the top pick goes before the requested show.
  const one = composeItinerary({ picks: overBy(picks, 200), intro: '' });
  assert.equal(one.picks_included, 1);
  assert.match(one.body, /^Bellhop Concierge:\nHollow Pines String Band/);
  // Without the flag the show is ranked last like any pick, so it is the first to go.
  const plain = picks.map(({ requested: _r, ...p }) => p);
  const r = composeItinerary({ picks: overBy(plain, 56 + 3 * LINK + 8), intro: '' });
  assert.equal(r.picks_included, 3);
  assert.ok(!r.body.includes('Hollow Pines'));
});

test('the round-two shapes keep every pick: a dinner and a show, and three places with a maps link', () => {
  const show = composeItinerary({ picks: [
    { name: 'Lemongrass Lantern', blurb: 'Thai restaurant, Five Points', url: 'https://example.com/lemongrass-lantern' },
    { name: 'The Low Lantern Listening Room', blurb: 'listening room, Old Town', url: 'https://example.com/low-lantern' },
    { name: 'Hollow Pines String Band', detail: 'Fri 8pm', blurb: 'The Lyric Annex', url: 'https://example.com/events/hollow-pines', requested: true },
  ], guest: { party_size: 2, when: 'tonight' }, intro: 'Your plan for 2:' });
  assert.equal(show.picks_included, 3);
  assert.match(show.body, /3\. Hollow Pines String Band Fri 8pm/);
  assert.equal(show.truncation.includes('drop_last_pick'), false);
  const three = composeItinerary({ picks: [
    { name: 'Lemongrass Lantern', blurb: 'Thai spot, Five Points St', url: 'https://example.com/lemongrass-lantern' },
    { name: 'The Low Lantern Listening Room', blurb: 'diner, Five Points', url: 'https://example.com/low-lantern' },
    { name: 'Pastel Diner & Pie', blurb: 'diner, Five Points', url: 'https://www.google.com/maps/search/?api=1&query=Pastel%20Diner%20%26%20Pie%209%20Sample%20Sq' },
  ], guest: { party_size: 2, when: 'tonight' } });
  assert.equal(three.picks_included, 3);
  assert.ok(three.char_count <= MAX_CHARS);
});

test('requested is kept only on an event whose pick_token verifies', () => {
  const event = { name: 'Hollow Pines String Band', when_label: 'Fri 8pm' };
  const place = { name: 'Lemongrass Lantern', favors: 'guest' };
  const { picks } = honorClaims([
    { ...place, pick_token: signPick(SECRET, place), requested: true },
    { ...event, pick_token: signPick(SECRET, event), requested: true },
    { ...event, when_label: 'Tonight 8pm', pick_token: signPick(SECRET, event), requested: true },
    { name: 'Plain Place', requested: true },
  ], SECRET);
  assert.deepEqual(picks.map((p) => p.requested === true), [false, true, false, false]);
});

test('over HTTP: four picks with a requested event, every pick fits, each with a short link', async () => {
  const { app } = makeApp();
  const thai = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };
  const sturgill = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
  const places = (await callTool(app, 'recommend_nearby', { taste: [sturgill, thai], ...PROPERTY, take: 3 })).json.places;
  const events = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'weekend' })).json.events;
  const show = events.at(-1);
  const picks = [
    ...places.map((p) => ({ name: p.name, blurb: p.blurb, url: p.url, pick_token: p.pick_token })),
    { name: show.name, url: show.url, when_label: show.when_label, pick_token: show.pick_token, requested: true },
  ];
  assert.equal(picks.length, 4);
  const { status, json } = await callTool(app, 'compose_itinerary', { picks, guest: { party_size: 2, when: 'weekend' } });
  assert.equal(status, 200);
  assert.ok(json.char_count <= MAX_CHARS);
  assert.ok(json.body.includes(`${show.name} ${show.when_label}`), json.body);
  assert.equal(json.picks_included, 4, 'short links and blurbs leave room for all four');
  assert.equal((json.body.match(/https:\/\/concierge\.southernsky\.cloud\/go\/[A-Za-z0-9_-]{8}/g) ?? []).length, picks.filter((p) => p.url).length, json.body);
});
