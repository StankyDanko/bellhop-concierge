// Rebuilds server/fixtures/sample-session.json, the labeled sample call on the innkeeper
// dashboard, by running one made-up call through the real tools in mock mode. Every value
// comes from the hand-written fixtures in server/fixtures; nothing here touches Qloo or
// Ticketmaster. The dashboard API moves the call's clock to the day it is viewed, so the
// stored times only need to agree with each other.
//
//   /usr/bin/node server/scripts/make-sample-session.js            print the JSON
//   /usr/bin/node server/scripts/make-sample-session.js --write    write the fixture

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createApp } from '../app.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { readTrace, SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { SAMPLE_SESSION_PATH } from '../api/db.js';

// A throwaway key for this run only; no token it signs is stored in the fixture.
const SECRET = randomBytes(16).toString('hex');
const SESSION = 'conv_sample_juniper';
const NOW = new Date('2026-10-16T22:05:00Z'); // 6:05 pm at the inn
const INN = { lat: 32.0749, lng: -81.0943 };

const cache = new ResponseCache({ path: ':memory:' });
const qloo = createQlooClient({ config: { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 }, cache, logger: silentLogger });
const ticketmaster = createTicketmasterClient({ config: { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 }, cache, logger: silentLogger });
const sessions = new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => NOW });
const sms = createSmsSender({ config: { mock: true }, logger: silentLogger });
const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger: silentLogger, sms, sessions, now: () => NOW });

async function tool(name, body) {
  const res = await app.request(`/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Concierge-Secret': SECRET },
    body: JSON.stringify({ ...body, session_id: SESSION }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${name} failed: ${JSON.stringify(json.error)}`);
  return json;
}

const strip = (r) => ({ id: r.id, name: r.name });
const taste = await tool('resolve_taste', { mentions: ['Sturgill Simpson', 'thai food'], companion_mentions: ['Kacey Musgraves'] });
const near = await tool('recommend_nearby', { taste: taste.resolved.map(strip), companion_taste: taste.companion_resolved.map(strip), ...INN, take: 3 });
const film = await tool('cross_domain', { taste: taste.resolved.filter((r) => !r.id.startsWith('urn:tag:')).map(strip), target: 'movie', take: 1 });
const events = await tool('events_nearby', { ...INN, when: 'tonight', classification: 'music', take: 1 });

// The lead pick is the shared one when the rank rule finds one, otherwise the guest's best.
const both = near.places.find((p) => p.favors === 'both') ?? near.places[0];
const other = near.places.find((p) => p !== both && p.favors !== 'both');
const movie = film.results[0];
const show = events.events[0];
// The one claim the server did not sign: a "both" marker written onto a pick whose token was
// issued for a different value. compose_itinerary drops it before the text is built.
const forged = { name: other.name, why: other.why, url: other.url, favors: 'both', pick_token: other.pick_token };
const text = await tool('compose_itinerary', {
  picks: [
    { name: both.name, why: both.why, url: both.url, favors: both.favors, pick_token: both.pick_token },
    forged,
    { name: movie.name, pick_token: movie.pick_token },
    { name: show.name, url: show.url, when_label: show.when_label, pick_token: show.pick_token },
  ],
  guest: { party_size: 2, when: 'tonight' },
});

const { trace, counterfactual } = readTrace(sessions.db, SESSION);

const sample = {
  _note: 'Hand-made SAMPLE call for the dashboard, rebuilt by server/scripts/make-sample-session.js: one made-up guest and plus-one run through resolve_taste, recommend_nearby, cross_domain, events_nearby, and compose_itinerary in mock mode. Every value comes from the synthetic fixtures in this folder; nothing here is a Qloo or Ticketmaster response. The API moves started_at and the event window to the day the page is viewed.',
  label: 'Sample call',
  started_at: NOW.toISOString(),
  persona: 'harper',
  entities: taste.resolved.map((r) => r.name),
  companion_mentions: taste.companion_resolved.map((r) => r.name),
  picks_count: near.places.length,
  events_count: events.events.length,
  sms_sent: true,
  picks: near.places.map((p) => ({ name: p.name, why: p.why, favors: p.favors, favors_line: p.favors_line, signed: Boolean(p.pick_token) })),
  cross_domain: { target: 'movie', name: movie.name, year: movie.year, why: movie.why, signed: Boolean(movie.pick_token) },
  signed_text: {
    body: text.body,
    picks_included: text.picks_included,
    favors_dropped: text.favors_dropped,
    when_dropped: text.when_dropped,
    tokens_dropped: text.tokens_dropped,
    dropped: { name: forged.name, claim: `${forged.name} (both)`, signed_for: other.favors },
  },
  trace,
  counterfactual,
};

if (process.argv.includes('--write')) writeFileSync(SAMPLE_SESSION_PATH, `${JSON.stringify(sample, null, 2)}\n`);
else process.stdout.write(`${JSON.stringify(sample, null, 2)}\n`);
