# How we use Qloo, measured

Every Qloo capability this concierge uses: the call, the parameters we send, why, what the live
API did when we checked on 2026-10-22, and what the product does about it. Values in the
examples are placeholders (`<ARTIST_ID>`, `<TAG_ID>`, `<LNG> <LAT>`). No Qloo response data is
in this repository, in any form; the measurements below are words and counts. How each count
was taken: [MEASUREMENTS.md](MEASUREMENTS.md). The shape-by-shape key-day record:
[`QLOO-NOTES.md`](../QLOO-NOTES.md).

All calls are `GET` on the hackathon API with the key in the `X-Api-Key` header, through one
client (`server/lib/qloo.js`), after the allowlist in `server/lib/pii-guard.js`.

## 1. Entity search: a name becomes an id

```
GET /search?query=<the name the guest said>&take=3
```

Used by `resolve_taste` for bands, films, directors, books. Each match keeps a confidence, and
the concierge says the name back so a misheard name gets corrected on the phone. Food, place,
and mood words never go here; they are tags.

**Live:** matched the documented shape. Median 129 ms over 17 paced calls.

## 2. Tag search: a cuisine or a mood becomes a tag

```
GET /v2/tags?filter.query=<word>&feature.typo_tolerance=true&filter.parents.types=urn:entity:place&take=3
```

A cuisine asks its bare word ("thai food" asks "thai") with `take=10`. A mood phrase is never
sent whole: "spicy and loud" becomes one request per mapped word.

**Live:**
- Without `filter.parents.types`, the first hit for 2 of 6 everyday words was not a place tag
  (one came back a media genre, one a music genre). Scoped to places, 6 of 6 were. We scope
  every food, place, and mood word.
- The bare cuisine word, scoped to places, found a restaurant genre tag in the first ten for
  9 of 9 cuisines tried.
- Typo tolerance works ("thia food" resolves to the same tag as "thai food"), but it ranks by
  similarity, so the first result can be a near-spelling of a different thing. We pick the tag
  whose name matches the word, not the first one, and a weak match is used as a signal only.

## 3. Insights near the inn: places ranked for this guest

```
GET /v2/insights?filter.type=urn:entity:place
  &signal.interests.entities=<ARTIST_ID>
  &signal.interests.tags=<MOOD_TAG_ID>
  &filter.tags=<CUISINE_GENRE_TAG_ID>
  &filter.location=POINT(<LNG> <LAT>)&filter.location.radius=<METERS>
  &filter.price_level.max=<1-4>&filter.rating.min=4
  &feature.explainability=true&sort_by=affinity&take=<up to 20>
```

Used by `recommend_nearby`. Longitude comes first in the point, and the live API honors it:
results sit inside the radius and carry a distance.

**Live:**
- **A cuisine is a filter, not a signal.** Sent only as a signal, the cuisine tag was carried by
  0 of 5 top picks on both profiles tried: a guest who said "thai" got no thai place. As a hard
  `filter.tags`, 3 of 3 and 5 of 5 carried it. So a stated cuisine is a requirement, and when
  fewer than three places nearby fit, the filter relaxes once, the response says
  `cuisine_filter: "relaxed"`, and a `say` line tells the agent not to claim the cuisine. A
  cuisine tag whose name only weakly matches the guest's word (under 0.5) comes back with
  `filter_ok: false` and stays a signal, so a near miss can never decide which places return.
- **Mood tags shift affinity but often not the order** when an artist or film is also in the
  signal: the key-day sample returned the same five places in the same order with and without
  them. They stay signals, and the call trace shows they were sent.
- `sort_by=affinity` changed nothing visible: the default order is already affinity first. Kept,
  because it states the intent.
- `take` is prefix-stable: the top three were identical at `take` 3, 10, and 20 at every radius
  tried (18 of 18). Asking for a longer shortlist costs nothing in quality.
- Identical requests return identical lists (0 of 5 moved on repeat), so a change in rank is
  the signal, not noise.
- Latency: median 158 ms over 47 paced insights calls; the worst was 1612 ms.

## 4. Explainability: the reason line

`feature.explainability=true` on every insights call. We read `query.explainability` on each
result: the entity ids that drove it, each with a score.

**Live:**
- Matches the docs for entities. Every live pick on the key-day round trip named its driver.
- **Tags are never attributed.** Across 18 result lists (90 results), a tag id appeared in
  explainability 0 times. A tags-only call comes back with a warning that explainability could
  not be calculated.
- The top-level aggregate block exists: `query.explainability`, keyed by signal parameter, with
  `effect_on_top3_recs` through `effect_on_all_recs`, each listing entity ids with an average
  score.

**What the product does:** the reason names the entities Qloo attributed ("Fans of `<ARTIST>`
love it"). When the pick's own tag list carries the guest's cuisine or mood, it adds "tagged
Thai", which is a fact read from the place, never said as "fans of". When Qloo attributed
nothing: "Strong match for your overall taste." The aggregate block rides along on the
dashboard as `signal_effects`.

## 5. Per-person scoring: the plus-one

```
GET /v2/insights?filter.type=urn:entity:place
  &filter.results.entities=<PLACE_ID_1>,<PLACE_ID_2>,...
  &signal.interests.entities=<ONE_PERSONS_IDS>&take=<shortlist length>
```

Once for the guest, once for the plus-one, over the same shortlist.

**Live:** `filter.results.entities` returns only the shortlist, each with an affinity, highest
first. But each person's affinities sit in a narrow band: the spread across a nine-place
shortlist was 0.005 to 0.027 on three pairs. Our first rule (both above 0.5, within 0.15)
labelled 27 of 27 picks "you'll both like this", which says nothing. Ranks differ even when
scores don't: they disagreed at 8 or 9 of 9 positions.

**What the product does:** the rank rule. A pick is for both when each person ranks it in their
own top half; otherwise it's for whoever ranks it higher. On the same data that gives 6 both,
11 guest, 10 plus-one. When either person's scores are flat across the shortlist, no pick gets
a label at all, rather than a made-up one.

## 6. The no-taste contrast

```
GET /v2/insights?filter.type=urn:entity:place
  &filter.location=POINT(<LNG> <LAT>)&filter.location.radius=<METERS>
  &filter.price_level.max=<1-4>&filter.rating.min=4&take=5
```

The same place call with every `signal.*`, `sort_by`, and the cuisine filter removed. The docs
warn of a 400 without a signal; with filters present it's a 200, ranked by general popularity.
That is the town's popular list: what anyone nearby would be told.

**Live:** on three profiles the guest's top five shared 1, 0, and 0 places with it. The no-taste
top five averaged popularity 1.0; the taste lists averaged 0.70 to 0.72. In the latest live
battery run the guest's list moved away from the town's for every caller run (12 of 12). The top pick alone
can match while the rest of the list doesn't, which is why we compare whole lists.

**What the product does:** two short lists side by side on the dashboard and the landing page,
with how many sit on both. "Your tastes moved the answer: two of your three picks are not among
the five most popular places nearby." When they match: "Here your taste and the town agree."
Never in the text to the guest.

We tried two other baselines and rejected both: capping popularity, and excluding the popular
places from the taste call. Each changes the answer, but neither is "without your tastes".

## 7. Cross-domain affinity

```
GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<ARTIST_ID>&take=3
```

Used by `cross_domain`: a band picks a film, a director picks a book, a film picks a place. The
guest's own inputs are never returned as picks. Each result carries the same reason line and a
signed token.

**Live:** matched; every result came back with an explainability driver on the key-day round
trip.

## 8. The innkeeper's panels

All of these are asked of the **fingerprint**: the ids every caller resolved, pooled per inn,
sent as `signal.interests.entities` and `signal.interests.tags`. They stay dark until five
calls have named a taste.

| Panel | Call | Live |
|---|---|---|
| Where tastes run hottest | `filter.type=urn:heatmap`, point, radius, `heatmap.dimensions=quality` | Cells carry location and affinity. `heatmap.dimensions` is honored; the `output.`-prefixed spelling is silently ignored. |
| Hottest named areas | a second heatmap call with `output.heatmap.boundary=urn:entity:locality` | Returns named localities instead of cells. Can't be combined with dimensions (400), needs a signal (400 without), and was slow (median about 2 s), so it's cached. |
| Who shares these tastes | `filter.type=urn:demographics` | Available on the hackathon API. Age and gender leanings of people who share the tastes, never of a caller. |
| Your callers lean toward | `filter.type=urn:tag` | 15 tags, all distinct, across 9 kinds, short names. Easier to read than raw compare. |
| The town leans toward | `filter.type=urn:tag` with the inn's location and no signal | No guest data at all. |
| Callers vs. town, one quiet line | `GET /v2/analysis/compare` with the fingerprint in group `a` and the town's top places in `b` | Places are accepted in a group. The answer is per-group tag lists with counts, plus a list of linking tags repeated once per pairing; the first reader took the linking list and got duplicates. Fixed to build each tag's share per group from `a` and `b`. `filter.type` and `filter.subtype` are ignored by compare. |

## What we tried and did not ship

| Lever | What it did live | Why not |
|---|---|---|
| `signal.interests.tags.weight` | Moved nothing on one profile, a lot on another, and not in order of the setting | Not a dial a guest's words can drive |
| `signal.interests.entities.weight` | Same: no effect on one profile, top pick replaced on another | Not dependable alone |
| `operator.signal.interests.tags=union` | Unpredictable reorders; `intersection` is the default | Nothing to gain |
| `bias.trends` | `high` replaced all five of the top five on three of three profiles | It overrides the guest's taste |
| `bias.content_based` | A step function: two settings behaved as one, the other two as another | Moves the order without making tags count or attributable |
| A dish tag as `filter.tags` | Zero places at 3 and 8 miles | Dish tags are too narrow; the cuisine's place genre tag works |
| `/v2/trending` | Empty for an artist over the window tried; places are not an accepted type | Trend arrows wait for a window and a type that answer |
| `signal.location.query` (a town name as a signal) | Answered, but took about 13 s | Too slow for a phone call; `filter.location.query` answered fast and put 10 of 10 results within 6 miles of the inn |
| `signal.demographics.*` on place calls | Reorders strongly | We never guess a caller's age or gender; only an innkeeper-chosen audience could be sent |

## What's measured but not shipped yet

- `filter.external.exists=resy` changed the list completely (0 of 10 shared with the baseline):
  an "a table I can book" option for the guest.
- `diversify.by=properties.geocode.city` spread twelve results across six towns: a "worth the
  drive" option.
- `filter.location.query` for an innkeeper who would rather type a town than coordinates.

## Two things worth knowing about the data

- **Small cities are thin.** Around the demo inn, a cuisine filter found single digits of places
  (7 for one cuisine, 4 for another) where a large metro saturated the 100-result cap. The
  relaxed retry exists for exactly this.
- **Rate limits are unpublished.** One burst saw a 429 after about 60 calls in 6 minutes; another
  made 248 calls in about 2.5 minutes with none. The server sleeps once and retries on a 429,
  then serves the cached answer, and every script that spends live calls paces one per two
  seconds and stops on the first 429.
