// resolve_taste: what the guest said -> Qloo entities and tags.
//
// "Sturgill Simpson" resolves through /search to an artist entity. Category-shaped
// mentions ("thai food", "jazz bars") resolve through /v2/tags to a taste tag,
// because they describe a kind of thing rather than one thing.
//
// A name with a kind word after it ("Wes Anderson films", "Radiohead the band") is a name,
// not a category. The trailing kind word is stripped and the name is searched on its own,
// the way a guest means it. The kind word still counts: a match is kept only when its type
// fits ("films" takes a movie or a person, "music" an artist or a person), so "jazz music"
// cannot become a movie called Jazz. Anything that does not fit falls through to tags.

import { arr } from '../lib/validate.js';
import { InputError } from '../lib/errors.js';

/** Words that mark a mention as a category (tag) rather than a named entity. */
const CATEGORY_WORDS = /\b(food|cuisine|music|movies?|films?|restaurants?|bars?|places?|spots?|dining|vibes?|shows?|books?|podcasts?|style|scene)\b/i;
const ENTITY_THRESHOLD = 0.6;

/** Kind words a guest puts after a name, each with the entity types that name may be. */
const TRAILING_KINDS = [
  { re: /\s+(?:films?|movies?|pictures)$/i, types: ['movie', 'person', 'tv_show'] },
  { re: /\s+(?:the\s+band|band|music|songs?|records?|albums?)$/i, types: ['artist', 'person'] },
];

/**
 * "Wes Anderson films" -> { core: 'Wes Anderson', types: [...] }. Null when nothing trails
 * the name, or when what is left is itself a category ("jazz bar music").
 * @param {string} mention
 */
export function nameCore(mention) {
  for (const { re, types } of TRAILING_KINDS) {
    if (!re.test(mention)) continue;
    const core = mention.replace(re, '').replace(/['’]s$/i, '').replace(/[\s,'’]+$/, '').trim();
    if (!core || CATEGORY_WORDS.test(core)) return null;
    return { core, types };
  }
  return null;
}

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

/** Most things the plus-one can contribute. The beat asks for one; two allows a volunteer. */
export const MAX_COMPANION_MENTIONS = 2;

/** @param {unknown} v @param {string} name @param {number} min @param {number} max */
function mentionList(v, name, min, max) {
  return arr(v, name, { min, max }).map((m, i) => {
    if (typeof m !== 'string' || !m.trim() || m.length > 80) throw new InputError(`${name}[${i}] must be 1-80 characters`);
    return m.trim();
  });
}

/**
 * @param {any} body  { mentions: string[], companion_mentions?: string[] }
 *   companion_mentions: what the guest's plus-one loves, kept in a parallel list so the
 *   agent never has to tag items one by one. They resolve exactly like mentions and come
 *   back in companion_resolved, ready to pass to recommend_nearby as companion_taste.
 * @param {{ qloo: import('../lib/qloo.js').QlooClient }} ctx
 */
export async function resolveTaste(body, { qloo }) {
  const mentions = mentionList(body?.mentions, 'mentions', 1, 6);
  const companionMentions = body?.companion_mentions === undefined || body?.companion_mentions === null
    ? [] : mentionList(body.companion_mentions, 'companion_mentions', 0, MAX_COMPANION_MENTIONS);

  /** @type {import('../lib/upstream.js').CallRecord[]} */
  const calls = [];

  const resolveOne = async (mention) => {
    const named = nameCore(mention);
    if (named) {
      const { entities, call } = await qloo.search({ query: named.core, take: 3 });
      calls.push(call);
      let hit = null;
      for (const e of entities) {
        if (!named.types.includes(e.type)) continue;
        const score = similarity(named.core, e.name);
        if (!hit || score > hit.score) hit = { e, score };
      }
      if (hit && hit.score >= ENTITY_THRESHOLD) {
        return { mention, kind: 'entity', id: hit.e.entity_id, entity_id: hit.e.entity_id, tag_id: null,
          name: hit.e.name, type: hit.e.type, confidence: round2(hit.score) };
      }
    }

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

  const [results, companionResults] = await Promise.all([
    Promise.all(mentions.map(resolveOne)),
    Promise.all(companionMentions.map(resolveOne)),
  ]);
  const resolved = results.filter(Boolean);
  const unresolved = mentions.filter((_, i) => !results[i]);

  /** @type {Record<string, unknown>} */
  const companion = {};
  if (companionMentions.length) {
    const companionResolved = companionResults.filter(Boolean).map((r) => ({ ...r, who: 'companion' }));
    companion.companion_resolved = companionResolved;
    companion.companion_unresolved = companionMentions.filter((_, i) => !companionResults[i]);
    companion.companion_echo_line = spokenList(companionResolved.map((r) => r.name));
  }

  return {
    status: resolved.length || companion.companion_resolved?.length ? 'ok' : 'empty',
    resolved,
    unresolved,
    echo_line: spokenList(resolved.map((r) => r.name)),
    ...companion,
    calls,
  };
}
