// Test helpers: build the full app around fixture clients and an in-memory cache.

import { createApp } from '../app.js';
import { ResponseCache } from '../lib/cache.js';
import { silentLogger } from '../lib/log.js';
import { createQlooClient } from '../lib/qloo.js';
import { createTicketmasterClient } from '../lib/ticketmaster.js';

export const SECRET = 'test-secret-0123456789';
export const PROPERTY = { lat: 32.079, lng: -81.095 };
export const FIXED_NOW = new Date('2026-10-16T18:00:00Z'); // a Friday, 2pm in New York

const qlooConfig = { baseUrl: 'https://hackathon.api.qloo.com', apiKey: '', mock: true, timeoutMs: 1000, retries: 0 };
const tmConfig = { baseUrl: 'https://app.ticketmaster.com/discovery/v2', apiKey: '', mock: true, timeoutMs: 1000 };

/**
 * @param {{ qlooTransport?: any, logger?: any }} [opts]
 */
export function makeApp({ qlooTransport, logger = silentLogger } = {}) {
  const cache = new ResponseCache({ path: ':memory:' });
  const qloo = createQlooClient({ config: qlooConfig, cache, logger, transport: qlooTransport });
  const ticketmaster = createTicketmasterClient({ config: tmConfig, cache, logger });
  const app = createApp({ secret: SECRET, qloo, ticketmaster, timezone: 'America/New_York', logger, now: () => FIXED_NOW });
  return { app, cache };
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
