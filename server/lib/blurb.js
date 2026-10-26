// The few words that describe a pick in the text: "rooftop cocktail bar, Midtown".
//
// Built only from the place's own Qloo data: its primary genre (or cuisine), one standout word
// from its feel tags, and its neighborhood. Never the guest's tastes, never why it was ranked.
// Returns null when the place says nothing usable, and the text then carries the name and the
// link alone.

export const BLURB_MAX = 48;

/** Feel words that say something about the place. Matched against the tag's last segment. */
const FEEL = new Set([
  'rooftop', 'speakeasy', 'waterfront', 'patio', 'historic', 'romantic', 'cozy', 'intimate', 'lively', 'quirky', 'upscale',
  'trendy', 'laid_back', 'dive_bar_vibe', 'family_friendly', 'artsy', 'scenic', 'quiet', 'old_school',
]);
const FEEL_TAG = /^urn:tag:(?:ambience|setting|view|decor):(?:qloo|place):(.+)$/;
const CUISINE_TAG = /^urn:tag:cuisine:qloo:(.+)$/;
const RESTAURANT_TAG = /^urn:tag:genre:place:restaurant(?::(.+))?$/;

/** A restaurant leaf that already names a kind of venue rather than a cuisine. */
const VENUE_TYPE = /(bar|cafe|diner|pub|bistro|bakery|grill|brewery|tavern|steakhouse|house|shop|lounge|eatery|buffet|deli|truck|stand|joint|restaurant)$/;

const words = (s) => String(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * @param {{ genre?: string|null, neighborhood?: string|null, tags?: Array<{ tag_id: string, name?: string }> }} e
 * @returns {string|null}
 */
export function placeBlurb(e) {
  const tags = e.tags ?? [];
  const cuisine = tags.map((t) => CUISINE_TAG.exec(t.tag_id)?.[1]).find(Boolean);
  const restaurantLeaf = tags.map((t) => RESTAURANT_TAG.exec(t.tag_id)).find(Boolean);
  let kind = e.genre ? words(e.genre) : null;
  if (!kind && restaurantLeaf?.[1]) {
    const leaf = words(restaurantLeaf[1]);
    kind = VENUE_TYPE.test(leaf) ? leaf : `${leaf} restaurant`;
  }
  // A plain "restaurant" says more with its cuisine: "thai restaurant".
  if ((!kind || kind === 'restaurant') && cuisine && !/^(american|americana|prepared_foods)$/.test(cuisine)) kind = `${words(cuisine)} restaurant`;
  if (!kind && restaurantLeaf) kind = 'restaurant';
  const feel = tags.map((t) => FEEL_TAG.exec(t.tag_id)?.[1]).find((leaf) => leaf && FEEL.has(leaf));
  const hood = e.neighborhood ? String(e.neighborhood).trim() : '';
  if (!kind && !hood) return null;
  const head = kind ? `${feel && !kind.includes(words(feel)) ? `${words(feel)} ` : ''}${kind}` : '';
  const out = [head, hood].filter(Boolean).join(', ');
  return out.length <= BLURB_MAX ? out : (head.length <= BLURB_MAX ? head : null);
}

const KIND_WORDS = { movie: 'film', tv_show: 'TV show', podcast: 'podcast', book: 'book', artist: 'music', place: 'place' };

/**
 * A non-place pick: "film, 2014", "podcast".
 * @param {{ type?: string, year?: number|null }} e
 */
export function kindBlurb(e) {
  const kind = KIND_WORDS[e.type];
  if (!kind) return null;
  return e.year ? `${kind}, ${e.year}` : kind;
}
