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
//
// A vibe phrase ("spicy and loud", "slow and candlelit") is the guest's answer to a two way
// food choice. It is a mood, not a name, so it never goes to /search. Each taste word in it
// goes to /v2/tags on its own, under the tag words in VIBE_PHRASES, and the trace entry
// records the phrase it came from. Budget words ("splurge", "easy") are not tastes: they come
// back as preferences and are never sent upstream. A phrase holding both sides of one choice
// ("adventurous or familiar") is the question said back, not an answer: nothing resolves and
// nothing is sent, and the phrase comes back as preferences.undecided.
//
// Place-shaped mentions never go to /search either. A food word ("thai food", "sushi",
// "bbq") or a place word ("jazz bars") asks /v2/tags scoped to place tags
// (filter.parents.types=urn:entity:place), because unscoped the same word can come back as a
// music or film genre ("italian food" as a folk music genre) or /search can return an album
// called Sushi. A food mention asks for its bare cuisine word ("thai food" asks "thai") and
// prefers the restaurant genre tag (urn:tag:genre:place:restaurant:...), which
// recommend_nearby sends as a hard filter. Vibe words are always place-scoped too.

import { arr, TASTE_MAX } from '../lib/validate.js';
import { InputError, UpstreamError } from '../lib/errors.js';
import { withTraceNote } from '../lib/upstream.js';
import { isCuisineTag, isMediaGenreTag } from './places.js';

/** Words that mark a mention as a category (tag) rather than a named entity. */
const CATEGORY_WORDS = /\b(food|cuisine|music|movies?|films?|restaurants?|bars?|places?|spots?|dining|vibes?|shows?|books?|podcasts?|style|scene)\b/i;
const ENTITY_THRESHOLD = 0.6;

/** Words that mark a category mention as a place (a tag on places, not on music or films). */
const PLACE_WORDS = /\b(food|cuisine|restaurants?|bars?|places?|spots?|dining|vibes?|eats|joints?|pubs?|cafes?)\b/i;
/** Words that say "food" without naming one, stripped to leave the cuisine word. */
const FOOD_KIND_WORDS = /\b(food|cuisine|restaurants?|places?|spots?|dining|eats|joints?)\b/gi;
const FOOD_MARK = /\b(food|cuisine|restaurants?|dining|eats)\b/i;
const FOOD_KIND_SET = new Set(['food', 'cuisine', 'restaurant', 'restaurants', 'place', 'places', 'spot', 'spots', 'dining', 'eats', 'joint', 'joints']);

/**
 * Cuisine and dish words a guest says on their own ("sushi", "bbq", "thai"). A mention made
 * only of these (and food kind words) is a food mention, never a name to search. Kept to
 * words that are rarely a band or film title on their own.
 */
export const FOOD_WORDS = Object.freeze(new Set([
  'thai', 'italian', 'mexican', 'chinese', 'japanese', 'korean', 'vietnamese', 'indian', 'french', 'greek',
  'spanish', 'mediterranean', 'ethiopian', 'peruvian', 'cuban', 'caribbean', 'lebanese', 'turkish', 'german',
  'cajun', 'creole', 'lowcountry', 'tex', 'mex',
  'sushi', 'ramen', 'pho', 'tacos', 'taco', 'pizza', 'burgers', 'burger', 'bbq', 'barbecue', 'barbeque',
  'steakhouse', 'steak', 'seafood', 'oysters', 'oyster', 'tapas', 'dumplings', 'noodles', 'curry',
  'brunch', 'breakfast', 'diner', 'deli', 'bakery', 'vegan', 'vegetarian', 'wings', 'shrimp', 'crab',
  // Dishes, desserts, and drinks. A guest who names no band names food: "I really like spaghetti
  // and my husband likes cheesecake". Asked of /search, those words come back as a business or a
  // place that happens to carry the word in its name, and the reason line then says "fans of" it.
  'spaghetti', 'pasta', 'lasagna', 'lasagne', 'ravioli', 'carbonara', 'risotto', 'gnocchi', 'calzone', 'calzones',
  'cheesecake', 'cheesecakes', 'dessert', 'desserts', 'cupcakes', 'cupcake', 'pie', 'pies', 'pastries', 'pastry',
  'gelato', 'donuts', 'doughnuts', 'cobbler', 'tiramisu', 'cannoli', 'crepes', 'pancakes', 'waffles', 'biscuits',
  'grits', 'burritos', 'burrito', 'nachos', 'enchiladas', 'quesadillas', 'empanadas', 'sandwiches', 'sandwich',
  'salad', 'salads', 'soup', 'chowder', 'gumbo', 'jambalaya', 'crawfish', 'lobster', 'clams', 'mussels', 'scallops',
  'catfish', 'oysters', 'brisket', 'ribs', 'bagels', 'croissants', 'falafel', 'hummus', 'kebabs', 'gyros', 'shawarma',
  'poke', 'bibimbap', 'paella', 'fondue', 'chocolate', 'coffee', 'espresso', 'tea', 'beer', 'wine', 'cocktails',
  'whiskey', 'bourbon', 'margaritas', 'mimosas', 'milkshakes', 'smoothies', 'cider', 'sake',
]));

/**
 * Dishes said in more than one word. Each word on its own is too often a name ("Cream", "Hot
 * Chocolate"), so a phrase counts only whole, and only when it is not said as a title.
 */
export const FOOD_PHRASES = Object.freeze(new Set([
  'ice cream', 'fried chicken', 'hot dogs', 'mac and cheese', 'chicken wings', 'key lime pie', 'apple pie',
  'hot chocolate', 'fish and chips', 'shrimp and grits', 'chicken and waffles', 'craft beer', 'red wine', 'white wine',
  'soul food', 'comfort food', 'street tacos', 'dim sum', 'pad thai', 'crab cakes', 'fish tacos', 'chili dogs',
  'po boy', 'po boys', 'poboy', 'poboys',
]));

/**
 * A proper-noun shape: two or more words each capitalized ("Hot Chocolate", "Cheesecake Factory"),
 * or a leading "the" ("the Black Crowes"). Such a mention is a name to search even when its words
 * are food words. One capitalized word is only sentence case, so "Spaghetti" is still a dish.
 * @param {string} mention
 */
export function properNounShape(mention) {
  const words = String(mention).trim().split(/\s+/).filter(Boolean);
  if (/^the\b/i.test(words[0] ?? '') && words.length > 1) return true;
  const caps = words.filter((w) => /^[A-Z]/.test(w) && !/^(and|or|of|with)$/i.test(w));
  return words.length >= 2 && caps.length === words.filter((w) => !/^(and|or|of|with)$/i.test(w)).length;
}

/** True when the mention is a dish or drink said as a phrase ("ice cream"), not as a title. */
function isFoodPhrase(mention) {
  if (properNounShape(mention)) return false;
  const words = tokens(mention).filter((w) => !FOOD_KIND_SET.has(w));
  if (FOOD_PHRASES.has(words.join(' '))) return true;
  // A food word in front of a dish phrase is still that dish: "shrimp po' boy", "oyster po boy".
  for (let i = 1; i < words.length; i++) {
    if (FOOD_PHRASES.has(words.slice(i).join(' ')) && words.slice(0, i).every((w) => FOOD_WORDS.has(w))) return true;
  }
  return false;
}

/**
 * Genre and mood words for film, television, and books, each with the /v2/tags search words it
 * stands for. A mention made only of these (and kind words such as "show" or "movie") asks for a
 * media genre tag (urn:tag:genre:media:...), never a place tag, never /search.
 */
export const MEDIA_GENRES = Object.freeze({
  horror: 'horror', scary: 'horror', creepy: 'horror', thriller: 'thriller', thrillers: 'thriller', suspense: 'thriller', suspenseful: 'thriller',
  comedy: 'comedy', comedies: 'comedy', funny: 'comedy', sitcom: 'comedy', sitcoms: 'comedy',
  scifi: 'science fiction', drama: 'drama', dramas: 'drama', romance: 'romance', romantic: 'romance', mystery: 'mystery', mysteries: 'mystery',
  fantasy: 'fantasy', crime: 'crime', truecrime: 'true crime', documentary: 'documentary', documentaries: 'documentary', docuseries: 'documentary',
  anime: 'anime', animation: 'animation', animated: 'animation', cartoon: 'animation', cartoons: 'animation', western: 'western', westerns: 'western',
  action: 'action', adventure: 'adventure', war: 'war', noir: 'film noir', historical: 'history',
});
/** Words that say "something to watch or read" without naming a genre. */
const MEDIA_KIND_WORDS = new Set(['show', 'shows', 'series', 'movie', 'movies', 'film', 'films', 'flick', 'flicks', 'tv', 'television', 'book', 'books', 'novel', 'novels', 'stuff', 'type', 'kind', 'of', 'a', 'the', 'some', 'good', 'and', 'or', 'like', 'genre', 'story', 'stories']);

/**
 * The media genres a mention names: "horror thriller show" -> ['horror', 'thriller']. Empty unless
 * every word is a genre word or a kind word and at least one is a genre word, so "horror bar"
 * (a place) and "Wes Anderson films" (a name) are not media genres.
 * @param {string} mention @returns {string[]}
 */
export function mediaGenresOf(mention) {
  const said = String(mention).toLowerCase().replace(/sci[\s-]*fi\b|science[\s-]+fiction/g, 'scifi')
    .replace(/true[\s-]+crime/g, 'truecrime').replace(/rom[\s-]*com\b/g, 'romance comedy');
  const words = tokens(said);
  if (!words.length) return [];
  const genres = [];
  for (const w of words) {
    if (Object.hasOwn(MEDIA_GENRES, w)) { if (!genres.includes(MEDIA_GENRES[w])) genres.push(MEDIA_GENRES[w]); }
    else if (!MEDIA_KIND_WORDS.has(w)) return [];
  }
  return genres;
}

/**
 * How a mention should resolve, from its words alone.
 *   'food'   a cuisine or dish, asked of place tags by its bare cuisine word
 *   'place'  a kind of place ("jazz bars"), asked of place tags as said
 *   null     anything else (names, music or film categories)
 * @param {string} mention
 * @returns {'food'|'place'|null}
 */
export function placeShape(mention) {
  const words = tokens(mention);
  if (!words.length) return null;
  if (FOOD_MARK.test(mention)) return 'food';
  if (isFoodPhrase(mention)) return 'food';
  const foodish = (w) => FOOD_WORDS.has(w) || FOOD_KIND_SET.has(w);
  if (words.every(foodish) && words.some((w) => FOOD_WORDS.has(w))) return 'food';
  return PLACE_WORDS.test(mention) ? 'place' : null;
}

/**
 * Cuisine words asked under another spelling, because the place genre tag a guest means is
 * filed under it. "bbq" finds a genre tag that no place near the demo inn carries, while
 * "barbecue" finds the one barbecue places carry (measured on key day plus one, counts only).
 */
const CUISINE_ALIASES = Object.freeze({ bbq: 'barbecue', barbeque: 'barbecue' });

/** "thai food" -> "thai"; "italian restaurants" -> "italian"; "bbq" -> "barbecue". The mention itself when nothing is left. */
export function cuisineCore(mention) {
  const core = mention.replace(FOOD_KIND_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return CUISINE_ALIASES[core.toLowerCase()] ?? (core || mention.trim());
}

const squash = (s) => tokens(s).join('');

/**
 * How well a tag name matches the word asked: 1 when they are the same letters ("steakhouse"
 * and "Steak house"), else the word overlap. Typo tolerance can put a near miss first ("Tea
 * house" for "steakhouse"), so a cuisine is chosen by this, not by position.
 */
export function nameMatch(query, name) {
  return squash(query) === squash(name) ? 1 : similarity(query, name);
}

/**
 * The tag a food mention resolves to: the restaurant genre tag whose name best matches the
 * cuisine word; if none matches, Qloo's first hit when it is a restaurant genre tag (a
 * misspelling); otherwise the first tag, which is not a cuisine and never becomes a filter.
 * @param {string} query @param {Array<{ tag_id: string, name: string }>} tags
 */
/** Below this name match a resolved cuisine is a signal only, never a hard filter. */
export const CUISINE_FILTER_MIN = 0.5;

export function pickCuisineTag(query, tags) {
  let best = null;
  for (const t of tags) {
    if (!isCuisineTag(t.tag_id)) continue;
    const score = nameMatch(query, t.name);
    if (!best || score > best.score) best = { t, score };
  }
  if (best && best.score >= 0.5) return best;
  return { t: tags[0], score: nameMatch(query, tags[0].name) };
}

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

/**
 * Each taste word a guest uses to answer a food choice, with the /v2/tags search words it
 * stands for, in the order tried. The first word that finds a tag wins; the rest are only
 * asked when it finds nothing. Phrases are built from these words, so "spicy and loud",
 * "loud and fun", and "kind of quiet" all resolve without being listed one by one.
 */
export const VIBE_PHRASES = Object.freeze({
  spicy: ['spicy'],
  loud: ['lively'],
  lively: ['lively'],
  fun: ['fun'],
  slow: ['relaxed'],
  candlelit: ['romantic', 'intimate'],
  quiet: ['quiet'],
  adventurous: ['adventurous'],
  familiar: ['comfort food'],
});

/**
 * The two sides of each food choice the agent offers. A mention holding both sides of one
 * pair repeats the question back, so it is no answer at all.
 */
export const VIBE_OPPOSITES = Object.freeze([
  ['spicy', 'slow'],
  ['loud', 'quiet'],
  ['adventurous', 'familiar'],
  ['candlelit', 'loud'],
  ['lively', 'quiet'],
  ['candlelit', 'lively'],
  ['slow', 'lively'],
  ['fun', 'quiet'],
]);

/**
 * Occasions a guest gives instead of a taste ("came for the game, who just won"), each with the
 * vibe word in VIBE_PHRASES it stands for. An occasion is a mood for the night, so it becomes one
 * vibe signal and a preferences.occasion note. It is never a filter and never said back as a taste.
 * Longer phrases first, so "first date" is read before "date".
 */
export const OCCASION_PHRASES = Object.freeze([
  { re: /\b(first date)\b/, occasion: 'first date', vibe: 'candlelit' },
  { re: /\b(date night|anniversary)\b/, occasion: 'date night', vibe: 'candlelit' },
  { re: /\b(game day|just won|we won|they won|won the game|celebrat(e|es|ing|ion))\b/, occasion: 'celebration', vibe: 'lively' },
  { re: /\b(birthday|bday)\b/, occasion: 'birthday', vibe: 'fun' },
  { re: /\b(after the (show|game|concert))\b/, occasion: 'after the show', vibe: 'lively' },
]);
for (const o of OCCASION_PHRASES) if (!Object.hasOwn(VIBE_PHRASES, o.vibe)) throw new Error(`occasion vibe ${o.vibe} is not a vibe word`);

/**
 * "came for the game, who just won" -> { occasion: 'celebration', vibe: 'lively' }. Null when no
 * occasion phrase is in the mention, and for a food mention ("birthday cake" is still cake).
 * Anniversary reads as date night: the same candlelit mood.
 * @param {string} mention
 * @returns {{ occasion: string, vibe: string } | null}
 */
export function occasionOf(mention) {
  // Apostrophes go before the words are split, so "won't" reads as "wont", never as "won".
  const said = tokens(String(mention).replace(/['’]/g, '')).join(' ');
  if (!said) return null;
  const hit = OCCASION_PHRASES.find((o) => o.re.test(said));
  if (!hit) return null;
  // "The Birthday Massacre": a "the" name with more to it than the occasion phrase is a name.
  const words = said.split(' ');
  const phrase = said.match(hit.re)?.[0] ?? '';
  if (words[0] === 'the' && words.length - 1 > phrase.split(' ').length) return null;
  if (placeShape(mention) === 'food') return null;
  return { occasion: /\banniversary\b/.test(said) ? 'anniversary' : hit.occasion, vibe: hit.vibe };
}

/** Budget words: what the guest wants to spend, never a taste and never sent upstream. */
export const BUDGET_WORDS = Object.freeze({ splurge: 'splurge', easy: 'easy' });

/** Words that join or soften a vibe phrase and carry no taste of their own. */
const VIBE_FILLER = new Set(['and', 'or', 'but', 'good', 'kind', 'of', 'sort', 'a', 'bit', 'little', 'really', 'very', 'pretty', 'more', 'something', 'somewhere', 'nice']);

/**
 * "spicy and loud" -> { tastes: ['spicy', 'loud'], budget: null }. Null unless every word
 * is a vibe word, a budget word, or filler, so "Quiet Riot" and "spicy food" are not vibes.
 * Both budget words at once ("splurge or easy") is no budget at all, and both sides of one
 * food choice ("adventurous or familiar") is no taste at all: tastes comes back empty and
 * undecided is true.
 * @param {string} mention
 * @returns {{ tastes: string[], budget: string|null, undecided: boolean } | null}
 */
export function vibeOf(mention) {
  const words = tokens(mention);
  const tastes = [];
  const budgets = new Set();
  for (const w of words) {
    if (Object.hasOwn(VIBE_PHRASES, w)) { if (!tastes.includes(w)) tastes.push(w); }
    else if (Object.hasOwn(BUDGET_WORDS, w)) budgets.add(BUDGET_WORDS[w]);
    else if (!VIBE_FILLER.has(w)) return null;
  }
  if (!tastes.length && !budgets.size) return null;
  const budget = budgets.size === 1 ? [...budgets][0] : null;
  if (VIBE_OPPOSITES.some(([a, b]) => tastes.includes(a) && tastes.includes(b))) return { tastes: [], budget, undecided: true };
  return { tastes, budget, undecided: false };
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

  /** @type {{ budget?: string, undecided?: string[], occasion?: string }} */
  const preferences = {};
  /** One request per tag word per call, however many phrases use it. */
  const tagAsks = new Map();
  const askTags = (query, phrase) => {
    if (!tagAsks.has(query)) {
      tagAsks.set(query, withTraceNote({ mapped_from: phrase }, () => qloo.tags({ query, take: 3, parentsType: 'place' }))
        .then(({ tags, call }) => { calls.push(call); return tags; }));
    }
    return tagAsks.get(query);
  };

  /** A vibe phrase: each taste word to /v2/tags, never /search. Items carry the guest's words. */
  const resolveVibe = async (mention, vibe, who) => {
    if (vibe.budget && who === 'guest') preferences.budget = vibe.budget;
    if (vibe.undecided && who === 'guest') (preferences.undecided ??= []).push(mention);
    const items = await Promise.all(vibe.tastes.map(async (word) => {
      for (const query of VIBE_PHRASES[word]) {
        const tags = await askTags(query, mention);
        if (tags.length) {
          const t = tags[0];
          return { mention, kind: 'tag', id: t.tag_id, entity_id: null, tag_id: t.tag_id,
            name: sentenceCase(word), type: 'tag', confidence: round2(Math.max(0.5, similarity(query, t.name))) };
        }
      }
      return null;
    }));
    const found = items.filter(Boolean);
    if (found.length) return { items: found, say: mention };
    return vibe.tastes.length ? null : { items: [], say: null };
  };

  /**
   * An occasion: its one vibe word to place-scoped /v2/tags, as a signal only (filter_ok false).
   * Nothing is said back for it (say null), and nothing about it goes upstream but the vibe word.
   */
  const resolveOccasion = async (mention, occ) => {
    if (!preferences.occasion) preferences.occasion = occ.occasion;
    for (const query of VIBE_PHRASES[occ.vibe]) {
      const tags = await askTags(query, mention);
      if (tags.length) {
        const t = tags[0];
        return { items: [{ mention, kind: 'tag', id: t.tag_id, entity_id: null, tag_id: t.tag_id, name: sentenceCase(occ.vibe),
          type: 'tag', confidence: round2(Math.max(0.5, similarity(query, t.name))), occasion: occ.occasion, filter_ok: false }], say: null };
      }
    }
    // No vibe tag came back: the occasion is still noted, and the mention counts as heard.
    return { items: [], say: null };
  };

  /**
   * A film, show, or book genre ("horror thriller show"): each genre word to /v2/tags scoped to
   * movie tags, keeping only a media genre tag (urn:tag:genre:media:...). It is never a place tag
   * and never goes to /search. Items carry domain: 'media' so cross_domain filters by them.
   */
  const resolveMediaGenres = async (mention, genres) => {
    const items = await Promise.all(genres.map(async (genre) => {
      const { tags, call } = await withTraceNote({ mapped_from: mention }, () => qloo.tags({ query: genre, take: 5, parentsType: 'movie' }));
      calls.push(call);
      const t = tags.find((x) => isMediaGenreTag(x.tag_id));
      if (!t) return null;
      return { mention, kind: 'tag', id: t.tag_id, entity_id: null, tag_id: t.tag_id, name: sentenceCase(genre === 'science fiction' ? 'sci-fi' : genre),
        type: 'tag', domain: 'media', confidence: round2(Math.max(0.5, nameMatch(genre, t.name))) };
    }));
    const found = items.filter(Boolean);
    return found.length ? { items: found, say: mention } : null;
  };

  const resolveOne = async (mention, who) => {
    const occ = occasionOf(mention);
    if (occ) return resolveOccasion(mention, occ);
    const vibe = vibeOf(mention);
    if (vibe) return resolveVibe(mention, vibe, who);
    const genres = mediaGenresOf(mention);
    if (genres.length) return resolveMediaGenres(mention, genres);
    const shape = placeShape(mention);
    const one = shape ? await resolvePlaceShaped(mention, shape) : await resolveNamed(mention);
    return one ? { items: [one], say: one.name } : null;
  };

  /**
   * A food or place mention: place-scoped /v2/tags only, never /search. A food mention asks
   * for its cuisine word with room to look past dish and menu tags, and takes the restaurant
   * genre tag when one comes back; otherwise the first place tag.
   */
  const resolvePlaceShaped = async (mention, shape) => {
    const query = shape === 'food' ? cuisineCore(mention) : mention;
    const { tags, call } = await qloo.tags({ query, take: shape === 'food' ? 10 : 3, parentsType: 'place' });
    calls.push(call);
    if (!tags.length) return null;
    const { t, score } = shape === 'food' ? pickCuisineTag(query, tags) : { t: tags[0], score: nameMatch(query, tags[0].name) };
    const confidence = Math.max(0.5, score);
    // A cuisine whose name barely matches the guest's word (a misspelling, or a near miss such
    // as "Tea house" for "steakhouse") stays a signal: filter_ok false keeps it out of the hard
    // cuisine filter, so a weak guess can never decide which places come back.
    const weakCuisine = shape === 'food' && isCuisineTag(t.tag_id) && score < CUISINE_FILTER_MIN;
    return { mention, kind: 'tag', id: t.tag_id, entity_id: null, tag_id: t.tag_id,
      name: sentenceCase(mention), type: 'tag', confidence: round2(confidence), ...(weakCuisine ? { filter_ok: false } : {}) };
  };

  /**
   * The name a resolved entity goes by in a reason line. A place or brand that stands in for the
   * guest's words ("Po Boy Factory" for "shrimp po' boy") is never named: the guest never said
   * it, so the reason would send them asking what it is. The guest's own words are used, and the
   * id still goes to Qloo. A band, film, or show keeps its own name.
   */
  const spokenName = (mention, e, score) =>
    (e.type === 'place' || e.type === 'brand') && score < 0.99 ? sentenceCase(mention) : e.name;

  const resolveNamed = async (mention) => {
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
          name: spokenName(mention, best.e, best.score), type: best.e.type, confidence: round2(best.score) };
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
        name: spokenName(mention, best.e, best.score), type: best.e.type, confidence: round2(best.score) };
    }
    return null;
  };

  // A frozen cache (the key gone dark) may hold some of the guest's words and not others. Each
  // mention is its own lookup, so a miss leaves that one unresolved; only when every lookup
  // missed does the call answer as a cache miss (app.js turns that into a line to say).
  const misses = [];
  const orMiss = (p) => p.catch((err) => {
    if (err instanceof UpstreamError && err.code === 'cache_miss') { misses.push(err); return null; }
    throw err;
  });
  const [results, companionResults] = await Promise.all([
    Promise.all(mentions.map((m) => orMiss(resolveOne(m, 'guest')))),
    Promise.all(companionMentions.map((m) => orMiss(resolveOne(m, 'companion')))),
  ]);
  if (misses.length && ![...results, ...companionResults].some(Boolean)) throw misses[0];
  /**
   * What recommend_nearby can take back. Every named mention keeps its own item, one per
   * mention as before. A vibe phrase expands into one tag per taste word, so a tag already
   * in the list is not added again, and tags past TASTE_MAX are dropped from the end
   * (at most six mentions, so named things always fit).
   */
  const itemsOf = (list) => {
    const seen = new Set();
    const items = list.filter(Boolean).flatMap((r) => r.items)
      .filter((r) => r.kind !== 'tag' || (seen.has(r.id) ? false : seen.add(r.id)));
    let extra = items.length - TASTE_MAX;
    for (let k = items.length - 1; extra > 0 && k >= 0; k -= 1) {
      if (items[k].kind === 'tag') { items.splice(k, 1); extra -= 1; }
    }
    return items;
  };

  /** The say-back: each mention once, in the guest's words for a vibe phrase. */
  const echoOf = (list) => spokenList([...new Set(list.filter(Boolean).map((r) => r.say).filter(Boolean))]);
  const resolved = itemsOf(results);
  const unresolved = mentions.filter((_, i) => !results[i]);

  /** @type {Record<string, unknown>} */
  const companion = {};
  if (companionMentions.length) {
    const companionResolved = itemsOf(companionResults).map((r) => ({ ...r, who: 'companion' }));
    companion.companion_resolved = companionResolved;
    companion.companion_unresolved = companionMentions.filter((_, i) => !companionResults[i]);
    companion.companion_echo_line = echoOf(companionResults);
  }

  return {
    status: resolved.length || companion.companion_resolved?.length || preferences.budget || preferences.occasion ? 'ok' : 'empty',
    resolved,
    unresolved,
    echo_line: echoOf(results),
    ...(preferences.budget || preferences.undecided || preferences.occasion ? { preferences } : {}),
    ...companion,
    calls,
  };
}
