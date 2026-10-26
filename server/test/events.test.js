// events_nearby: honest day labels and a spoken line built only from Ticketmaster's fields;
// compose_itinerary prints an event's day only as events_nearby gave it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, makeApp, PROPERTY, SECRET } from './helpers.js';
import { eventsNearby, eventWhen, sayLine, spokenTime, tonightEnds } from '../tools/events-nearby.js';
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
  // A 1am show belongs to the evening before, the same way the "tonight" window runs to 4am.
  const late = { start: '2026-10-17T05:00:00Z' }; // Saturday 1am New York
  assert.equal(eventWhen(late, at('2026-10-17T01:00:00Z'), NY).when_label, 'Tonight 1am'); // asked Fri 9pm
  // The same show asked about on Thursday is a Saturday show.
  assert.equal(eventWhen(late, THU_NIGHT, NY).when_label, 'Sat 1am');
  // A different timezone moves the day.
  assert.equal(eventWhen(FRI_8PM_SHOW, at('2026-10-17T02:00:00Z'), 'America/Los_Angeles').when_label, 'Tonight 5pm');
});

// The rule: tonight is the evening (4pm to 4am) of the call's calendar day, in the property's
// timezone, even for a call after midnight; a same-day daytime event is Today; else the weekday.
const FRI_0016 = at('2026-10-16T04:16:00Z'); // Friday 00:16 in New York
const FRI_6PM = at('2026-10-16T22:00:00Z');
const FRI_10AM = at('2026-10-16T14:00:00Z');
const FRI_11PM = at('2026-10-17T03:00:00Z');
const FRI_2PM_SHOW = { start: '2026-10-16T18:00:00Z', local_date: '2026-10-16', local_time: '14:00:00' };
const SAT_0030_SHOW = { start: '2026-10-17T04:30:00Z', local_date: '2026-10-17', local_time: '00:30:00' };

test('the round five regression: at 00:16 Friday, a Friday 8pm show is tonight, and say says so', () => {
  assert.deepEqual(eventWhen(FRI_8PM_SHOW, FRI_0016, NY), { when_label: 'Tonight 8pm', say_when: 'Tonight at eight', tonight: true });
  assert.equal(sayLine({ name: 'Hollow Pines String Band', venue: 'The Lyric Annex' }, eventWhen(FRI_8PM_SHOW, FRI_0016, NY).say_when),
    'Tonight at eight, The Lyric Annex, Hollow Pines String Band.');
});

test('tonight: a 6pm Friday call and a Friday 8pm show', () => {
  assert.deepEqual(eventWhen(FRI_8PM_SHOW, FRI_6PM, NY), { when_label: 'Tonight 8pm', say_when: 'Tonight at eight', tonight: true });
});

test('today: a 10am Friday call and a Friday 2pm show is today, not tonight', () => {
  assert.deepEqual(eventWhen(FRI_2PM_SHOW, FRI_10AM, NY),
    { when_label: 'Today 2pm', say_when: 'Today at two in the afternoon', tonight: false });
  // The same daytime show at 00:16 Friday is also today: the guest's day is Friday.
  assert.equal(eventWhen(FRI_2PM_SHOW, FRI_0016, NY).when_label, 'Today 2pm');
});

test('weekday: a Thursday call and a Friday show is Friday', () => {
  const thuAfternoon = at('2026-10-15T19:00:00Z'); // Thursday 3pm
  assert.deepEqual(eventWhen(FRI_8PM_SHOW, thuAfternoon, NY), { when_label: 'Fri 8pm', say_when: 'Friday at eight', tonight: false });
  assert.equal(eventWhen(FRI_2PM_SHOW, thuAfternoon, NY).say_when, 'Friday at two in the afternoon');
});

test('tonight across midnight: a 12:30am Saturday show during an 11pm Friday call', () => {
  assert.deepEqual(eventWhen(SAT_0030_SHOW, FRI_11PM, NY),
    { when_label: 'Tonight 12:30am', say_when: 'Tonight at twelve thirty in the morning', tonight: true });
  // During the small hours themselves, a show later in those hours is still tonight.
  assert.equal(eventWhen(SAT_0030_SHOW, at('2026-10-17T04:05:00Z'), NY).when_label, 'Tonight 12:30am'); // Sat 00:05
});

test('every say line opens with the same day word as its when_label', () => {
  const calls = [FRI_0016, FRI_10AM, FRI_2PM, FRI_6PM, FRI_11PM, THU_NIGHT];
  const shows = [FRI_8PM_SHOW, FRI_2PM_SHOW, SAT_0030_SHOW, { start: '2026-10-17', local_date: '2026-10-17', local_time: null }];
  for (const now of calls) {
    for (const show of shows) {
      const w = eventWhen(show, now, NY);
      const said = w.say_when.split(' ')[0];
      assert.match(said, /^(Tonight|Today|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/, `${show.start} @ ${now.toISOString()}`);
      assert.equal(w.when_label.split(' ')[0], ['Tonight', 'Today'].includes(said) ? said : said.slice(0, 3));
    }
  }
});

test('the tonight fetch window ends where the evening of the call day ends', () => {
  assert.equal(tonightEnds(FRI_0016, NY).toISOString(), '2026-10-17T08:00:00.000Z'); // Sat 4am, not Fri 3am
  assert.equal(tonightEnds(FRI_11PM, NY).toISOString(), '2026-10-17T08:00:00.000Z');
  assert.equal(tonightEnds(at('2026-10-17T04:05:00Z'), NY).toISOString(), '2026-10-18T08:00:00.000Z'); // Sat 00:05 -> Sun 4am
  // Across the November clock change: Saturday Oct 31 evening ends Sunday 4am EST (09:00Z).
  assert.equal(tonightEnds(at('2026-10-31T22:00:00Z'), NY).toISOString(), '2026-11-01T09:00:00.000Z');
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
  assert.match(json.body, /^Bellhop Concierge: Your plan:\n/);
  assert.match(json.body, /- Hollow Pines String Band, Fri 8pm\n/);
  assert.equal(json.when_dropped, 0);
  // Tonight's events keep the Tonight header.
  const tonight = (await callTool(app, 'events_nearby', { ...PROPERTY, when: 'tonight' })).json.events[0];
  const t = await callTool(app, 'compose_itinerary', { picks: [dinner, { name: tonight.name, when_label: tonight.when_label, pick_token: tonight.pick_token }], guest: { party_size: 2, when: 'tonight' } });
  assert.match(t.json.body, /^Bellhop Concierge: Tonight:\n/);
  assert.match(t.json.body, /- Hollow Pines String Band, Tonight 8pm\n/);
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
