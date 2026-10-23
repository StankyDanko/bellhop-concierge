// Open-Meteo forecast client and the rain reorder rule.
//
// Weather never changes WHICH places Qloo picked. It can only (1) move outdoor-leaning picks
// after indoor ones when rain is likely at the evening hour, and (2) add one short clause to
// what the concierge says. Everything else about a pick, and the set of picks, is Qloo's.
//
// One forecast call per guest call, no key. It goes through the same choke point as every
// other upstream answer (lib/upstream.js): cached for an hour per inn, served from the cache
// alone when CACHE_FREEZE is set, traced as service "weather". Any failure returns null and
// the picks go out exactly as Qloo ranked them.
//
// Terms: the Open-Meteo free tier is for non-commercial use and needs the attribution line
// WEATHER_ATTRIBUTION. A paid deployment needs their commercial plan (see README).

import { httpTransport } from './transport.js';
import { callUpstream } from './upstream.js';
import { assertNoPii } from './pii-guard.js';

export const FORECAST_ENDPOINT = '/v1/forecast';
export const WEATHER_ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0)';

/**
 * Rain-likely threshold, percent. Open-Meteo's hourly precipitation_probability is the chance
 * of measurable rain in that hour. At 50 or more a rained-out patio is at least as likely as
 * not, which is the point where a careful innkeeper stops sending a guest to sit outside. Lower
 * would reorder on a passing shower; higher would send guests to a wet patio.
 */
export const RAIN_THRESHOLD_PCT = 50;

/** The evening hour a "tonight" plan is judged at, local to the inn. */
export const TARGET_HOUR = 19;

/**
 * A pick is outdoor-leaning when one of ITS OWN Qloo tag names matches this. Nothing is
 * guessed from the place name or the category alone.
 */
export const OUTDOOR_TAG = /\b(patio|outdoor seating|outdoor dining|outdoors?|al fresco|rooftop|roof top|beer garden|biergarten|garden|park|market|farmers market|food truck|waterfront|deck|picnic|trail)s?\b/i;

/** Forecast coordinates are rounded to two decimals (about a kilometre): enough for weather, and one cache row per inn. */
const round2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

/** Local wall-clock parts of `date` in `zone`: { ymd: '2026-10-16', hour: 18 }. */
function localClock(date, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/**
 * The local hour the plan is judged at: 7 pm, or the current hour once 7 pm has begun or
 * passed (and between midnight and 3 am, which is still "tonight", see lib/timewin.js).
 * @returns {{ key: string }} key like "2026-10-16T19:00", the form Open-Meteo's hourly.time uses
 */
export function targetHour(now, zone) {
  const { ymd, hour } = localClock(now, zone);
  const h = hour >= 3 && hour < TARGET_HOUR ? TARGET_HOUR : hour;
  return { key: `${ymd}T${String(h).padStart(2, '0')}:00` };
}

/**
 * Read the target hour out of an Open-Meteo body. Null when the body does not carry that hour
 * (a cached forecast for another day, or an unexpected shape).
 * @returns {{ precip_pct: number, temp_c: number | null, hours: number } | null}
 */
export function readForecast(body, key) {
  const times = body?.hourly?.time;
  const rain = body?.hourly?.precipitation_probability;
  if (!Array.isArray(times) || !Array.isArray(rain)) return null;
  const i = times.indexOf(key);
  const pct = rain[i];
  if (i < 0 || typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const t = body.hourly.temperature_2m?.[i];
  return { precip_pct: pct, temp_c: typeof t === 'number' ? t : null, hours: times.length };
}

/**
 * @param {object} opts
 * @param {{ baseUrl: string, timeoutMs: number }} opts.config
 * @param {import('./cache.js').ResponseCache | null} opts.cache
 * @param {import('./log.js').Logger} opts.logger
 * @param {import('./transport.js').Transport} [opts.transport]  override (tests)
 */
export function createWeatherClient({ config, cache, logger, transport }) {
  const t = transport ?? httpTransport({ service: 'weather', baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
  const upstream = { service: 'weather', transport: t, cache, logger, mock: false, retries: 0 };
  return {
    mode: cache?.only ? 'cache-only' : 'live',
    /**
     * The forecast at the plan's target hour, or null on ANY failure (nothing is thrown).
     * @param {{ lat: number, lng: number, timezone: string, now: Date }} q
     * @returns {Promise<{ precip_pct: number, temp_c: number | null, hours: number, hour: string, call: import('./upstream.js').CallRecord } | null>}
     */
    async forecast({ lat, lng, timezone, now }) {
      try {
        const params = {
          latitude: round2(lat), longitude: round2(lng),
          hourly: 'precipitation_probability,temperature_2m',
          timezone, forecast_days: '1',
        };
        assertNoPii(FORECAST_ENDPOINT, params);
        const { body, call } = await callUpstream(upstream, FORECAST_ENDPOINT, params);
        const { key } = targetHour(now, timezone);
        const read = readForecast(body, key);
        return read ? { ...read, hour: key.slice(11), call } : null;
      } catch {
        return null; // silent: the trace already holds the error code, the guest hears nothing
      }
    },
  };
}

/** @typedef {ReturnType<typeof createWeatherClient>} WeatherClient */

/** True when any of the Qloo entity's own tags reads outdoor. @param {{ tags?: Array<{ name?: string }> }} e */
export const isOutdoorLeaning = (e) => (e.tags ?? []).some((t) => OUTDOOR_TAG.test(String(t?.name ?? '')));

export const RAIN_CLAUSE = 'Rain likely tonight, so the indoor pick goes first.';

/**
 * Stable partition: indoor picks first, outdoor-leaning after, each group in Qloo's order.
 * The same items come back; only their order can change.
 * @template T @param {T[]} items @param {(item: T) => boolean} outdoor
 * @returns {{ items: T[], moved: number }}
 */
export function rainReorder(items, outdoor) {
  const indoor = items.filter((x) => !outdoor(x));
  const out = items.filter(outdoor);
  const next = [...indoor, ...out];
  const moved = next.reduce((n, x, i) => n + (x === items[i] ? 0 : 1), 0);
  return { items: next, moved };
}
