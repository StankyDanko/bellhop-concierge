// Structured, one-line JSON logs. Every upstream call is logged (endpoint + params,
// never credentials) so the request trail behind each answer is visible in the console.

/** @typedef {(event: Record<string, unknown>) => void} Logger */

/** @type {Logger} */
export const jsonLogger = (event) => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`);
};

/** @type {Logger} */
export const silentLogger = () => {};

const SECRET_PARAM = /^(api[_-]?key|apikey|key|token|secret)$/i;

/**
 * Copy of a param map that is safe to log: credential-shaped keys are redacted.
 * @param {Record<string, string>} params
 */
export function redactParams(params) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = SECRET_PARAM.test(k) ? '[redacted]' : v;
  return out;
}
