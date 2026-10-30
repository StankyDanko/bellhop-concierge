# Where the numbers come from

House rule: a number that wasn't measured doesn't ship. Every number in the README, in `docs/`,
and on the landing page is listed here with how it was taken and when. Two kinds:

- **Repo commands.** Anyone can run them. Most need nothing; the live ones need a Qloo key in
  `server/.env` and spend quota.
- **Live experiments.** Paced scripts kept outside the repository, because what they read back
  is Qloo response data. Each row gives the request shape (names only, placeholder values) so
  anyone with a key can repeat it. Every one ran on 2026-10-22, against the hackathon API,
  around the demo inn's point in Savannah, GA, with a 3 mile radius and a minimum rating of 4
  unless the row says otherwise. Three test profiles: an artist with a cuisine and a mood; an
  artist with two moods; a film director with a cuisine and a mood.

## Facts of the code

These change only with a commit, and the command shows the current value.

| Number | Where it's said | Command |
|---|---|---|
| Text at most 480 characters | README, ARCHITECTURE, TESTING | `grep -n "MAX_CHARS =" server/lib/sms.js` |
| Twelve texts per number per hour | README, PRIVACY | `grep -n "SENDS_PER_HOUR =" server/tools/send-sms.js` |
| Panels dark below five calls | README, ARCHITECTURE, PRIVACY | `grep -n "SESSION_GATE =" server/api/routes.js` |
| Free-text taste capped at 80 characters | PRIVACY | `grep -n "MAX_FREE_TEXT =" server/lib/pii-guard.js` |
| At most eight taste ids per place call | LEARNED | `grep -n "TASTE_MAX =" server/lib/validate.js` |
| Eleven tools | README | `curl -s localhost:8787/health` lists them under `tools` (nine in `TOOLS`, plus `forget_guest` and `remember_guest` in `MEMORY_TOOLS`, server/app.js); `ls server/tools/` shows eleven tool files plus the shared `places.js` and `counterfactual.js`; server/test/tool-count-docs.test.js holds the docs to it |
| Ten texts per call | privacy page (dashboard/src/legal-content.js) | `grep -n "TEXTS_PER_CALL\|claimCall" server/tools/send-sms.js`; enforced when the call carries its session id |
| Twelve locked guardrails | README | `/usr/bin/node -e "import('./server/api/guardrails.js').then(m=>console.log(m.LOCKED_RULES.length))"` |
| Eleven builder questions | README | `grep -c "ask: '" dashboard/src/pages/Builder.jsx` prints 12: the website start, then eleven questions |
| Calls a day by trust level: test 20, suggest 100, live 300 | README, the dashboard's line chip | `grep -n "daily_limit" compiler/compile.js` (`TRUST_LIMITS`; the public line and both demos are at trust level `live`: 300 a day, 3 at once); the chip labels are `grep -n "calls a day" dashboard/src/pages/Property.jsx` |
| Twenty battery callers, two two-call sequences, twenty-four criteria | README, TESTING | `/usr/bin/node -e "const s=require('./server/battery/scenarios.json');console.log(s.scenarios.length, s.sequences.length)"`; `grep -c "{ id: 'C" server/battery/criteria.js` |
| Rain reorder at 50 percent or more, judged at 7 pm inn time | README, server README | `grep -n "RAIN_THRESHOLD_PCT =\|TARGET_HOUR =" server/lib/weather.js` |
| Forecast cached one hour per inn; 1.5 s timeout | server README | `grep -n "weather" server/lib/cache.js`; `grep -n "WEATHER_TIMEOUT_MS" server/config.js` |
| Similar-artist shows: three weeks ahead, 100 miles out (from Savannah, Charleston and Jacksonville are in range), five lookups at once | README, server README | `grep -n "TASTE_DAYS =\|TASTE_RADIUS_MILES =\|TASTE_CONCURRENCY =" server/tools/events-by-taste.js` |
| Geocoding answers cached 30 days; 2 s timeout | server README | `grep -n "geocode" server/lib/cache.js`; `grep -n "GEOCODE_TIMEOUT_MS" server/config.js` |
| A bare city name is taken without a question at a million people or more | README, server README | `grep -n "WELL_KNOWN_POPULATION =" server/lib/geocode.js` |
| Road line cities shown only at five calls or more | server README | `grep -n "calls >= SESSION_GATE" server/api/routes.js` |
| Tool budget 2.5 s, chain 6 s | TESTING | `grep -n "BUDGET_MS =" server/battery/criteria.js` |

## On the landing page

Every word on the landing lives in `dashboard/src/content/landing.js`; the scripted call lives in
`dashboard/src/content/call-scene.js`. The script is a written example with fictional places, so
its times and minutes ("a salsa band at nine", "six minutes away") are scene-setting, not claims.

| Number | Where it's said | Command or source |
|---|---|---|
| 13 Qloo capabilities | proof strip, and the list under it | the `CAPABILITIES` list in `dashboard/src/content/landing.js`, each entry found in the code by `grep -rn -e "ENDPOINTS\." -e "filter.parents.types" -e "'filter.tags'" -e "filter.results.entities" -e "feature.explainability" -e "popularNearby" -e "heatmap.dimensions" -e "output.heatmap.boundary" -e "urn:demographics" -e "urn:tag'" server/lib server/tools server/api`. Memory's `filter.exclude.entities` is not counted: it runs only with `GUEST_MEMORY_SECRET` set. `npm run verify:landing` holds the strip's number to the list's length |
| 12 of 12 test callers got a different list than the no-taste baseline | proof strip | the battery row under "Repo commands, live" below: `npm run battery -- --live --port <port> --cap 60`, 2026-10-22, criterion C6 |
| 158 ms median Qloo insights answer, over 47 live calls | proof strip | the latency row under "Repo commands, live" below: `npm run prewarm -- --apply --cap 120`, 2026-10-22 |
| Qloo, Ticketmaster, and Texts "live" chips | proof strip | not a number: read from `/api/health-summary` (`tools.qloo`, `tools.ticketmaster`, `tools.sms`) at page load; a chip shows only when the server says `live` |
| Three inns, three voices | property tiles | `ls personas/` lists harper, marisol, and maybelle (plus road, the public line); Casa Coralina is `config/examples/miami-rental.json`, the other two tiles are marked Example |
| At most 480 characters in the text | the scripted text | `grep -n "MAX_CHARS =" server/lib/sms.js`; the scripted text follows the real shape (`SENDER_TAG`, picks, `PAGE_LEAD`, `FOOTER`) |

## Any-city coverage (live, 2026-10-22)

Measured with `/usr/bin/node server/scripts/battery.js --live --coverage --port <free port> --cap 150 --pace-ms 2000 --out <dir outside the repo>`, started 2026-10-23 02:05 UTC (about 10 pm Eastern on 2026-10-22), Qloo and Ticketmaster live, texts mocked: five cities, eight callers each, 40 plays, 0 skipped, 71 live Qloo requests, 0 Qloo 429. Counts only.

### Picks returned per scenario

| City | solo-artist-cuisine | director-cuisine | family-kids | budget-easy | tonight-events | film-request | three-things | artist-shows |
|---|---|---|---|---|---|---|---|---|
| New York, NY | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| Austin, TX | 3 | 3 | 0 | 3 | 3 | 3 | 3 | 3 |
| Denver, CO | 3 | 3 | 1 | 3 | 3 | 3 | 3 | 3 |
| Nashville, TN | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| Boise, ID | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |

### Per city

| City | placed | picks | cuisine hits | similar-artist shows | events found | cross picks | empty answers | clarify |
|---|---|---|---|---|---|---|---|---|
| New York, NY | 8 of 8 | 24 | 20 of 21 | 0 | 3 | 3 | 0 | 0 |
| Austin, TX | 8 of 8 | 21 | 18 of 18 | 0 | 3 | 3 | 1 | 0 |
| Denver, CO | 8 of 8 | 22 | 18 of 19 | 0 | 5 | 3 | 0 | 0 |
| Nashville, TN | 8 of 8 | 24 | 19 of 21 | 0 | 3 | 3 | 0 | 0 |
| Boise, ID | 8 of 8 | 24 | 16 of 21 | 0 | 3 | 3 | 0 | 0 |

Counts only. "placed": place answers that came back for the named city. Cuisine hits: picks whose reason names the guest cuisine, of the picks in scenarios with a stated cuisine.

Notes: geocoding made 95 lookups, 5 live (one per city) and 90 from the cache. Ticketmaster answered one HTTP 429 on `/events.json` (its own limit; the battery stops only on a Qloo 429). The one empty answer is family-kids in Austin (no place left after the kids filter). tonight-events was empty in four of five cities because the run started near 10 pm Eastern. No city had a similar-artist show in range. The run sent the city beside the demo inn's coordinates; the harness now sends the road line's shape (the city alone), and the server replaces the coordinates either way.

## Repo commands, live

| Number | Where it's said | Command and date |
|---|---|---|
| events_nearby with an artist, live Qloo and live Ticketmaster: 9.1 s cold with the five lookups one at a time; 5.8 s cold with them in parallel (about 3.1 s of it the uncached Qloo similar-artists call); 1.7 and 2.6 s in parallel with that Qloo answer cached, as prewarm leaves it. The cached case is the speed bar: prewarm covers the demo and battery artists | server README | before: the artist-shows caller of `npm run battery -- --live --only artist-shows,tonight-events,weekend-events --cap 40 --pace-ms 2000` on 2750945 with Ticketmaster live, 2026-10-22; after: the same command on this commit, then a script that warms the similar-artists call and times one events_nearby for two artists, 2026-10-22 |
| Shows by taste from the demo inn, five touring artists tried (Morgan Wallen, Luke Combs, Taylor Swift, Zach Bryan, Chris Stapleton): all five resolve (the first three as Qloo persons, now accepted as the named act) and each returns 5 similar artists, but 0 of the 25 has a show within 100 miles and three weeks. A check of one set with no location filter found 6 shows anywhere in those three weeks, none in Georgia, South Carolina, or Florida. None fired, so the artist-shows caller keeps its artist | TESTING | a paced script (2 s, at most 20 Qloo calls; 10 used) calling resolve_taste then events_nearby with `artist` against live Qloo and live Ticketmaster from `server/.env`, 2026-10-22; the no-location check is the same attraction ids on Ticketmaster `/events.json` with only the dates |
| The New York shows probe: one popular artist, five similar artists from Qloo; one of them had six shows in the next 21 days across four states, none within 100 miles of the New York point (the nearest about 189 miles). The query shape found what it should have; verdict: the calendar, not the code | README | a paced live probe script kept with the private campaign notes (`nyc-probe.mjs "<artist>" 1`, 16 calls in all: 4 Qloo, 12 Ticketmaster, no 429), 2026-10-22 |
| The guest's list moved away from the no-taste list for 12 of 12 callers run, 3 held back by the call cap | README, QLOO | `npm run battery -- --live --port <port> --cap 60`, 2026-10-22, the `verdict` of each contrast in `raw.jsonl` (criterion C6). An earlier full run the same day, before the cap, gave 15 of 15 |
| Ten of thirteen guessed shapes matched, one differed and was fixed, two not probed | LEARNED | `npm run probe:qloo`, 2026-10-22, read against the table in [`QLOO-NOTES.md`](../QLOO-NOTES.md) |
| Latency medians: search 129 ms (17 calls), tags 143 ms (7), insights 158 ms (47, worst 1612 ms) | QLOO | `npm run prewarm -- --apply --cap 120 --out <file outside the repo>`, 2026-10-22, paced one call per 2 s |
| "Thia food" resolves to the same tag as "thai food"; `sort_by=affinity` leaves the order unchanged | QLOO | the step-4 curls in [`QLOO-NOTES.md`](../QLOO-NOTES.md#key-day-runbook), 2026-10-22 |
| Dropping the second named taste changed the picks for 14 of 19 callers run (4 warns, 1 not exercised) | TESTING | `npm run battery -- --live --port <port> --cap 150 --pace-ms 2000`, 2026-10-22, all 15 callers and both two-call sequences, criterion C5 in `scorecard.md`. Offline it is all warns: the fixtures cannot model it |
| Mood tags left the same five places in the same order | QLOO | `resolve_taste` then `recommend_nearby` on a local `npm run live`, with and without the mood tags, 2026-10-22 |

## Live experiments

| Number | Where it's said | Request shape |
|---|---|---|
| Cuisine as a signal: 0 of 5 top picks carried it, on both profiles with a cuisine. As `filter.tags`: 3 of 3 and 5 of 5 | QLOO, LEARNED | `/v2/insights` place call with `signal.interests.tags=<CUISINE_GENRE_TAG>`, then the same with `filter.tags=<CUISINE_GENRE_TAG>`; count picks whose own `tags` list carries the tag |
| 9 of 9 cuisines found a restaurant genre tag in the first ten | QLOO | `/v2/tags?filter.query=<bare cuisine word>&filter.parents.types=urn:entity:place&take=10`, nine cuisine words |
| Dish tags as filters: zero places at 3 and 8 miles | QLOO | `/v2/insights` place call with `filter.tags=<DISH_TAG>` |
| Tag attribution: 0 times across 18 lists, 90 results | README, QLOO, LEARNED | six signal variants (baseline, tags only, tags only at the highest weight, one tag, diversify, union) on three profiles; look for any `tag_id` in each result's explainability |
| Unscoped tag search: first hit not a place tag for 2 of 6 words; scoped: 6 of 6 | QLOO, LEARNED | `/v2/tags?filter.query=<word>&take=3`, with and without `filter.parents.types=urn:entity:place`, six everyday words |
| Per-person spread 0.005 to 0.027; old rule 27 of 27 "both"; ranks differ at 8 or 9 of 9; rank rule 6 both, 11 guest, 10 plus-one | QLOO, LEARNED | `/v2/insights` with `filter.results.entities=<9 SHORTLIST IDS>&take=9`, once per person, three pairs |
| No-taste top five shared 1, 0, 0 places with the taste top five; mean popularity 1.0 vs 0.70 to 0.72 | QLOO | the place call with every `signal.*` removed, against the signaled one, three profiles |
| `take` prefix-stable, 18 of 18 | QLOO | `take` 3, 10, 20 at radius 1, 3, 8 miles, two profiles; compare top three |
| Repeat requests: 0 of 5 moved | QLOO | identical baselines sent twice, two profiles |
| `bias.trends=high` replaced 5 of 5, on 3 of 3 profiles | QLOO | baseline plus `bias.trends=<off,high,very_high>` |
| Town as a signal: about 13 s; town as a filter: 10 of 10 within 6 miles | QLOO, LEARNED | `signal.location.query=<TOWN>` vs `filter.location.query=<TOWN>`; distance of each result from the inn |
| Resy filter: 0 of 10 shared with the baseline | QLOO | baseline plus `filter.external.exists=resy` |
| Diversify by city: 12 results across 6 towns | QLOO | 25 mile radius plus `diversify.by=properties.geocode.city&diversify.take=3` |
| Named areas: median about 2 s | QLOO | heatmap plus `output.heatmap.boundary=urn:entity:locality` |
| Lean list: 15 tags, all distinct, 9 kinds | QLOO | `/v2/insights?filter.type=urn:tag` with the sample fingerprint, `take=15` |
| Coverage: single digits per cuisine near the demo inn (7 and 4) vs the 100-result cap in a large metro | QLOO | place call with `filter.tags=<CUISINE_GENRE_TAG>`, 3 miles, two pages, demo point vs a large metro point |
| Rate limits: a 429 after about 60 calls in 6 minutes; 248 calls in about 2.5 minutes with none | QLOO | two experiment runs on the same key; counts of calls and 429s |
