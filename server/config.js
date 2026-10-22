// Runtime configuration, read once from the environment.
// Every knob the server has lives here so the README's env table has one source.

/** @param {string|undefined} v */
const flag = (v) => v === '1' || v === 'true';

/** @param {string|undefined} v @param {number} fallback */
const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 2100;

/**
 * @typedef {object} Config
 * @property {number} port
 * @property {string} toolSecret       shared secret the voice agent sends in X-Concierge-Secret
 * @property {object} qloo
 * @property {string} qloo.baseUrl
 * @property {string} qloo.apiKey
 * @property {boolean} qloo.mock
 * @property {number} qloo.timeoutMs
 * @property {number} qloo.retries
 * @property {number} qloo.rateLimitBackoffMs  sleep before the single retry after an HTTP 429
 * @property {object} ticketmaster
 * @property {string} ticketmaster.baseUrl
 * @property {string} ticketmaster.apiKey
 * @property {boolean} ticketmaster.mock
 * @property {number} ticketmaster.timeoutMs
 * @property {object} cache
 * @property {string} cache.path
 * @property {boolean} cache.only       serve cached responses only, never call upstream
 * @property {boolean} cache.freeze     CACHE_FREEZE=1: cache.only under the dark-period name; /health says 'frozen'
 * @property {import('./lib/twilio.js').SmsConfig} sms
 * @property {string} sessionsPath     SQLite file for the session log
 * @property {string} defaultTimezone  IANA zone used to compute "tonight" / "this weekend"
 */

/** @param {NodeJS.ProcessEnv} [env] @returns {Config} */
export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8787),
    toolSecret: env.CONCIERGE_TOOL_SECRET ?? '',
    qloo: {
      baseUrl: env.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com',
      apiKey: env.QLOO_API_KEY ?? '',
      mock: flag(env.QLOO_MOCK),
      timeoutMs: int(env.QLOO_TIMEOUT_MS, 4500),
      retries: int(env.QLOO_RETRIES, 2),
      // 2100 ms: the pace (one call per 2.1 s) at which 101 consecutive live calls drew no
      // second 429 after the first one (W1-B). Kept short because a caller is on the line.
      rateLimitBackoffMs: int(env.QLOO_429_BACKOFF_MS, DEFAULT_RATE_LIMIT_BACKOFF_MS),
    },
    ticketmaster: {
      baseUrl: env.TICKETMASTER_BASE_URL ?? 'https://app.ticketmaster.com/discovery/v2',
      apiKey: env.TICKETMASTER_API_KEY ?? '',
      mock: flag(env.TICKETMASTER_MOCK),
      timeoutMs: int(env.TICKETMASTER_TIMEOUT_MS, 4000),
    },
    cache: {
      path: env.CACHE_PATH ?? new URL('./data/cache.sqlite', import.meta.url).pathname,
      only: flag(env.CACHE_ONLY) || flag(env.CACHE_FREEZE),
      freeze: flag(env.CACHE_FREEZE),
    },
    sms: {
      mock: flag(env.SMS_MOCK),
      accountSid: env.TWILIO_ACCOUNT_SID ?? '',
      apiKeySid: env.TWILIO_API_KEY_SID ?? '',
      apiKeySecret: env.TWILIO_API_KEY_SECRET ?? '',
      authToken: env.TWILIO_AUTH_TOKEN ?? '',
      from: env.SMS_FROM_NUMBER ?? '',
      timeoutMs: int(env.SMS_TIMEOUT_MS, 8000),
    },
    sessionsPath: env.SESSIONS_PATH ?? new URL('./data/sessions.sqlite', import.meta.url).pathname,
    defaultTimezone: env.DEFAULT_TIMEZONE ?? 'America/New_York',
  };
}
