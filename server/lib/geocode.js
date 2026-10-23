// Geocoding: a city a caller names ("Austin, Texas") becomes one set of coordinates.
//
// One lookup against Open-Meteo's free geocoding search (no key). It goes through the same
// choke point as every other upstream answer (lib/upstream.js): cached for 30 days, served
// from the cache alone when CACHE_FREEZE is set, traced as service "geocode". From then on
// every service in the call (Qloo, Ticketmaster, the forecast) is asked about those same
// coordinates, so the three always agree on where "there" is (lib/locality.js does the join).
//
// Only the city part of what the caller said is sent (as `name`); a state they named is
// matched here, against the answers, and never leaves the process. A city name is not
// personal data, but it is free text, so the PII guard still refuses a phone number, an email
// address, or a room number inside it.
//
// Three answers:
//   ok         one US town matched: { label: "Austin, Texas", lat, lng, timezone }
//   ambiguous  the name is in more than one state and none was said: a question to ask
//   unknown    nothing in the US matched: a question to ask
// Neither question names anything the caller did not say, except the state of the biggest
// match, which is offered as a yes-or-no.

import { fixtureTransport, httpTransport } from './transport.js';
import { callUpstream } from './upstream.js';
import { assertNoPii } from './pii-guard.js';
import { InputError } from './errors.js';

export const GEOCODE_ENDPOINT = '/v1/search';
/** How many candidates one lookup asks for: enough to see a name in several states. */
export const GEOCODE_COUNT = 10;
/** Longest locality accepted, before anything is sent. */
export const MAX_LOCALITY = 80;
/**
 * A bare city name (no state) is taken without asking only for a town this big, by the
 * population the geocoder reports. Below it, a name in two states gets a question: a wrong
 * city costs the guest a whole answer, the question costs one breath.
 */
export const WELL_KNOWN_POPULATION = 1_000_000;

/** A namesake abroad at least this big, and this many times the US town, makes a bare name a question. */
export const FOREIGN_NAMESAKE_MIN = 100_000;
export const FOREIGN_NAMESAKE_RATIO = 10;

export const AMBIGUOUS_SAY = (name, state) => `Which ${name}, the one in ${state}?`;
export const UNKNOWN_SAY = "I couldn't place that town, what state is it in?";
export const UNKNOWN_IN_STATE_SAY = (name, state) => `I couldn't find ${name} in ${state}. What's a bigger town nearby?`;
export const NO_GEOCODER_SAY = 'I can only look around the inn right now.';

/** The fifty states plus DC: full name and postal code. */
export const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});

const norm = (s) => String(s ?? '').toLowerCase().replace(/[.']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Full state names, longest first, so "West Virginia" is tried before "Virginia". */
const STATE_NAMES = Object.values(US_STATES).sort((a, b) => b.length - a.length);

/** A state the caller said, as its full name, or null. Accepts "Texas", "TX", "tx", "Tex." is not guessed. */
export function stateName(s) {
  const n = norm(s);
  if (!n) return null;
  const code = n.toUpperCase();
  if (Object.hasOwn(US_STATES, code)) return US_STATES[code];
  return STATE_NAMES.find((name) => norm(name) === n) ?? null;
}

/**
 * Split what the caller said into a city and, if they said one, a state.
 *   "Austin, Texas" | "Austin, TX" | "Austin TX" | "Austin Texas" -> { city: "Austin", state: "Texas" }
 *   "New York"                                                   -> { city: "New York", state: null }
 *   "Paris, France"                                              -> { city: "Paris", state: null, foreign: true }
 * A trailing state word is only taken as a state when a city is left in front of it.
 * @param {unknown} raw
 * @returns {{ city: string, state: string | null, foreign?: boolean }}
 */
export function parseLocality(raw) {
  if (typeof raw !== 'string') throw new InputError('locality must be a city, for example Austin, Texas');
  const text = raw.replace(/\s+/g, ' ').trim().replace(/(?:,\s*|\s+)(?:u\.?s\.?a?\.?|united states(?: of america)?)$/i, '').trim();
  if (!text) throw new InputError('locality must be a city, for example Austin, Texas');
  if (text.length > MAX_LOCALITY) throw new InputError(`locality must be at most ${MAX_LOCALITY} characters`);
  const comma = text.lastIndexOf(',');
  if (comma > 0) {
    const city = text.slice(0, comma).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const tail = text.slice(comma + 1).trim();
    const region = tail.replace(/,/g, ' ').trim();
    const state = stateName(region);
    // "Paris, France": a place after the comma that is not a US state is not guessed at.
    if (city) return region && !state ? { city, state: null, foreign: true } : { city, state };
  }
  const words = text.split(' ');
  if (words.length > 1) {
    const last = words[words.length - 1];
    if (/^[A-Za-z]{2}$/.test(last) && stateName(last)) return { city: words.slice(0, -1).join(' '), state: stateName(last) };
    for (const name of STATE_NAMES) {
      const re = new RegExp(`^(.+)\\s${name.replace(/ /g, '\\s')}$`, 'i');
      const m = re.exec(text);
      if (m && m[1].trim()) return { city: m[1].trim(), state: name };
    }
  }
  return { city: text.replace(/,/g, ' ').trim(), state: null };
}

/** One spelling per city, so "hollow pines" and "Hollow Pines" share a cache row. */
export const cityKey = (city) => city.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * Pick the answer from the geocoder's candidates. Pure, so the rule is tested without a network.
 * @param {any} body  the geocoding search response
 * @param {{ city: string, state: string | null }} asked
 * @returns {{ status: 'ok', label: string, lat: number, lng: number, timezone: string }
 *   | { status: 'ambiguous' | 'unknown', say: string }}
 */
export function chooseLocality(body, { city, state, foreign = false }) {
  if (foreign) return { status: 'unknown', say: UNKNOWN_SAY };
  const list = Array.isArray(body?.results) ? body.results : [];
  const want = norm(city);
  const towns = list.filter((r) => r && r.country_code === 'US' && norm(r.name) === want
    && String(r.feature_code ?? 'PPL').startsWith('PPL')
    && Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && typeof r.timezone === 'string')
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const ok = (r) => ({ status: /** @type {const} */ ('ok'), label: `${r.name}, ${r.admin1 ?? 'United States'}`,
    lat: r.latitude, lng: r.longitude, timezone: r.timezone });
  if (state) {
    const inState = towns.find((r) => r.admin1 === state);
    return inState ? ok(inState) : { status: 'unknown', say: UNKNOWN_IN_STATE_SAY(city, state) };
  }
  if (!towns.length) return { status: 'unknown', say: UNKNOWN_SAY };
  const [top] = towns;
  // The same name abroad, far bigger ("Toronto" said by a caller in Toronto): never a silent pick
  // of the small US town. Asked as the same yes-or-no question.
  const foreignBigger = list.some((r) => r && r.country_code !== 'US' && norm(r.name) === want
    && (r.population ?? 0) >= Math.max(FOREIGN_NAMESAKE_MIN, FOREIGN_NAMESAKE_RATIO * (top.population ?? 0)));
  if (foreignBigger) return { status: 'ambiguous', say: AMBIGUOUS_SAY(top.name, top.admin1 ?? 'the United States') };
  const otherStates = towns.some((r) => r.admin1 !== top.admin1);
  if (!otherStates || (top.population ?? 0) >= WELL_KNOWN_POPULATION) return ok(top);
  return { status: 'ambiguous', say: AMBIGUOUS_SAY(top.name, top.admin1 ?? 'the United States') };
}

/**
 * @param {object} opts
 * @param {{ baseUrl: string, timeoutMs: number }} opts.config
 * @param {import('./cache.js').ResponseCache | null} opts.cache
 * @param {import('./log.js').Logger} opts.logger
 * @param {boolean} [opts.mock]  answer from server/fixtures/geocode.search.json (fictional towns)
 * @param {import('./transport.js').Transport} [opts.transport]  override (tests)
 */
export function createGeocoder({ config, cache, logger, mock = false, transport }) {
  const t = transport ?? (mock
    ? fixtureTransport({ service: 'geocode', dir: new URL('../fixtures/', import.meta.url), files: { [GEOCODE_ENDPOINT]: 'geocode.search' } })
    : httpTransport({ service: 'geocode', baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }));
  const upstream = { service: 'geocode', transport: t, cache, logger, mock: Boolean(mock && !transport), retries: 1 };
  return {
    mode: mock ? 'mock' : cache?.only ? 'cache-only' : 'live',
    /**
     * Throws InputError for a malformed locality, PiiViolation for one shaped like personal
     * data, and UpstreamError when the geocoder cannot answer.
     * @param {unknown} locality
     */
    async locate(locality) {
      const asked = parseLocality(locality);
      // The free-text rule runs on everything the caller said, before anything about it is
      // decided: "Room 214, Hollow Pines" is refused, not read as a town in a far-off region.
      assertNoPii(GEOCODE_ENDPOINT, { name: String(locality).replace(/,/g, ' ').replace(/\s+/g, ' ').trim() });
      // A place outside the US is not looked up at all.
      if (asked.foreign) return { ...chooseLocality(null, asked), call: null };
      const params = { name: cityKey(asked.city), count: String(GEOCODE_COUNT), language: 'en', format: 'json' };
      assertNoPii(GEOCODE_ENDPOINT, params);
      const { body, call } = await callUpstream(upstream, GEOCODE_ENDPOINT, params);
      return { ...chooseLocality(body, asked), call };
    },
  };
}

/** @typedef {ReturnType<typeof createGeocoder>} Geocoder */
