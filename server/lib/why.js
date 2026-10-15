// The "why" trace: for each recommendation, which of the guest's own tastes drove it.
//
// Qloo returns per-result explainability when `feature.explainability=true`
// (documented as `query.explainability`). Its exact inner shape was not published
// in the docs we built from, so the walker below accepts any nesting and collects
// every object that names an input entity or tag id alongside a numeric score.
// If the live shape differs, adjust `collectDrivers` only.

/**
 * @typedef {object} Driver
 * @property {string} id      entity id or tag URN from the guest's input
 * @property {number|null} score
 */

/**
 * Walk an explainability payload and collect { id, score } pairs.
 * @param {unknown} node @returns {Driver[]}
 */
export function collectDrivers(node) {
  /** @type {Driver[]} */
  const out = [];
  const visit = (n, depth) => {
    if (depth > 6 || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const item of n) visit(item, depth + 1);
      return;
    }
    const rec = /** @type {Record<string, any>} */ (n);
    const id = rec.entity_id ?? rec.tag_id ?? rec.id;
    if (typeof id === 'string') {
      const s = rec.score ?? rec.weight ?? rec.affinity ?? rec.value;
      out.push({ id, score: typeof s === 'number' ? s : null });
    }
    for (const v of Object.values(rec)) if (typeof v === 'object') visit(v, depth + 1);
  };
  visit(node, 0);
  return out;
}

/**
 * @typedef {object} WhyTrace
 * @property {string} why                 one short spoken/texted reason
 * @property {Array<{ id: string, name: string, score: number|null }>} drivers  input tastes, strongest first
 * @property {'explainability'|'affinity'} basis
 *   'explainability' = Qloo named the drivers; 'affinity' = Qloo ranked it for the
 *   combined signal but did not attribute it (the reason says so honestly).
 */

/** "A", "A and B" */
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * Build the why trace for one result.
 * @param {{ explainability: unknown, affinity?: number|null }} entity
 * @param {Array<{ id: string, name: string }>} signals  what the guest said, resolved
 * @returns {WhyTrace}
 */
export function buildWhy(entity, signals) {
  const nameOf = new Map(signals.map((s) => [s.id, s.name]));
  /** @type {Map<string, number|null>} best score per input id */
  const best = new Map();
  for (const d of collectDrivers(entity.explainability)) {
    if (!nameOf.has(d.id)) continue; // ignore ids that are not the guest's own signals
    const prev = best.get(d.id);
    if (prev === undefined || (d.score ?? -1) > (prev ?? -1)) best.set(d.id, d.score);
  }

  if (best.size === 0) {
    return {
      why: signals.length ? 'Strong match for your overall taste' : 'Highly rated nearby',
      drivers: [],
      basis: 'affinity',
    };
  }

  const drivers = [...best.entries()]
    .map(([id, score]) => ({ id, name: /** @type {string} */ (nameOf.get(id)), score }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    why: `Fans of ${joinNames(drivers.slice(0, 2).map((d) => d.name))} love it`,
    drivers,
    basis: 'explainability',
  };
}
