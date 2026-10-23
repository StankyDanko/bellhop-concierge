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
| Text at most 320 characters | README, ARCHITECTURE, TESTING | `grep -n "MAX_CHARS =" server/lib/sms.js` |
| Three texts per number per hour | README, PRIVACY | `grep -n "SENDS_PER_HOUR =" server/tools/send-sms.js` |
| Panels dark below five calls | README, ARCHITECTURE, PRIVACY | `grep -n "SESSION_GATE =" server/api/routes.js` |
| Free-text taste capped at 80 characters | PRIVACY | `grep -n "MAX_FREE_TEXT =" server/lib/pii-guard.js` |
| At most eight taste ids per place call | LEARNED | `grep -n "TASTE_MAX =" server/lib/validate.js` |
| Nine tools | README | `curl -s localhost:8787/health` lists them under `tools` (eight in `TOOLS` plus `forget_guest` in `MEMORY_TOOLS`, server/app.js); `ls server/tools/` shows nine tool files plus the shared `places.js` and `counterfactual.js`; server/test/tool-count-docs.test.js holds the docs to it |
| One text per call | privacy page (dashboard/src/legal-content.js) | `grep -n "ONE_PER_CALL_SAY\|claimCall" server/tools/send-sms.js`; enforced when the call carries its session id |
| Twelve locked guardrails | README | `/usr/bin/node -e "import('./server/api/guardrails.js').then(m=>console.log(m.LOCKED_RULES.length))"` |
| Eleven builder questions | README | `grep -c "ask: '" dashboard/src/pages/Builder.jsx` prints 12: the website start, then eleven questions |
| Calls a day by trust level: test 20, suggest 100, live 300 | README, the dashboard's line chip | `grep -n "daily_limit" compiler/compile.js` (`TRUST_LIMITS`; the demo inn is at trust level `test`); the chip labels are `grep -n "calls a day" dashboard/src/pages/Property.jsx` |
| Fifteen battery callers, two two-call sequences, seventeen criteria | README, TESTING | `/usr/bin/node -e "const s=require('./server/battery/scenarios.json');console.log(s.scenarios.length, s.sequences.length)"`; `grep -c "{ id: 'C" server/battery/criteria.js` |
| Rain reorder at 50 percent or more, judged at 7 pm inn time | README, server README | `grep -n "RAIN_THRESHOLD_PCT =\|TARGET_HOUR =" server/lib/weather.js` |
| Forecast cached one hour per inn; 1.5 s timeout | server README | `grep -n "weather" server/lib/cache.js`; `grep -n "WEATHER_TIMEOUT_MS" server/config.js` |
| Tool budget 2.5 s, chain 6 s | TESTING | `grep -n "BUDGET_MS =" server/battery/criteria.js` |

## On the landing page

| Number | Where it's said | Command or source |
|---|---|---|
| Up to three things a guest names | hero | `grep -n "three named things" template/concierge.md` (the stop rule) |
| Up to three places nearby | hero | `grep -n "One to three picks" compiler/tools.js` (compose_itinerary's picks, as the agent is told) |
| One to watch at the inn, when there is one | hero | `grep -n "one to watch at the inn" template/concierge.md` (cross_domain); the sample text has four lines: two places, one film, one event (`grep -n picks_included server/fixtures/sample-session.json`) |
| At most 320 characters in the text | call rail | `grep -n "MAX_CHARS =" server/lib/sms.js` |
| Dark until five calls | callers section | `grep -n "SESSION_GATE =" server/api/routes.js` |
| Thirteen Qloo capabilities | capability list | the `CAPABILITIES` list in `dashboard/src/pages/Landing.jsx`, each entry found in the code by `grep -rn -e "ENDPOINTS\." -e "filter.parents.types" -e "'filter.tags'" -e "filter.results.entities" -e "feature.explainability" -e "popularNearby" -e "heatmap.dimensions" -e "output.heatmap.boundary" -e "urn:demographics" -e "urn:tag'" server/lib server/tools server/api`. Memory's `filter.exclude.entities` is not counted: it runs only with `GUEST_MEMORY_SECRET` set |
| Twelve rules always on | safety section | `/usr/bin/node -e "import('./server/api/guardrails.js').then(m=>console.log(m.LOCKED_RULES.length))"` (the page reads the live count from `/api/guardrails`) |
| Eleven builder questions | run-your-own section | `grep -c "title: '" dashboard/src/pages/Builder.jsx` prints 12: the intro, then eleven questions |
| 1 mi scale on the area card | area card | the scale bar is drawn one mile long from the card's own miles-to-pixels `scale` (`grep -n "1 mi" dashboard/src/components/AreaCard.jsx`) |
| "What is around here" is 9.0% of 10 million guest messages | run-your-own section | Conduit, "What 10 million guest messages are about", https://www.conduit.ai/blog/what-10-million-guest-messages-are-about, read 2026-10-22: the post's category is "property and area information at 9.0%" |

## Repo commands, live

| Number | Where it's said | Command and date |
|---|---|---|
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
