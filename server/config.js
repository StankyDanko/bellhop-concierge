// Runtime configuration, read once from the environment.
// Every knob the server has lives here so the README's env table has one source.

/** @param {string|undefined} v */
const flag = (v) => v === '1' || v === 'true';

/** @param {string|undefined} v @param {number} fallback */
const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

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
 * @property {object} ticketmaster
 * @property {string} ticketmaster.baseUrl
 * @property {string} ticketmaster.apiKey
 * @property {boolean} ticketmaster.mock
 * @property {number} ticketmaster.timeoutMs
 * @property {object} cache
 * @property {string} cache.path
 * @property {boolean} cache.only       serve cached responses only, never call upstream
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
    },
    ticketmaster: {
      baseUrl: env.TICKETMASTER_BASE_URL ?? 'https://app.ticketmaster.com/discovery/v2',
      apiKey: env.TICKETMASTER_API_KEY ?? '',
      mock: flag(env.TICKETMASTER_MOCK),
      timeoutMs: int(env.TICKETMASTER_TIMEOUT_MS, 4000),
    },
    cache: {
      path: env.CACHE_PATH ?? new URL('./data/cache.sqlite', import.meta.url).pathname,
      only: flag(env.CACHE_ONLY),
    },
    defaultTimezone: env.DEFAULT_TIMEZONE ?? 'America/New_York',
  };
}
