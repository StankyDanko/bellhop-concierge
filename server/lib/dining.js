// What counts as "somewhere to eat" for recommend_nearby kind "dining".
//
// Qloo's restaurant filter is a ranking hint, not a gate: measured live 2026-10-25 (Austin and
// Macon, an actor as the only signal, filter.tags set to the restaurant parent), the list held
// a live music venue, a saloon and a Walmart next to the restaurants. Qloo also files the bare
// parent "restaurant" and a "restaurant:bar" child under music venues, so neither counts as
// evidence of food. The tool checks each place's own tags here, the way lib/activity.js does.
//
// The rule reads Qloo's own place tags and the offerings it attaches:
//   1. A place with a lodging leaf is out, whatever else it carries. So is a grocery, a
//      convenience store, or a gas station, even with a deli counter, unless its own category
//      is restaurant. Another DENIED leaf
//      (a bank, an office, the rest of lib/activity.js DENIED) rules it out unless it is
//      plainly a restaurant, because a bike shop that is also a cafe is still a cafe.
//   2. A STRONG food leaf puts it in: the place's own category "restaurant", a restaurant
//      child other than a bar or club (restaurant:pizza, restaurant:coffee_shop), any
//      *_restaurant, a cafe, a diner, a bistro. The bare genre "restaurant" is not evidence:
//      Qloo files it under music venues too.
//   3. A WEAK food leaf (bakery, donut shop, sandwich shop) puts it in unless the place is also
//      tagged as a store: a superstore with a bakery counter is still a superstore.
//   4. Otherwise it is in only if it says it serves food: the offering "food", "food at bar" or
//      "happy hour food". A bar or pub that names a pub-food cuisine is in too, but a music
//      venue, event venue or club needs the offering: a stage with a hot dog cart is a stage.
//   5. Anything else is out. A venue with no food tag is not offered for dinner (it can still
//      be offered as something to do).

import { DENIED } from './activity.js';

const leafOf = (tagId) => {
  const m = /^urn:tag:(?:genre|category):place:(.+)$/.exec(String(tagId));
  return m ? m[1] : null;
};

/** Restaurant children that are really bars and clubs (Qloo files music venues under them) or counters a store can carry (a superstore's bakery). */
const BAR_CHILD = /^restaurant_(bar|live_music_bar|night_club|club|lounge|cocktail_bar|sports_bar|pub|event_venue|live_music_venue|bakery|dessert|desserts|ice_cream_shop|donut_shop|sandwich_shop|juice_bar|snack_bar|juice_shop|smoothie_shop|frozen_yogurt|frozen_yogurt_shop|candy_store|bubble_tea_shop)$/;
/** Qloo files a juice bar under organic, vegan or gluten free "restaurant": a diet label, not a meal. */
const DIET_LABEL = /^(?:restaurant_)?(?:organic|gluten_free|vegan|vegetarian|health_food|raw_food|healthy|natural_food)(?:_restaurant)?$/;
/** Leaves that say the place is somewhere to eat. */
const STRONG = /^(restaurant_.+|.+_restaurant|cafe|coffee_shop|espresso_bar|tea_house|diner|bistro|brasserie|deli|delicatessen|bar_grill|gastropub|brewpub|food_truck|food_court|steakhouse|taqueria|buffet|pizza.*|barbecue.*|bbq.*)$/;
const WEAK = /^(?:restaurant_)?(bakery|dessert|desserts|donut_shop|ice_cream_shop|dessert_shop|sandwich_shop|juice_bar|snack_bar|juice_shop|smoothie_shop|frozen_yogurt|frozen_yogurt_shop|candy_store|bubble_tea_shop)$/;
/** Counters that are somewhere to snack, never somewhere to have a meal: left out of dining unless the guest asked for one. */
const TREAT_SHOP = /^(?:restaurant_)?(juice_bar|juice_shop|smoothie_shop|dessert|desserts|dessert_shop|ice_cream_shop|frozen_yogurt_shop|donut_shop|snack_bar|candy_store|bubble_tea_shop)$/;
/** Leaves that rule a place out even when it also serves food. */
const LODGING = /(^|_)(hotel|motel|inn|lodge|lodging|hostel|rv_park|campground)(_|$)/;
/**
 * Leaves of a shop that sells food without serving a meal. A grocery with a deli counter is still
 * a grocery, so these rule a place out unless its own category is restaurant.
 */
const GROCERY = /(^|_)(supermarket|grocery|grocer|grocery_store|convenience_store|gas_station|market_grocery)(_|$)/;
/** Leaves that are retail. */
const RETAIL = /(^|_)(store|supermarket|mall|superstore|warehouse_club)(_|$)|^shopping$/;
/** Leaves of a venue, where a cuisine tag alone is not enough. */
const VENUE = /(^|_)(live_music_venue|event_venue|night_club|club|concert_hall|amphitheater|stadium|arena|theater)(_|$)/;

const FOOD_OFFERING = /^urn:tag:offerings:place:(?:food|food_at_bar|happy_hour_food)$/;
const PUB_CUISINE = /^urn:tag:cuisine:qloo:(?:pub_food|pub_fare|pub_grub|bar_food|bar_fare)$/;

/**
 * Whether a place serves food. Reads the place's own tags; no network.
 * @param {{ tags?: Array<{ tag_id: string }> }} e
 * @param {{ treats?: boolean }} [opts] true when the guest asked for a dessert, a juice, or a snack
 */
export function isDiningPlace(e, { treats = false } = {}) {
  const tags = (e.tags ?? []).map((t) => String(t.tag_id));
  const leaves = tags.map(leafOf).filter(Boolean).map((l) => l.replace(/:/g, '_'));
  if (leaves.some((l) => LODGING.test(l))) return false;
  if (leaves.some((l) => GROCERY.test(l)) && !tags.includes('urn:tag:category:place:restaurant')) return false;
  // A juice bar or a frozen yogurt counter is a snack, not dinner, unless the guest asked for one.
  if (!treats && leaves.some((l) => TREAT_SHOP.test(l)) && !leaves.some((l) => STRONG.test(l) && !BAR_CHILD.test(l) && !DIET_LABEL.test(l))) return false;
  const strong = tags.includes('urn:tag:category:place:restaurant') || leaves.some((l) => STRONG.test(l) && !BAR_CHILD.test(l));
  if (strong) return true;
  if (leaves.some((l) => DENIED.test(l))) return false;
  if (leaves.some((l) => WEAK.test(l)) && !leaves.some((l) => RETAIL.test(l))) return true;
  if (tags.some((t) => FOOD_OFFERING.test(t))) return true;
  return !leaves.some((l) => VENUE.test(l)) && tags.some((t) => PUB_CUISINE.test(t));
}
