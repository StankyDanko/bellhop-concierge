// Test helpers: build the full app around fixture clients and an in-memory cache.

import { createApp } from '../app.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';
import { createWeatherClient } from '../lib/weather.js';
import { createGeocoder } from '../lib/geocode.js';
import { SessionStore } from '../lib/sessions.js';
import { createSmsSender } from '../lib/twilio.js';
import { GuestMemory } from '../lib/memory.js';
import { openDashboardDb } from '../api/db.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SECRET = 'test-secret-0123456789';
export const PROPERTY = { lat: 32.079, lng: -81.095 };
export const FIXED_NOW = new Date('2026-10-16T18:00:00Z'); // a Friday, 2pm in New York

const qlooConfig = { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 };
const tmConfig = { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 };

/** The memory layer's own secret in tests: deliberately not SECRET (the keys must differ). */
export const MEMORY_SECRET = 'test-memory-secret-9876543210';
/** The voice agent id the tests and the mock battery post to the initiation webhook. */
export const TEST_AGENTS = Object.freeze({ battery: { property_id: 'demo', persona: 'harper', timezone: 'America/New_York' } });

/**
 * @param {{ qlooTransport?: any, weatherTransport?: any, geocodeTransport?: any, logger?: any, sms?: any, memory?: boolean, dashboard?: boolean, initRng?: () => number, cache?: any }} [opts]
 * geocodeTransport: a fake Open-Meteo geocoding transport; given, tools accept a locality (cached in the same in-memory cache).
 * weatherTransport: a fake Open-Meteo transport; given, the app asks for a forecast (cached in the same in-memory cache).
 * memory: open an in-memory guest memory with its own clock (clock.advance(ms) moves it).
 * dashboard: mount the innkeeper dashboard on its own in-memory database.
 * composedTextsOnly: send_sms sends only a body compose_itinerary issued on the same call, as the
 *   real server does. Off by default here so a test can send a hand-written body; on in
 *   composed-texts.test.js and the battery.
 */
export function makeApp({ qlooTransport, weatherTransport, geocodeTransport, logger = silentLogger, sms, memory = false, dashboard = false, initRng, cache: givenCache, composedTextsOnly = false } = {}) {
  const cache = givenCache ?? new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: qlooConfig, cache, logger, transport: qlooTransport });
  const ticketmaster = createTicketmasterClient({ config: tmConfig, cache, logger });
  const weather = weatherTransport ? createWeatherClient({ config: { baseUrl: 'https://api.open-meteo.com', timeoutMs: 1000 }, cache, logger, transport: weatherTransport }) : null;
  const geocoder = geocodeTransport ? createGeocoder({ config: { baseUrl: 'https://geocoding-api.open-meteo.com', timeoutMs: 1000 }, cache, logger, transport: geocodeTransport }) : null;
  const sessions = new SessionStore({ path: ':memory:', hashKey: SECRET, now: () => FIXED_NOW });
  const smsSender = sms ?? createSmsSender({ config: { mock: true }, logger });
  let offset = 0;
  const clock = { now: () => new Date(FIXED_NOW.getTime() + offset), advance: (ms) => { offset += ms; } };
  const guestMemory = memory ? new GuestMemory({ path: ':memory:', secret: MEMORY_SECRET, now: clock.now }) : null;
  const dash = dashboard ? { db: openDashboardDb({ path: ':memory:', now: () => FIXED_NOW }), env: {}, distDir: join(tmpdir(), 'no-such-dist') } : undefined;
  const app = createApp({ secret: SECRET, qloo, ticketmaster, weather, geocoder, timezone: 'America/New_York', logger, sms: smsSender, sessions,
    now: memory ? clock.now : () => FIXED_NOW, dashboard: dash, memory: guestMemory, agents: memory ? { ...TEST_AGENTS } : {}, initRng, composedTextsOnly });
  return { app, cache, sessions, memory: guestMemory, clock, weather, geocoder };
}

/** POST the initiation webhook as the voice platform would. */
export async function callInit(app, body, headers = { 'X-Concierge-Secret': SECRET }) {
  const res = await app.request('/hooks/conversation-init', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** POST a tool call with the right secret. */
export async function callTool(app, tool, body, headers = { 'X-Concierge-Secret': SECRET }) {
  const res = await app.request(`/tools/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
