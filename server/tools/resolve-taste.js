// resolve_taste: what the guest said -> Qloo entities and tags.
//
// "Sturgill Simpson" resolves through /search to an artist entity. Category-shaped
// mentions ("thai food", "jazz bars") resolve through /v2/tags to a taste tag,
// because they describe a kind of thing rather than one thing.

import { arr } from '../lib/validate.js';
import { InputError } from '../lib/errors.js';

/** Words that mark a mention as a category (tag) rather than a named entity. */
const CATEGORY_WORDS = /\b(food|cuisine|music|movies?|films?|restaurants?|bars?|places?|spots?|dining|vibes?|shows?|books?|podcasts?|style|scene)\b/i;
const ENTITY_THRESHOLD = 0.6;

const tokens = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Dice coefficient over word tokens: 1 = same words, 0 = nothing shared. */
export function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

/** "A", "A and B", "A, B, and C" */
export function spokenList(items) {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

const sentenceCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {any} body  { mentions: string[] }
 * @param {{ qloo: import('../lib/qloo.js').QlooClient }} ctx
 */
export async function resolveTaste(body, { qloo }) {
  const mentions = arr(body?.mentions, 'mentions', { min: 1, max: 6 }).map((m, i) => {
    if (typeof m !== 'string' || !m.trim() || m.length > 80) throw new InputError(`mentions[${i}] must be 1-80 characters`);
    return m.trim();
  });

  /** @type {import('../lib/upstream.js').CallRecord[]} */
  const calls = [];

  const resolveOne = async (mention) => {
    const looksLikeCategory = CATEGORY_WORDS.test(mention);
    let best = null;

    if (!looksLikeCategory) {
      const { entities, call } = await qloo.search({ query: mention, take: 3 });
      calls.push(call);
      // Prefer the closest name; ties keep Qloo's own ranking.
      for (const e of entities) {
        const score = similarity(mention, e.name);
        if (!best || score > best.score) best = { e, score };
      }
      if (best && best.score >= ENTITY_THRESHOLD) {
        return { mention, kind: 'entity', id: best.e.entity_id, entity_id: best.e.entity_id, tag_id: null,
          name: best.e.name, type: best.e.type, confidence: round2(best.score) };
      }
    }

    const { tags, call } = await qloo.tags({ query: mention, take: 3 });
    calls.push(call);
    if (tags.length) {
      const t = tags[0];
      return { mention, kind: 'tag', id: t.tag_id, entity_id: null, tag_id: t.tag_id,
        name: sentenceCase(mention), type: 'tag', confidence: round2(Math.max(0.5, similarity(mention, t.name))) };
    }
    if (best) {
      // Weak name match and no tag: keep it, flagged low-confidence for the agent to confirm.
      return { mention, kind: 'entity', id: best.e.entity_id, entity_id: best.e.entity_id, tag_id: null,
        name: best.e.name, type: best.e.type, confidence: round2(best.score) };
    }
    return null;
  };

  const results = await Promise.all(mentions.map(resolveOne));
  const resolved = results.filter(Boolean);
  const unresolved = mentions.filter((_, i) => !results[i]);

  return {
    status: resolved.length ? 'ok' : 'empty',
    resolved,
    unresolved,
    echo_line: spokenList(resolved.map((r) => r.name)),
    calls,
  };
}
