// What counts as "a thing to do" for recommend_nearby kind "activity".
//
// Qloo files every business under the same place type, so an interest-driven place query for
// "things to do" in a small town can return a grocery store or a pest-control office. The
// kind's restaurant exclusion (recommend-nearby.js scopeParams) does not touch those, so the
// tool checks each place's own tags here.
//
// The rule uses Qloo's own place tags (urn:tag:genre:place:<leaf> and urn:tag:category:place:<leaf>):
//   1. A place with any DENIED leaf (lodging, grocery, pharmacy, bank, auto, pest control, a
//      clinic, a church, an office) is out, whatever else it carries. Hotels carry
//      "tourist_attraction" and "event_venue" too, so the deny check goes first.
//   2. Otherwise a place with an ALLOWED leaf (a museum, a park, live music, a theater, a
//      brewery, a bowling alley, a stadium, a garden) is in.
//   3. Otherwise a place tagged only with the generic tourist_attraction or event_venue is in.
//   4. Anything else is out. An unknown kind of place is not offered as a night out.
//
// Measured live 2026-10-25 (take 50, an artist-only signal, restaurants excluded) in Atlanta,
// Savannah, Macon, Asheville, Nashville and Dublin GA: the leaves below are the entertainment,
// leisure, nightlife, arts and outdoors families seen there. Dublin GA returned twelve places,
// eleven of them hotels and motels plus a Kroger and an Orkin, so for that town the honest
// answer is an empty list.

const leafOf = (tagId) => {
  const m = /^urn:tag:(?:genre|category):place:(.+)$/.exec(String(tagId));
  return m ? m[1] : null;
};

/** Leaves (the part after genre:place: or category:place:, ":" turned into "_") that rule a place out. */
export const DENIED = /(^|_)(hotel|motel|inn|lodge|lodging|hostel|rv_park|campground|mobile_home_park|vacation_home_rental_agency|grocery|supermarket|pharmacy|drugstore|bank|credit_union|atm|insurance|pest_control|auto|car_dealer|car_repair|car_wash|tire|gas_station|fuel|convenience_store|propane_supplier|hospital|emergency|clinic|doctor|dentist|school|day_care|church|temple|mosque|synagogue|utility|electric|plumb|contractor|real_estate|storage|office|city_hall|courthouse|post_office|laundromat|funeral|cemetery|liquor_store|animal_hospital|veterinar|rehabilitation|tattoo|body_piercing|personal_care|wedding_service|fraternal_organization|conference_center|convention_center)(_|$)/;

/** Leaves that are plainly something to do on a night out. */
export const ALLOWED = new Set([
  'museum', 'art_museum', 'history_museum', 'heritage_museum', 'historical_place_museum', 'modern_art_museum', 'science_museum',
  'rail_museum', 'sculpture_museum', 'art_gallery', 'art_center', 'planetarium', 'observatory', 'exhibit', 'zoo', 'aquarium',
  'park', 'state_park', 'memorial_park', 'dog_park', 'garden', 'botanical_garden', 'scenic_spot', 'observation_deck', 'picnic_ground',
  'swimming_lake', 'lake', 'historical_landmark', 'historical_place', 'bridge', 'cycling_park', 'recreation_center',
  'live_music_venue', 'concert_hall', 'rock_music_club', 'amphitheater', 'opera_house', 'performing_arts_theater', 'comedy_club',
  'movie_theater', 'night_club', 'club', 'bar', 'pub', 'brewery', 'winery', 'distillery', 'cocktail_bar', 'sports_bar', 'lounge',
  'bowling_alley', 'amusement_park', 'amusement_center', 'video_arcade', 'adventure_sports_center', 'aerial_sports_center',
  'disc_golf_course', 'golf_course', 'miniature_golf_course', 'stadium', 'arena', 'baseball', 'baseball_field', 'baseball_club', 'sports_club',
  'sports_complex', 'skating_rink', 'tour_operator', 'boat_tour_agency', 'sightseeing_tour_agency', 'bicycle_rental_service',
  'horseback_riding_service', 'record_store', 'book_store', 'used_book_store', 'farmers_market', 'flea_market', 'market',
  'library', 'public_library',
]);

/** The generic leaves that count only when nothing else about the place rules it out. */
const GENERIC = new Set(['tourist_attraction', 'event_venue']);

/**
 * Whether a place is something to do. Reads the place's own tags; no network.
 * @param {{ tags?: Array<{ tag_id: string }> }} e
 */
export function isActivityPlace(e) {
  const leaves = (e.tags ?? []).map((t) => leafOf(t.tag_id)).filter(Boolean).map((l) => l.replace(/:/g, '_'));
  if (leaves.some((l) => DENIED.test(l))) return false;
  if (leaves.some((l) => ALLOWED.has(l))) return true;
  return leaves.some((l) => GENERIC.has(l));
}
