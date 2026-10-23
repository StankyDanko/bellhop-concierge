// Entry point: read config, wire clients and cache, start listening.
//
//   QLOO_MOCK=1 / TICKETMASTER_MOCK=1   answer from server/fixtures (no keys needed)
//   CACHE_ONLY=1                         serve only cached responses (no upstream calls)
//   otherwise                            live, with the SQLite cache in front

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { ResponseCache } from './lib/cache.js';
import { jsonLogger } from './lib/log.js';
import { createQlooClient } from './lib/qloo.js';
import { createTicketmasterClient } from './lib/ticketmaster.js';
import { createWeatherClient } from './lib/weather.js';
import { SessionStore } from './lib/sessions.js';
import { createSmsSender } from './lib/twilio.js';
import { openDashboardDb } from './api/db.js';
import { dashboardEnv } from './api/index.js';
import { GuestMemory } from './lib/memory.js';
import { parseAgents } from './hooks/conversation-init.js';

const config = loadConfig();
if (!config.toolSecret) {
  console.error('CONCIERGE_TOOL_SECRET is not set; refusing to start (tool routes would be unauthenticated).');
  process.exit(1);
}

const needsCache = !(config.qloo.mock && config.ticketmaster.mock);
let cache = null;
try {
  cache = needsCache ? new ResponseCache({ path: config.cache.path, only: config.cache.only, frozen: config.cache.freeze }) : null;
} catch (err) {
  // A frozen server with no real cache would answer every request with a miss: refuse instead.
  console.error(`Refusing to start: ${err.message}`);
  process.exit(1);
}
const logger = jsonLogger;

const sessions = new SessionStore({ path: config.sessionsPath, hashKey: config.toolSecret });
const sms = createSmsSender({ config: config.sms, logger });
// Innkeeper configs live in the same SQLite file as the session log (seeds the demo inn on first run).
const dashboardDb = openDashboardDb({ path: process.env.DASHBOARD_DB_PATH || config.sessionsPath });

// Returning-guest memory: its own file, its own secret, and off unless that secret is set (and
// differs from the tool secret, so memory and session rows can never be joined by hash).
let memory = null;
if (config.memory.secret && config.memory.secret === config.toolSecret) {
  logger({ svc: 'memory', error: 'secret_reused', detail: 'GUEST_MEMORY_SECRET equals CONCIERGE_TOOL_SECRET; memory stays off' });
} else if (config.memory.secret) {
  memory = new GuestMemory({ path: config.memory.path, secret: config.memory.secret, ttlDays: config.memory.ttlDays, logger });
}
const sweep = () => {
  try { const r = memory?.sweep(); if (r) logger({ svc: 'memory', sweep: r }); } catch (err) { logger({ svc: 'memory', error: 'sweep_failed', detail: String(err?.message ?? err) }); }
};
sweep();
const sweepTimer = memory ? setInterval(sweep, 15 * 60_000) : null;
sweepTimer?.unref();

let app;
try {
  app = createApp({
    secret: config.toolSecret,
    qloo: createQlooClient({ config: config.qloo, cache, logger }),
    ticketmaster: createTicketmasterClient({ config: config.ticketmaster, cache, logger }),
    // No forecast in mock mode (offline) or with WEATHER=0; frozen mode serves the cached one.
    weather: config.weather.enabled && !config.qloo.mock && cache ? createWeatherClient({ config: config.weather, cache, logger }) : null,
    timezone: config.defaultTimezone,
    logger,
    sms,
    sessions,
    cacheMode: cache?.frozen ? 'frozen' : cache?.only ? 'only' : cache ? 'on' : 'off',
    dashboard: { db: dashboardDb, env: dashboardEnv() },
    memory,
    agents: parseAgents(config.agentsJson),
  });
} catch (err) {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger({ svc: 'server', listening: info.port, qloo: config.qloo.mock ? 'mock' : config.cache.only ? 'cache-only' : 'live',
    ticketmaster: config.ticketmaster.mock ? 'mock' : config.ticketmaster.apiKey ? 'live' : 'disabled', sms: sms.mode });
});

const shutdown = () => {
  server.close(() => {
    cache?.close();
    sessions.close();
    dashboardDb.close();
    if (sweepTimer) clearInterval(sweepTimer);
    memory?.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
