# Qloo key-day notes

Written before the hackathon key existed, so the day it arrives is a checklist and not a
scramble. Every Qloo call in this repo was built from the docs at
[docs.qloo.com/reference](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide).
On 2026-10-22 it met the live host; the Observed column says how each reading held up. This page says which parts are a careful reading,
how we will find out, and where the fix goes if the reading was wrong.

Two facts from the docs shape everything below:

- **Unknown parameters are silently ignored.** The guide's symptom is a 200 with an empty list,
  and an ignored filter can just as well return results it never filtered. A wrong spelling
  doesn't fail, it just stops working. So a check here is never "did it return 200", it is
  "did the parameter change the answer".
- **Every Qloo call goes through one file,** `server/lib/qloo.js`, and every outbound parameter
  passes the allowlist in `server/lib/pii-guard.js` first. A fix is a line in a known place.

## What is a careful reading of the docs, not a live response

The probe is `npm run probe:qloo` (`server/scripts/probe-qloo.js`). Its sections are named in
quotes below.

| Call | The shape we chose | Doc page or reason | How the probe checks it | If it differs, change | Observed |
|---|---|---|---|---|---|
| Explainability inner shape | `feature.explainability=true` on every insights call; we read `query.explainability` and walk it for any object with `entity_id`, `tag_id`, or `id` next to `score`, `weight`, `affinity`, or `value` | insights-api-deep-dive documents the flag and `query.explainability`, not the fields inside it | "insights: places near a point" prints the raw `first_query` and `drivers_found`. Empty drivers with a non-empty explainability block means the field names are wrong | `server/lib/why.js` `collectDrivers`. Until then the reason honestly falls back to "Strong match for your overall taste" | Matches. The block is keyed by the signal param name and lists entity ids with a score; `collectDrivers` finds them and the round trip named its driver on every pick. Only entity signals are attributed: tag signals never appear in it, so a pick driven only by tags keeps the overall-taste reason |
| `filter.location` | WKT `POINT(lng lat)`, longitude first, with `filter.location.radius` in meters | parameter-overview lists lat,lon, WKT, or a locality id; `signal.location` is documented WKT longitude first | Same section: the first result's `normalized.location` should sit within the radius of 32.079, -81.095. Results from anywhere else mean the filter was ignored | `server/lib/qloo.js` `toWktPoint`, one line, to `${lat},${lng}` | Matches. Longitude-first WKT is honored: results sit well inside the radius and each carries a distance in meters |
| Per-person scoring | `filter.results.entities` set to the shortlist ids, `take` equal to the shortlist length, once per person | insights-api-deep-dive lists `filter.results.entities`; `filter.entities` is the fallback spelling | "companion scoring" tries both spellings and prints `all_in_shortlist` and the affinities for each. The right one returns only shortlist ids, with affinities | `server/tools/recommend-nearby.js` `PER_PERSON_FILTER` | Matches. `filter.results.entities` returned only shortlist ids, every one with an affinity, highest first. `filter.entities` behaves the same. `PER_PERSON_FILTER` stays |
| The unsignaled insights call | the place request with every `signal.*`, `sort_by`, and `take` removed, then `take=5`. Filters stay: type, location, radius, price, rating | The guide lists a 400, "at least one valid signal or filter is required". We send filters, so we expect a 200 | "compare: callers vs town" makes this call first and prints `town_places`. A `FAILED: bad_request` there is the 400 | `server/lib/qloo.js` `popularNearby`. Until then `server/tools/counterfactual.js` returns no counterfactual and the dashboard hides that line | Matches. A 200 with five places, no 400. These results carry a distance but no affinity |
| `urn:heatmap` | `filter.type=urn:heatmap` with `filter.location`, a radius, and the fingerprint as `signal.interests.*` | heatmaps-use-case (its example uses `filter.location.query`, not a point) | "heatmap" prints the result keys, the first raw cell, and what `compactHeatmap` made of it | `server/tools/area-insights.js` `compactHeatmap`, and the heatmap params in the same file | Matches. Each cell has latitude, longitude, and geohash under `location` and affinity and popularity under `query`; `compactHeatmap` reads them |
| `urn:demographics` | `filter.type=urn:demographics` with the fingerprint as `signal.interests.*` | demographics-use-case shows it on staging; whether the hackathon API host has it is not stated | "demographics" prints the result keys and `compactDemographics` | `server/tools/area-insights.js` `compactDemographics`. A 403 or empty answer leaves that panel degraded on its own | Matches. Available on the hackathon host. Age and gender leanings under `query`; `compactDemographics` reads them |
| `/v2/analysis/compare` with places | `a.signal.interests.entities` = the fingerprint's entity ids, `b.signal.interests.entities` = the top 5 unsignaled places near the inn | analysis-compare documents interest groups; its examples use media and brands, never places | "compare" (two artist groups) and "compare: callers vs town" (places in group b) print the result keys and `compactCompare` | `server/tools/area-insights.js` `compactCompare`; the panel's call is in `server/api/routes.js`. If places are refused, that panel shows as delayed | Differs, fixed. Places are accepted in group b. Results hold `tags`, `a`, `b`, `matchEntities`: `a` and `b` list each group's tags with a string count, and `tags` repeats a linking tag once per entity pairing with a single score and no per-group difference. `compactCompare` now builds shares and a difference from `a` and `b` |
| `/v2/tags` typo tolerance | `filter.query`, `feature.typo_tolerance=true`, `take=3`. A multi-word vibe phrase ("spicy and loud") is never sent whole: one request per mapped word (`spicy`, `lively`), and never to `/search` | search-tags | "tags" prints normalized tags for "thai food". It does not send a typo, so run the curl in step 4 below | `server/lib/qloo.js` `tags` and `normalizeTags` | Matches. Ids come back under `results.tags`; "thai food" resolves to a thai food tag first. Step 4: the typo "thia food" resolves to the same tag first |
| `sort_by=affinity` | sent on every `recommend_nearby` place call | insights-api-deep-dive lists `sort_by` (affinity, distance, rating, quality) for places | Not in the probe. Step 4 below: the same call with and without it; affinities should come back highest first | the `params` block in `server/tools/recommend-nearby.js` | Matches, no visible effect. Step 4: the same five places in the same order with and without it, because the default order is already affinity highest first. Kept |
| `take` limits | at most 20 on insights (three times the picks asked for), 3 on search and tags, 5 on the unsignaled call, 1 to 10 on cross-domain | insights `take` is 1 to 50 (default 20); tags `take` up to 50 | Each section prints how many came back; no section should return more than it asked for | the `take` lines in `server/tools/recommend-nearby.js` and `server/lib/qloo.js` | Matches. No section returned more than it asked for |
| Tag URN forms | we never build a tag id. We send back exactly the `tag_id` that `/v2/tags` returned, and the guard accepts only `urn:tag:...` | doc examples: `urn:tag:genre:place:restaurant:italian`, `urn:tag:genre:media:comedy` | "tags" prints each `tag_id`. Each should start with `urn:tag:` | `server/lib/qloo.js` `normalizeTags` (which field holds the id) | Matches. Every `tag_id` starts with `urn:tag:`; many carry a `qloo` namespace segment, which the guard accepts |
| Rate limits | none published. Bounded retries: 2 extra attempts on a 429, a 5xx gateway error, or a timeout; a 4.5 second timeout | The guide says limits are "set high enough to support typical hackathon projects" and asks for bounded retries | Not probed. Watch the server log for `rate_limited` the first live day | `QLOO_RETRIES` and `QLOO_TIMEOUT_MS` in `server/.env` | Not probed. No `rate_limited` in the server log across one local round trip. Still unverified |
| Cache TTL per endpoint | `/search` and `/v2/tags` 30 days, `/v2/insights` 1 day, `/v2/analysis/compare` 7 days, anything else 1 day. Ticketmaster 1 hour | The guide allows private server-side caching with no time limit; insights stay short because hours and closures change | Not probed. The cache is private and gitignored | `server/lib/cache.js` `TTL_SECONDS` | Not probed; a policy, not a shape. Still unverified |

## Key-day runbook

Probe run 2026-10-22 against the hackathon host; verdicts below.

In this order. Fill in the Observed column that day, with what was seen, not what was hoped.

| # | Step | Command or action | What it prints, and where it goes | Observed |
|---|---|---|---|---|
| 1 | Put the key in place | Add `QLOO_API_KEY` to `server/.env` (gitignored, refused by the pre-commit hook). Set `QLOO_MOCK=0`. Leave `QLOO_BASE_URL` unset: it defaults to `https://hackathon.api.qloo.com` | nothing | Done. `/health` on a local live run reads Qloo live |
| 2 | Probe | `npm run probe:qloo > /tmp/probe-qloo.txt` | One section per capability, thirteen calls plus any retries. Shapes, first items, and what our normalizers extracted. Stdout only; the probe writes nothing to disk. Redirect it outside the repo | Done. Every section answered; no section failed or came back empty |
| 3 | Read it against the table | For each row above, read its probe section and write the verdict in Observed | | Done. Ten match, one differed (compare), two not probed |
| 4 | The checks the probe skips | The two curls below this table | Raw JSON on the terminal, then gone | Done. `sort_by=affinity` leaves the order unchanged; typo tolerance resolves "thia food" to the thai food tag |
| 5 | Fix what disagreed | One commit per fix, each in the file the table names, with a test that encodes the live shape using hand-written fake values | | Done. One fix: `compactCompare`, with a test on made-up values |
| 6 | Tests | `npm test` | all green | Green, offline, with the live key exported in the shell |
| 7 | Go live | `git status` clean, then `set -a; . server/.env; set +a` and `/usr/bin/node deploy.mjs --sync-env`. If step 5 changed code, a full `/usr/bin/node deploy.mjs` first | `--sync-env` pushes `server/.env` and recreates the container; a full deploy ships the working tree | |
| 8 | Confirm | `curl -s https://concierge.southernsky.cloud/health` | `"qloo": "live"` | |
| 9 | The live badge | Open the landing page and `/property/demo` | The Qloo trace reads "Qloo, live" (or "Qloo, cached"), never "Mock fixtures" | |
| 10 | Call the line | One real call to the demo number | A plan text whose reasons name the caller's own tastes | |
| 11 | The sessions floor | Open `/property/demo` | Guest-taste panels stay dark until five real calls are in. Test calls don't count, and nothing is seeded to get there | |

Step 4, with the key from `server/.env` in the shell and `<ARTIST_ID>` from the probe's search section:

```bash
B=https://hackathon.api.qloo.com
P="filter.type=urn:entity:place&signal.interests.entities=<ARTIST_ID>&filter.location=POINT(-81.095%2032.079)&filter.location.radius=5000&take=5"
curl -s -H "X-Api-Key: $QLOO_API_KEY" "$B/v2/insights?$P"                    # without sort_by
curl -s -H "X-Api-Key: $QLOO_API_KEY" "$B/v2/insights?$P&sort_by=affinity"    # with it
curl -s -H "X-Api-Key: $QLOO_API_KEY" "$B/v2/tags?filter.query=thia%20food&feature.typo_tolerance=true&take=3"
```

**The never-commit rule.** Qloo's hackathon terms forbid storing their responses in a public
repo. Probe output, curl output, and the live cache (`server/data/`) never enter git: not as a
fixture, not in a test, not pasted into an issue or a commit message. A test that needs the
live shape gets the shape with hand-written fake values, `fx-` ids, and fictional places, the
way every file in `server/fixtures/` already is.

## What will NOT change on key day

- **The privacy allowlist.** `server/lib/pii-guard.js` checks every outbound parameter by name
  and value, and the tests prove a refused request never reaches the network. If the live API
  wants a parameter we don't send yet, it is added by name, with a test. No wildcard.
- **The signed picks.** A place's favors and an event's day label reach the text only with a
  `pick_token` that verifies (`server/lib/pick-token.js`). Live data doesn't loosen that.
- **The five-call floor.** `SESSION_GATE = 5` in `server/api/routes.js`. Guest-taste panels stay
  dark below it, live or mock.
- **The texts.** `compose_itinerary` builds the plan text from verified tool fields only. The
  length, footer, link, and segment rules in `server/lib/sms.js` don't care where the picks came
  from.
