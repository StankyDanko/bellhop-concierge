// events_nearby: honest day labels and a spoken line built only from Ticketmaster's fields;
// compose_itinerary prints an event's day only as events_nearby gave it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp, PROPERTY, SECRET } from './helpers.js';
import { eventsNearby, eventWhen, sayLine, spokenTime } from '../tools/events-nearby.js';
import { normalizeEvents } from '../lib/ticketmaster.js';
import { verifyPick } from '../lib/pick-token.js';

const NY = 'America/New_York';
const at = (iso) => new Date(iso);
const THU_NIGHT = at('2026-10-16T03:15:00Z'); // Thursday 11:15pm in New York
const FRI_2PM = at('2026-10-16T18:00:00Z');
const FRI_8PM_SHOW = { start: '2026-10-17T00:00:00Z', local_date: '2026-10-16', local_time: '20:00:00' };

test('spokenTime: words the way a person says a time', () => {
  assert.equal(spokenTime(20, 0), 'eight');
  assert.equal(spokenTime(19, 30), 'seven thirty');
  assert.equal(spokenTime(21, 5), 'nine oh five');
  assert.equal(spokenTime(22, 45), 'ten forty five');
  assert.equal(spokenTime(12, 0), 'noon');
  assert.equal(spokenTime(0, 0), 'midnight');
  assert.equal(spokenTime(14, 0), 'two in the afternoon');
  assert.equal(spokenTime(11, 15), 'eleven fifteen in the morning');
  assert.equal(spokenTime(1, 0), 'one in the morning');
});

test('the regression: a Friday show called on Thursday night is Friday, not tonight', () => {
  const w = eventWhen(FRI_8PM_SHOW, THU_NIGHT, NY);
  assert.equal(w.tonight, false);
  assert.equal(w.when_label, 'Fri 8pm');
  assert.equal(w.say_when, 'Friday at eight');
});

test('tonight only when the show is on tonight in the property timezone', () => {
  assert.deepEqual(eventWhen(FRI_8PM_SHOW, FRI_2PM, NY), { when_label: 'Tonight 8pm', say_when: 'Tonight at eight', tonight: true });
  // A 1am show belongs to the night before, the same way the "tonight" window runs to 3am.
  const late = { start: '2026-10-17T05:00:00Z' }; // Saturday 1am New York
  assert.equal(eventWhen(late, at('2026-10-17T01:00:00Z'), NY).when_label, 'Tonight 1am'); // asked Fri 9pm
  // The same show asked about on Thursday is a Saturday show.
  assert.equal(eventWhen(late, THU_NIGHT, NY).when_label, 'Sat 1am');
  // A different timezone moves the day.
  assert.equal(eventWhen(FRI_8PM_SHOW, at('2026-10-17T02:00:00Z'), 'America/Los_Angeles').when_label, 'Tonight 5pm');
});

test('a date with no time is the weekday, or today, never tonight', () => {
  const dateOnly = { start: '2026-10-17', local_date: '2026-10-17', local_time: null };
  assert.deepEqual(eventWhen(dateOnly, FRI_2PM, NY), { when_label: 'Sat', say_when: 'Saturday', tonight: false });
  assert.deepEqual(eventWhen(dateOnly, at('2026-10-17T15:00:00Z'), NY), { when_label: 'Today', say_when: 'Today', tonight: false });
  assert.equal(eventWhen({ start: null }, FRI_2PM, NY).when_label, null);
});

test('say: day and time, venue, name, and nothing else', () => {
  assert.equal(sayLine({ name: 'Folk Night', venue: 'Hollow Oak Hall' }, 'Friday at seven thirty'), 'Friday at seven thirty, Hollow Oak Hall, Folk Night.');
  assert.equal(sayLine({ name: 'Folk Night', venue: null }, 'Saturday'), 'Saturday, Folk Night.');
});

test('normalizeEvents keeps the venue-local date and time', () => {
  const [e] = normalizeEvents({ _embedded: { events: [{ id: 'x', name: 'N', dates: { start: { localDate: '2026-10-16', localTime: '19:30:00' } } }] } });
  assert.equal(e.local_date, '2026-10-16');
  assert.equal(e.local_time, '19:30:00');
  assert.equal(eventWhen(e, THU_NIGHT, NY).say_when, 'Friday at seven thirty');
});

test('events_nearby over HTTP: say, when_label, tonight, and a pick_token on every event', async () => {
  const { app } = makeApp();
  const { json } = await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight' });
  assert.deepEqual(json.events.map((e) => [e.when_label, e.say]), [
    ['Tonight 8pm', 'Tonight at eight, The Lyric Annex, Hollow Pines String Band.'],
    ['Tonight 9:30pm', 'Tonight at nine thirty, Back Porch Theater, Late Night Improv.'],
    ['Sat', 'Saturday, Square Cinema, Harbor Film Night: Westerns.'],
  ]);
  for (const e of json.events) {
    assert.equal(verifyPick(SECRET, e), true, e.name);
    assert.doesNotMatch(e.say, /fit|fans|love|match|like/i, 'no taste claims');
    assert.ok(!('why' in e));
  }
});

test('events_nearby labels against the call time, not the window asked for', async () => {
  const ticketmaster = { enabled: true, events: async () => ({ events: normalizeEvents({ _embedded: { events: [
    { id: 'a', name: 'Hollow Pines String Band', dates: { start: { localDate: '2026-10-16', localTime: '20:00:00', dateTime: '2026-10-17T00:00:00Z' } },
      _embedded: { venues: [{ name: 'The Lyric Annex' }] } }] } }), call: { service: 'ticketmaster' } }) };
  const r = await eventsNearby({ ...PROPERTY, when: 'tonight' }, { ticketmaster, timezone: NY, now: () => THU_NIGHT, toolSecret: SECRET });
  assert.equal(r.events[0].when_label, 'Fri 8pm');
  assert.equal(r.events[0].tonight, false);
  assert.equal(r.events[0].say, 'Friday at eight, The Lyric Annex, Hollow Pines String Band.');
});

test('compose_itinerary: the header follows the events, never the request', async () => {
  const { app } = makeApp();
  const ticketmaster = { enabled: true, events: async () => ({ events: normalizeEvents({ _embedded: { events: [
    { id: 'a', name: 'Hollow Pines String Band', url: 'https://example.com/events/hollow-pines',
      dates: { start: { localDate: '2026-10-16', localTime: '20:00:00', dateTime: '2026-10-17T00:00:00Z' } } }] } }), call: {} }) };
  const [fri] = (await eventsNearby({ ...PROPERTY }, { ticketmaster, timezone: NY, now: () => THU_NIGHT, toolSecret: SECRET })).events;
  const dinner = { name: 'Lemongrass Lantern', why: 'Fans of Thai food love it' };
  const event = { name: fri.name, url: fri.url, when_label: fri.when_label, pick_token: fri.pick_token };
  const { json } = await callTool(app, 'compose_itinerary', { picks: [dinner, event], guest: { party_size: 2, when: 'tonight' } });
  assert.match(json.body, /^Your plan for 2:\n/);
  assert.match(json.body, /2\. Hollow Pines String Band Fri 8pm https:/);
  assert.equal(json.when_dropped, 0);
  // Tonight's events keep the Tonight header.
  const tonight = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight' })).json.events[0];
  const t = await callTool(app, 'compose_itinerary', { picks: [dinner, { name: tonight.name, when_label: tonight.when_label, pick_token: tonight.pick_token }], guest: { party_size: 2, when: 'tonight' } });
  assert.match(t.json.body, /^Tonight for 2:\n/);
  assert.match(t.json.body, /Hollow Pines String Band Tonight 8pm/);
});

test('compose_itinerary: a forged when_label or a free-text detail never reaches the text', async () => {
  const { app } = makeApp();
  const fri = { name: 'Hollow Pines String Band', when_label: 'Fri 8pm' };
  const { json } = await callTool(app, 'compose_itinerary', {
    picks: [
      { ...fri, when_label: 'Tonight 8pm', pick_token: 'AAAAAAAAAAAAAAAA' },
      { name: 'Late Night Improv', detail: 'Tonight 9pm' },
    ],
    guest: { when: 'tonight' },
  });
  assert.equal(json.when_dropped, 1);
  assert.doesNotMatch(json.body, /Tonight 8pm|Tonight 9pm/);
});
