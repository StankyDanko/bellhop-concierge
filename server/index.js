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
import { SessionStore } from './lib/sessions.js';
import { createSmsSender } from './lib/twilio.js';
import { openDashboardDb } from './api/db.js';
import { dashboardEnv } from './api/index.js';

const config = loadConfig();
if (!config.toolSecret) {
  console.error('CONCIERGE_TOOL_SECRET is not set; refusing to start (tool routes would be unauthenticated).');
  process.exit(1);
}

const needsCache = !(config.qloo.mock && config.ticketmaster.mock);
const cache = needsCache ? new ResponseCache({ path: config.cache.path, only: config.cache.only }) : null;
const logger = jsonLogger;

const sessions = new SessionStore({ path: config.sessionsPath, hashKey: config.toolSecret });
const sms = createSmsSender({ config: config.sms, logger });
// Host configs live in the same SQLite file as the session log (seeds the demo inn on first run).
const dashboardDb = openDashboardDb({ path: process.env.DASHBOARD_DB_PATH || config.sessionsPath });

let app;
try {
  app = createApp({
    secret: config.toolSecret,
    qloo: createQlooClient({ config: config.qloo, cache, logger }),
    ticketmaster: createTicketmasterClient({ config: config.ticketmaster, cache, logger }),
    timezone: config.defaultTimezone,
    logger,
    sms,
    sessions,
    dashboard: { db: dashboardDb, env: dashboardEnv() },
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
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
