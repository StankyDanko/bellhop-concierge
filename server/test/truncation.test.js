// The truncation order, one step at a time. A long text keeps every pick the guest heard for
// as long as it can: lower reasons go first, then the link scheme, then lower links, then the
// (both) markers, and only then a whole pick, with an event the guest asked for by name last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeItinerary, MAX_CHARS, TRUNCATION_ORDER } from '../lib/sms.js';
import { honorClaims } from '../tools/compose-itinerary.js';
import { signPick } from '../lib/pick-token.js';
import { callTool, makeApp, PROPERTY, SECRET } from './helpers.js';

const WHY = 'Fans of Thai food love it'; // " - " + WHY is 28 characters
const URL_OF = (n) => `https://example.com/p${n}`; // the scheme is 8 characters

/** Pad the top pick's name so the untruncated text (no header) is `over` characters past 320. */
function overBy(picks, over) {
  const base = composeItinerary({ picks, intro: '' });
  assert.deepEqual(base.truncation, [], 'the base must fit before padding');
  const pad = 'x'.repeat(MAX_CHARS - base.char_count + over);
  return picks.map((p, i) => (i === 0 ? { ...p, name: `${p.name}${pad}` } : p));
}
const lines = (body) => body.split('\n').slice(0, -1);
/** Applied steps, each named once, in the order they first ran. */
const steps = (r) => r.truncation.filter((s, i) => r.truncation.indexOf(s) === i && s !== 'drop_header');

test('the documented order is reasons, scheme, links, markers, then picks', () => {
  assert.deepEqual(TRUNCATION_ORDER.slice(0, 6),
    ['drop_header', 'drop_last_why', 'drop_scheme', 'drop_last_link', 'drop_marker', 'drop_last_pick']);
});

test('step 2: lower reasons go whole, lowest-ranked first, and the top reason stays', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, why: WHY }));
  const one = composeItinerary({ picks: overBy(picks, 10), intro: '' });
  assert.deepEqual(steps(one), ['drop_last_why']);
  assert.equal(one.truncation.filter((s) => s === 'drop_last_why').length, 1);
  assert.match(one.body, /\n2\. P2 - Fans of Thai food love it\n3\. P3\n/);
  const two = composeItinerary({ picks: overBy(picks, 40), intro: '' });
  assert.equal(two.truncation.filter((s) => s === 'drop_last_why').length, 2);
  assert.match(two.body, /^1\. P1x+ - Fans of Thai food love it\n2\. P2\n3\. P3\n/);
  assert.equal(two.picks_included, 3);
});

test('step 3: once lower reasons are gone, every link loses its scheme and stays', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, why: WHY, url: URL_OF(n) }));
  const r = composeItinerary({ picks: overBy(picks, 56 + 5), intro: '' });
  assert.deepEqual(steps(r), ['drop_last_why', 'drop_scheme']);
  assert.ok(r.char_count <= MAX_CHARS);
  assert.equal(r.picks_included, 3);
  for (const n of [1, 2, 3]) assert.ok(r.body.includes(` example.com/p${n}`), `p${n} keeps its link`);
  assert.ok(!r.body.includes('https://'));
  assert.match(r.body, / - Fans of Thai food love it example\.com\/p1\n/, 'top reason and link stay');
});

test('step 4: then lower links go, lowest-ranked first, and the top link stays', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, url: URL_OF(n) }));
  const r = composeItinerary({ picks: overBy(picks, 24 + 5), intro: '' });
  assert.deepEqual(steps(r), ['drop_scheme', 'drop_last_link']);
  assert.deepEqual(lines(r.body).map((l) => l.replace(/^1\. P1x+/, '1. P1')), ['1. P1 example.com/p1', '2. P2 example.com/p2', '3. P3']);
  assert.equal(r.picks_included, 3);
});

test('step 5: the (both) marker goes after the links and before any pick', () => {
  const picks = [{ name: 'P1', url: URL_OF(1) }, { name: 'P2', url: URL_OF(2), favors: 'both' }, { name: 'P3', url: URL_OF(3) }];
  // 24 for the schemes, 2 x 15 for the lower links, then 3 more: only the marker frees it.
  const r = composeItinerary({ picks: overBy(picks, 24 + 30 + 3), intro: '' });
  assert.deepEqual(steps(r), ['drop_scheme', 'drop_last_link', 'drop_marker']);
  assert.equal(r.picks_included, 3);
  assert.ok(!r.body.includes('(both)'));
  assert.ok(r.char_count <= MAX_CHARS);
});

test('step 6: a whole pick goes only after all that, lowest-ranked first', () => {
  const picks = [1, 2, 3].map((n) => ({ name: `P${n}`, why: WHY, url: URL_OF(n) }));
  const r = composeItinerary({ picks: overBy(picks, 56 + 24 + 30 + 5), intro: '' });
  assert.deepEqual(steps(r), ['drop_last_why', 'drop_scheme', 'drop_last_link', 'drop_last_pick']);
  assert.equal(r.picks_included, 2);
  assert.match(r.body, /\n2\. P2\n/);
  assert.match(r.body, / - Fans of Thai food love it example\.com\/p1\n/);
});

test('step 6: an event the guest asked for by name is the last pick to go', () => {
  const picks = [
    { name: 'P1', why: WHY, url: URL_OF(1) },
    { name: 'P2', why: WHY, url: URL_OF(2) },
    { name: 'P3', why: WHY, url: URL_OF(3) },
    { name: 'Hollow Pines String Band', detail: 'Fri 8pm', url: URL_OF(4), requested: true },
  ];
  // Words and links free 56 + 32 + 45; 8 more means picks must go. P3 and P2 go, the show stays.
  const two = composeItinerary({ picks: overBy(picks, 56 + 32 + 45 + 8), intro: '' });
  assert.equal(two.picks_included, 2);
  assert.match(two.body, /\n2\. Hollow Pines String Band Fri 8pm\n/);
  // So far over that only one pick fits: even the top pick goes before the requested show.
  const one = composeItinerary({ picks: overBy(picks, 200), intro: '' });
  assert.equal(one.picks_included, 1);
  assert.match(one.body, /^Hollow Pines String Band/);
  // Without the flag the show is ranked last like any pick, so it is the first to go.
  const plain = picks.map(({ requested: _r, ...p }) => p);
  const r = composeItinerary({ picks: overBy(plain, 56 + 32 + 45 + 8), intro: '' });
  assert.equal(r.picks_included, 3);
  assert.ok(!r.body.includes('Hollow Pines'));
});

test('the round-two shapes keep every pick: a dinner and a show, and three places with a maps link', () => {
  const show = composeItinerary({ picks: [
    { name: 'Lemongrass Lantern', why: 'Fans of Thai food and Sturgill Simpson love it', url: 'https://example.com/lemongrass-lantern' },
    { name: 'The Low Lantern Listening Room', why: 'Fans of Sturgill Simpson and Wes Anderson love it', url: 'https://example.com/low-lantern' },
    { name: 'Hollow Pines String Band', detail: 'Fri 8pm', why: 'Friday at eight, The Lyric Annex, Hollow Pines String Band.', url: 'https://example.com/events/hollow-pines', requested: true },
  ], guest: { party_size: 2, when: 'tonight' }, intro: 'Your plan for 2:' });
  assert.equal(show.picks_included, 3);
  assert.match(show.body, /3\. Hollow Pines String Band Fri 8pm/);
  assert.equal(show.truncation.includes('drop_last_pick'), false);
  const three = composeItinerary({ picks: [
    { name: 'Lemongrass Lantern', why: 'Fans of Thai food love it', url: 'https://example.com/lemongrass-lantern' },
    { name: 'The Low Lantern Listening Room', why: 'Strong match for your overall taste', url: 'https://example.com/low-lantern' },
    { name: 'Pastel Diner & Pie', why: 'Strong match for your overall taste', url: 'https://www.google.com/maps/search/?api=1&query=Pastel%20Diner%20%26%20Pie%209%20Sample%20Sq' },
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

test('over HTTP: four picks with a requested event, the event survives a long text', async () => {
  const { app } = makeApp();
  const thai = { id: 'urn:tag:genre:place:restaurant:thai', name: 'Thai food' };
  const sturgill = { id: 'fx-artist-sturgill-simpson', name: 'Sturgill Simpson' };
  const places = (await callTool(app, 'recommend_nearby', { taste: [sturgill, thai], ...PROPERTY, take: 3 })).json.places;
  const events = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'weekend' })).json.events;
  const show = events.at(-1);
  const picks = [
    ...places.map((p) => ({ name: p.name, why: p.why, url: p.url, pick_token: p.pick_token })),
    { name: show.name, url: show.url, when_label: show.when_label, pick_token: show.pick_token, requested: true },
  ];
  assert.equal(picks.length, 4);
  const { status, json } = await callTool(app, 'compose_itinerary', { picks, guest: { party_size: 2, when: 'weekend' } });
  assert.equal(status, 200);
  assert.ok(json.char_count <= MAX_CHARS);
  assert.ok(json.body.includes(`${show.name} ${show.when_label}`), json.body);
  assert.ok(json.truncation.length > 0, 'the four-pick text was long enough to truncate');
});
