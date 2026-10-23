# Bellhop Concierge tool server

The HTTP service a phone voice agent calls while it talks to a guest. The agent learns
what the guest is into ("Sturgill Simpson, Thai food, Wes Anderson"), and these tools turn
that into nearby picks, each with the reason it was picked, then into one text message.

Every recommendation comes from Qloo's taste graph or Ticketmaster's live event listings.
The voice agent does not make up places. It reads back what these tools return.

## Architecture

```
  guest on the phone
        |
        v
  ElevenLabs voice agent ----- POST /tools/<name>, header X-Concierge-Secret -----+
                                                                                  |
  +-------------------------------- server/ --------------------------------------v--+
  |  app.js            Hono routes, shared-secret auth, body limit, error mapping      |
  |    tools/          one handler per agent tool, input validated at the boundary     |
  |      resolve-taste  recommend-nearby  cross-domain  events-nearby                  |
  |      compose-itinerary (pure)  area-insights                                       |
  |    lib/qloo.js     the ONE Qloo client: host, X-Api-Key, params, normalization     |
  |    lib/ticketmaster.js   Discovery API client + normalization                      |
  |    lib/pii-guard.js      allowlist check on every outbound Qloo param              |
  |    lib/why.js            explainability -> "Fans of X and Y love it"               |
  |    lib/sms.js            320-char GSM-7 composer with a fixed truncation order     |
  |    lib/upstream.js       cache -> transport -> bounded retries -> log line         |
  |       |                     |                                                      |
  |       v                     v                                                      |
  |    lib/cache.js          lib/transport.js                                          |
  |    SQLite, TTL per       httpTransport (live)  |  fixtureTransport (QLOO_MOCK=1)   |
  |    endpoint, CACHE_ONLY  both return the same raw envelope; normalization is       |
  |    data/cache.sqlite     shared, so mock and live differ by one env var            |
  +------------------------------------------------------------------------------------+
        |                                  |
        v                                  v
  https://hackathon.api.qloo.com     https://app.ticketmaster.com/discovery/v2
```

## Run it

Requires Node 20 or newer. From the repository root:

```bash
npm install
npm test        # node --test, no network, no keys
npm run mock    # serves on :8787 from server/fixtures, no keys needed
```

The npm scripts call `/usr/bin/node` (the system Node on our build box). On a machine where
Node lives elsewhere, run the same commands with `node`, for example `node server/index.js`.

Then call a tool:

```bash
curl -s localhost:8787/health

curl -s -X POST localhost:8787/tools/resolve_taste \
  -H 'X-Concierge-Secret: local-dev-secret-change-me' \
  -H 'content-type: application/json' \
  -d '{"mentions":["Sturgill Simpson","thai food","wes anderson"]}'
```

### Three modes

| Mode | How | Qloo calls | Cache |
|---|---|---|---|
| **Mock** | `QLOO_MOCK=1` and/or `TICKETMASTER_MOCK=1` (`npm run mock` sets both) | none; answers from `server/fixtures/*.json` | bypassed |
| **Live** | set `QLOO_API_KEY` (and `TICKETMASTER_API_KEY`) in `server/.env`, then `npm run live` | real, logged, retried | read-through, TTL per endpoint |
| **Cache-only** | `CACHE_ONLY=1` | none; a request not in the cache returns `cache_miss` | serves entries even past their TTL |
| **Cache freeze** | `CACHE_FREEZE=1` | none, same as cache-only; `/health` reports `"cache": "frozen"` | serves entries even past their TTL; the file is opened read-only, and the server refuses to start when it is missing or empty. The weather forecast is served from the cache like every other answer; with nothing cached for today it is skipped |

Mock and live share every line of code above the transport, including normalization, so a
tool that works in mock mode exercises the same paths it will use live. Cache-only mode
and cache freeze exist for the period after the hackathon key is deactivated: a demo seeded
while the key was live keeps answering the same questions. `npm run prewarm -- --apply` seeds
it at one live call per 2 s; with `CACHE_FREEZE=1` the same command checks it with no calls.
Live, a 401 or 403 from Qloo also falls back to the cached answer.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `CONCIERGE_TOOL_SECRET` | (required, 16+ chars) | shared secret the agent sends in `X-Concierge-Secret`; the server will not start without it |
| `PORT` | `8787` | listen port |
| `QLOO_API_KEY` | | hackathon key, sent only as the `X-Api-Key` header |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | hackathon keys do not work on staging or production hosts |
| `QLOO_MOCK` | | `1` = fixtures |
| `QLOO_TIMEOUT_MS` | `4500` | per attempt; the voice platform waits about 10 s for a tool |
| `QLOO_RETRIES` | `2` | extra attempts on 5xx/timeouts only, backoff 250 ms then 500 ms |
| `QLOO_429_BACKOFF_MS` | `2100` | a 429 sleeps this long and retries once; a second 429 serves the cached answer, even stale, or returns `rate_limited` |
| `TICKETMASTER_API_KEY` | | Discovery API consumer key (free tier). Without it `events_nearby` answers `status: "degraded"`. The same key serves `/attractions.json` for shows by similar artists |
| `TICKETMASTER_MOCK` | | `1` = fixtures |
| `TICKETMASTER_TIMEOUT_MS` | `4000` | |
| `CACHE_PATH` | `server/data/cache.sqlite` | |
| `CACHE_ONLY` | | `1` = never call upstream |
| `CACHE_FREEZE` | | `1` = cache-only for the period after the key goes dark, read-only, and refused at startup when `CACHE_PATH` is missing or holds no responses; `/health` says `frozen` |
| `WEATHER` | on | `0` switches the Open-Meteo forecast off. Never on in mock mode (`QLOO_MOCK=1`), which never leaves the machine |
| `WEATHER_BASE_URL` | `https://api.open-meteo.com` | point it at the commercial endpoint in a paid deployment |
| `WEATHER_TIMEOUT_MS` | `1500` | short on purpose: a caller is on the line and a missed forecast costs nothing |
| `DEFAULT_TIMEZONE` | `America/New_York` | property timezone for "tonight" and "this weekend" |
| `SMS_MOCK` | | `1` = `send_sms` returns a fake sid and sends nothing |
| `TWILIO_ACCOUNT_SID` | | account the texts are sent from |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | | revocable API key pair (preferred) |
| `TWILIO_AUTH_TOKEN` | | used only when no key pair is set |
| `SMS_FROM_NUMBER` | | the verified sending number, E.164. Without it (and credentials) live sending is `disabled` and fails closed |
| `SMS_TIMEOUT_MS` | `8000` | |
| `SESSIONS_PATH` | `server/data/sessions.sqlite` | the session log |
| `GUEST_MEMORY_PATH` | `server/data/guest-memory.sqlite` | returning-guest memory, its own file; the dashboard is never handed it |
| `GUEST_MEMORY_SECRET` | | keys the memory hash; empty switches memory off, and it must differ from `CONCIERGE_TOOL_SECRET` or memory stays off |
| `GUEST_MEMORY_TTL_DAYS` | `7` | days a memory lasts after the last call when no stay length was said (1 to 14) |
| `CONCIERGE_AGENTS` | | JSON: voice agent id to `{ property_id, persona, timezone }`; the initiation webhook answers default lines for any agent not listed |

`npm run probe:qloo` makes one live call per Qloo capability and prints the response
shapes next to what the normalizers extracted. Run it the day a key arrives.

## Data handling

- **Qloo response data is never committed.** Qloo's hackathon terms allow private
  server-side caching but forbid storing response data in a public repository. The cache
  lives in `server/data/`, which is gitignored. The files in `server/fixtures/` are
  hand-written, synthetic examples shaped like the documented envelopes, with fake `fx-*`
  ids and fictional places. They are not Qloo output.
- **No personal data goes to Qloo.** `lib/pii-guard.js` checks every outbound parameter
  against an allowlist before the request leaves the process. Only entity ids, tag URNs,
  coordinates, radii, and enumerated filters pass. The single free-text field (the guest's
  taste mention) is capped at 80 characters and refused if it contains an email address, a
  phone number, or a room number. Guest names and phone numbers have no parameter to travel
  in.
- **The forecast carries no guest data.** The Open-Meteo request leaves the server with the
  inn's coordinates rounded to about a kilometre, its time zone, and the two series names. No
  guest data, no Qloo data.
- **Credentials never reach a log line or a cache key.** Qloo's key is a header. Ticketmaster's
  key is a query parameter by that API's design, so it is appended inside the transport,
  below the logging and caching layer.

## Tool contracts

All tools are `POST /tools/<name>` with a JSON body and the `X-Concierge-Secret` header.

Every success response has `ok: true`, the tool's `status` (`ok`, `empty`, or `degraded`),
the tool's own fields, and `meta.upstream`: one record per upstream call with its service,
endpoint, and whether it was answered `live`, from `cache`, or from `mock` fixtures.

Every success response also has `trace`: one entry per Qloo or Ticketmaster request the tool
made, in the order sent. It is what the dashboard's "Qloo calls (n)" view shows.

| Trace field | Notes |
|---|---|
| `n` | order within the tool call (renumbered across the whole call on the dashboard) |
| `tool` | the tool that made the request |
| `source` | `qloo` or `ticketmaster` (the SMS provider is never traced) |
| `endpoint` | for example `/v2/insights` |
| `params` | exactly what was sent, after the PII guard; credential-shaped keys are dropped, and the Qloo key is a header, so it is never here |
| `mode` | `mock` or `live` |
| `cache` | `hit` or `miss` |
| `ms`, `results` | time taken and how many items came back |
| `error` | present only when the request failed (for example `upstream_error`) |

Every tool takes `session_id`, bound by the compiler to the platform's
`system__conversation_id` (the same binding `log_session` uses); the model never fills it.
`send_sms` uses it only to allow one text per call, kept in memory and never stored with the
number. For the other tools, when it is present, the server files the tool's trace under it in the `session_traces` table, and `log_session`
links the row by recording `trace_count`. An unfilled `{{system__conversation_id}}` stores
nothing. A trace never holds a caller number, caller hash, name, or message body, and the
dashboard API uses the conversation id only as a join key; it never returns it.

Errors are never reported as success:

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `invalid_input`, `invalid_json` | the body failed validation (message says which field) |
| 401 | `unauthorized` | missing or wrong secret |
| 413 | `body_too_large` | body over 32 KB |
| 422 | `pii_refused` | the request would have sent personal data to Qloo |
| 429 | `rate_limited` | a local limit refused the call before any upstream request (today, the `send_sms` hourly limit); the response has `reason: "rate_limited"` and a `say` line |
| 502 | `unauthorized`, `forbidden`, `rate_limited`, `timeout`, ... | upstream failed; the response includes `say`, a line the agent can speak instead of inventing an answer |
| 200 with `ok: false` | `cache_miss` | cache-only or frozen, and nothing cached for this request; `status: "unavailable"` and `say` ("I can't reach my sources for that one right now."), so the voice platform hands the agent the line |

### `POST /hooks/conversation-init`

Off unless `GUEST_MEMORY_SECRET` is set and the agent is compiled with the webhook. The voice
platform posts `{ caller_id, agent_id, called_number, call_sid, conversation_id }` while the line
rings, and starts the call with the nine dynamic variables this answers (`greeting`,
`opener_hook`, `choice_pair`, `bet_domain`, `plan_window`, `caller_status`, `memory_line`,
`stay_line`, `texted_count`). It never answers anything but 200 with variables, except a body over
8 KB: bad auth, an unknown agent, a withheld number, or an internal error all get the default lines,
which are the lines a call hears today. The number, `called_number` and `call_sid` are never stored
or logged. It never returns a config override.

### `forget_guest`

Body `{ session_id, caller_id }`, both bound by the platform. Deletes every memory row for the
caller at every inn, marks the call's link forgotten so nothing is written back, and sets
`caller_hash` to NULL on the caller's past session rows. Answers `{ forgotten: true, say }` the same
way whether or not anything was stored.

### Returning-guest memory (`server/lib/memory.js`)

On a call the webhook linked, recommend_nearby sends places already texted to this caller as
`filter.exclude.entities` (and drops them from the results too) and adds remembered tastes as
interest signals after the call's own, twelve in all. `applied.memory` reports the two counts. The
ids memory added are stripped from the call trace before it is returned or stored, so the
dashboard's trace and the guest taste fingerprint never show them: the trace is exactly what was
sent, minus those ids. Retention: seven days after the last call, or the stated stay plus one day,
never more than fourteen days after the last call or thirty after the first
(`grep -n "_DAYS = " server/lib/memory.js`).

### `resolve_taste`

Turns what the guest said into Qloo ids. Named things (an artist, a director, a film) go
through Qloo `/search`. Food and place mentions never do: a cuisine or dish ("thai food",
"sushi", "bbq") or a kind of place ("jazz bars") goes to `/v2/tags` with
`filter.parents.types=urn:entity:place`, so a food word lands on a place tag and never on a
music or film genre of the same name, or on an album called Sushi. A food mention asks for
its bare cuisine word ("thai food" asks "thai", "bbq" asks "barbecue") with `take=10`, and
takes the restaurant genre tag (`urn:tag:genre:place:restaurant:...`) whose name best matches
the word, because typo tolerance can rank a near miss first. Other categories ("jazz music")
and names that do not match closely go to unscoped `/v2/tags` as before. Each result carries
a `confidence` (1 when the tag name is the same word, otherwise word overlap between the
mention and the matched name), so the agent can confirm a weak match out loud.

```json
// request
{ "mentions": ["Sturgill Simpson", "thai food", "wes anderson"] }

// response (abridged)
{
  "ok": true, "tool": "resolve_taste", "status": "ok",
  "resolved": [
    { "mention": "Sturgill Simpson", "kind": "entity", "id": "fx-artist-sturgill-simpson",
      "entity_id": "fx-artist-sturgill-simpson", "tag_id": null,
      "name": "Sturgill Simpson", "type": "artist", "confidence": 1 },
    { "mention": "thai food", "kind": "tag", "id": "urn:tag:genre:place:restaurant:thai",
      "entity_id": null, "tag_id": "urn:tag:genre:place:restaurant:thai",
      "name": "Thai food", "type": "tag", "confidence": 0.67 },
    { "mention": "wes anderson", "kind": "entity", "id": "fx-person-wes-anderson", "name": "Wes Anderson", "type": "person", "confidence": 1 }
  ],
  "unresolved": [],
  "echo_line": "Sturgill Simpson, Thai food, and Wes Anderson",
  "meta": { "upstream": [
    { "service": "qloo", "endpoint": "/search", "via": "mock", "ms": 1 },
    { "service": "qloo", "endpoint": "/v2/tags", "via": "mock", "ms": 0 },
    { "service": "qloo", "endpoint": "/search", "via": "mock", "ms": 0 } ] }
}
```

The `resolved` items are the `taste` input of the next three tools: pass them back as they
are (`{ id, name }` is enough; bare id strings also work).

A vibe phrase, the guest's answer to a two way food choice such as "spicy and loud", never
goes to `/search`. Each taste word goes to `/v2/tags` on its own, scoped to place tags, under the tag words in
`VIBE_PHRASES` (`server/tools/resolve-taste.js`), and each of those trace entries carries
`mapped_from: "spicy and loud"`. The say-back line repeats the guest's words, and budget
words ("splurge", "easy") come back as `preferences: { "budget": "splurge" }` without
being sent upstream.

### `recommend_nearby`

Places near the property, ranked by Qloo affinity for this guest's taste.

| Field | Type | Notes |
|---|---|---|
| `taste` | `{id, name}[]`, 1-8 | from `resolve_taste`; ids starting `urn:tag:` are sent as tag signals, and a cuisine (`urn:tag:genre:place:restaurant:...`) is also sent as a hard `filter.tags` |
| `lat`, `lng` | number | the property |
| `radius_miles` | number, default 3 | 0.25-25 |
| `take` | number, default 3 | 1-10 |
| `constraints.party_size` | number | echoed in `applied` (Qloo has no party-size filter) |
| `constraints.budget` | 1-4 | sent as `filter.price_level.max` |
| `constraints.min_rating` | 0-5, default 4 | sent as `filter.rating.min` |
| `constraints.kids` | boolean | removes places tagged as bars, pubs, lounges, breweries |
| `constraints.when` | `tonight` or `weekend` | echoed in `applied` |
| `constraints.max_minutes` | number | caps the radius at 0.4 miles per minute (in-town driving) |

Qloo request: `GET /v2/insights` with `filter.type=urn:entity:place`,
`signal.interests.entities`, `signal.interests.tags`, `filter.location=POINT(lng lat)`,
`filter.location.radius` (meters), price and rating filters, `sort_by=affinity`,
`feature.explainability=true`, and `filter.tags` when the guest named a cuisine.

**A stated cuisine is a requirement.** As a signal alone a cuisine tag barely moves the
ranking: a guest who said "thai" got no thai place. So the cuisine also goes out as a hard
`filter.tags`, and every pick is a place of that cuisine. Two cuisines (the guest's and the
plus-one's) come back as places of either. If fewer than three places nearby fit the filter
(after the kids filter; fewer than `take` when it asks for less), the tool asks once more
without it, with the cuisine still steering the ranking: the places that fit stay first and
the unfiltered ones fill the rest. It says so: `applied.cuisine_filter` is `"hard"`, `"relaxed"`, or `null` when no cuisine was
said, and `applied.cuisine` lists the cuisines in the guest's words. Vibe tags stay signals.
Per-person scoring for a plus-one is unchanged (signals only, on the shortlist).

```json
// request
{ "taste": [ { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson" },
             { "id": "urn:tag:genre:place:restaurant:thai", "name": "Thai food" } ],
  "lat": 32.079, "lng": -81.095, "radius_miles": 3, "take": 1,
  "constraints": { "party_size": 2, "budget": 3, "when": "tonight", "max_minutes": 15 } }

// response
{ "ok": true, "tool": "recommend_nearby", "status": "ok",
  "places": [ {
    "name": "Lemongrass Lantern", "entity_id": "fx-place-lemongrass-lantern",
    "address": "112 Fictional Ln", "price_level": 2, "rating": 4.6, "distance_miles": 0.2,
    "url": "https://example.com/lemongrass-lantern", "affinity": 0.91,
    "why": "Fans of Sturgill Simpson love it; tagged Thai",
    "why_trace": { "basis": "explainability", "drivers": [
      { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson", "score": 0.61 },
      { "id": "urn:tag:genre:place:restaurant:thai", "name": "Thai food", "score": null, "source": "tag_match" } ] },
    "tags": ["Thai"],
    "source": "Qloo" } ],
  "applied": { "radius_miles": 3, "budget": 3, "min_rating": 4, "when": "tonight",
               "party_size": 2, "kids": false, "filtered_for_kids": 0,
               "cuisine_filter": "hard", "cuisine": ["Thai food"] },
  "meta": { "upstream": [ { "service": "qloo", "endpoint": "/v2/insights", "via": "mock", "ms": 4 } ] } }
```

`url` is the place's website when it is https, otherwise an https map search link.

Each place also carries `tags`: up to eight of its own tag names that say what it is and how
it feels (cuisine, ambience, noise level), the guest's own matches first. They come from the
place's Qloo record, never from its name. When a place carries a tag the guest asked for,
`why_trace.drivers` lists it with `"source": "tag_match"` and `"score": null`: Qloo's
explainability never attributes tags, so the match is read from the place's own tag list,
and `basis` still says whether Qloo itself named a driver.

**The counterfactual.** After the taste call, `recommend_nearby` makes one more cached
`GET /v2/insights` with the same `filter.type`, `filter.location`, radius, price and rating
filters, and `take=5`, but no `signal.*`, no `sort_by`, and no cuisine `filter.tags`, so
Qloo ranks by general popularity: the baseline is the town's popular list, what anyone nearby
would be told. The kids filter applies to both lists. It compares the two lists, not just the two
top picks: on live data the top pick sometimes matched while the rest of the list did not.
The response gains (fake values):

```json
"counterfactual": {
  "verdict": "moved",
  "same": false,
  "without_list": [{ "name": "Harborside Burger Hall", "entity_id": "fx-place-harborside-burger-hall" }],
  "with_list": [{ "name": "Lemongrass Lantern", "entity_id": "fx-place-lemongrass-lantern" }],
  "overlap5": 1, "moved5": 4, "picks_outside": 2,
  "popularity_mean": { "without": 0.95, "with": 0.75 },
  "say": "Your tastes moved the answer: two of your three picks are not among the five most popular places nearby.",
  "top1": { "same": false, "say": "Without your tastes, the top pick would be Harborside Burger Hall. With them, it is Lemongrass Lantern, because fans of Sturgill Simpson go there." },
  "without_qloo_taste": { "name": "Harborside Burger Hall", "reason": "most popular place nearby" },
  "with_qloo": { "name": "Lemongrass Lantern", "why": "Fans of Sturgill Simpson love it; tagged Thai" },
  "signal_effects": [{ "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson", "top3": 0.5, "top5": 0.4, "top10": null, "all": null }]
}
```

`with_list` is the picks the guest got, in order, then the rest of the taste-ranked shortlist,
up to five. `overlap5` counts places on both lists, `moved5` the rest of `with_list`,
`picks_outside` the picks that are not on the no-taste list. `verdict` is `agrees` only when
every place in `with_list` is on the no-taste list; then `same` is true and `say` reads "Here
your taste and the town agree: ...". `same` now means the whole list agrees; the old top-pick
comparison is `top1.same` and `top1.say`. `signal_effects` comes from the response's top-level
`query.explainability` (see QLOO-NOTES) and appears only when Qloo sent it. If the extra call
fails, `counterfactual` is `null` and the picks are unaffected. It is never put in the SMS body.
In mock mode the unsignaled call answers from `fixtures/qloo.unsignaled-places.json`
(hand-made, not Qloo data).

**The why trace.** `why_trace.basis` is `explainability` when Qloo attributed the result to
specific inputs; the drivers are those inputs, strongest first. When Qloo ranked a result
without attributing it, the basis is `affinity` and the reason says only "Strong match for
your overall taste". The server never invents an attribution. The reason names the entity
drivers Qloo attributed ("Fans of X love it") and then, when the pick's own tag list carries
one of the guest's cuisine or vibe tags, "tagged Thai". That second part is a fact about the
place, not an attribution: Qloo's explainability names entity signals only, so a tag is never
said as "fans of".

### Weather order

After Qloo's picks are chosen, `recommend_nearby` may reorder them by tonight's rain chance. It
never adds, drops, or swaps a place.

- **One call.** A single GET to Open-Meteo `/v1/forecast` per guest call, with the inn's
  coordinates (rounded to two decimals), `hourly=precipitation_probability,temperature_2m`, the
  inn's time zone, and `forecast_days=1`. It runs alongside the Qloo calls, so it adds no
  latency. Only for `when: tonight`.
- **Cached and frozen like Qloo.** Service `weather`, one hour TTL per inn
  (`server/lib/cache.js`), served from the cache alone under `CACHE_FREEZE`, shown in the call
  trace as service `weather` (the result count is the number of hourly points, 24). A frozen
  forecast is used only on the local day it was cached; on any other day it is skipped.
- **The rule.** Target hour is 7 pm inn time (the current hour once 7 pm has started). At
  `RAIN_THRESHOLD_PCT` (50) or more, picks whose own Qloo tag names match `OUTDOOR_TAG`
  (`server/lib/weather.js`) move after indoor ones, each group keeping Qloo's order, and `say`
  gets the one clause. Nothing is guessed from a place name. A cuisine-relaxed list is not
  reordered, since its order already carries a promise.
- **The response.** `weather: { checked, hour, precip_pct, temp_c, threshold_pct, hourly_points,
  reordered, moved }`: the forecast's own numbers and counts, no place. When the call failed,
  `weather: { checked: false }` and nothing else changes. The clause is spoken only; the text
  message does not carry it.
- **Privacy.** The forecast request carries coordinates, a time zone and two series names. It has
  its own allowlist in `server/lib/pii-guard.js`, scoped to `/v1/forecast`, so none of those keys
  becomes legal on a Qloo request (`server/test/weather.test.js`).
- **Test hook.** `skip_weather: true` in the body (not in the agent's tool schema) skips the
  forecast; the battery uses it to prove the pick set is identical with and without weather (C17).

Terms: Open-Meteo's free tier is for non-commercial use and requires the attribution line
"Weather data by Open-Meteo.com (CC BY 4.0)", which the site footer carries. A paid deployment
needs their commercial plan.

### Companion scoring

A couple on a weekend away is the most common caller, so the concierge asks one optional
question when the guest is clearly not alone: "And one thing your plus-one loves?" The answer
counts toward the stop rule (two named things from the guest plus one from the plus-one is
three, and the game stops). This section is how the tools score each pick per person.

> **Checked live on key day.** The param that restricts insights results to a list of ids
> is sent as `filter.results.entities`, the spelling in Qloo's Deep Dive docs. On the live
> host it returns only the listed ids, with affinities, highest first; the bare
> `filter.entities` spelling behaves the same. The PII guard accepts both (as entity-id
> lists only). On a filtered call the affinities come back in a narrow, high band (0.78 to
> 0.83 measured on nine-place shortlists, on the three measured pairs), so the rule below works by rank, not by absolute
> score.

**Inputs.**

| Tool | Field | Notes |
|---|---|---|
| `resolve_taste` | `companion_mentions`, 0-2 strings | what the plus-one loves, in the guest's words. A parallel list, so the agent never tags items one by one. Response adds `companion_resolved` (each item `who: "companion"`), `companion_unresolved`, `companion_echo_line`. Absent for a guest who is alone. |
| `recommend_nearby` | `companion_taste`, `{id, name}[]`, 1-8 | `companion_resolved`, passed back as is. Absent, `null`, or `[]` means no plus-one. |
| `compose_itinerary` | `picks[].favors` | copied from `recommend_nearby`; `both` adds a ` (both)` marker after the name |

**Qloo calls.** With a `companion_taste`, `recommend_nearby` makes at most three insights
calls, never more, and each goes through the shared upstream cache:

1. **Shortlist.** The usual place query, with `signal.interests.entities` and
   `signal.interests.tags` holding BOTH people's signals (de-duplicated, guest first). Combined
   signals, not guest only, so a place can make the shortlist because the plus-one would love
   it. Guest-only signals would let the plus-one veto a pick but never surface one, and "that
   one is for your plus-one" would almost never be true.
2. **Guest fit.** `GET /v2/insights` with `filter.type=urn:entity:place`, the guest's signals
   only, `filter.results.entities=<shortlist ids>`, `take=<shortlist size>`. No location
   params: the ids already pin the places.
3. **Plus-one fit.** The same call with the plus-one's signals only.

Calls 2 and 3 run in parallel. If either fails upstream, the places still go out without
`favors`, and `companion.note` says scoring was unavailable. A refused parameter is never
swallowed.

**Per pick.** Each place gains `fit: { guest, companion }` (the two affinities), `favors`, and
`favors_line`, the sentence the agent says after the reason:

| `favors` | Rule (`lib/why.js` `favorsByRank`) | `favors_line` |
|---|---|---|
| `both` | each person ranks the place in their own top half of the shortlist (ceil(n/2)) | This one you both will like. |
| `guest` | otherwise, the guest ranks it higher | That one leans your way. |
| `companion` | otherwise, the plus-one ranks it higher | That one is for your plus-one. |
| none | equal ranks outside the top half, or either person's scores spread less than 0.005 across the shortlist (`FLAT_SPREAD`) | no line |

The lines never name the plus-one or guess who they are to the guest.

**The pick token.** Every place also carries `pick_token`, a short HMAC (keyed by
`CONCIERGE_TOOL_SECRET`, `lib/pick-token.js`) over its name and its `favors` value, or over the
name and an empty favors for a solo guest. `compose_itinerary` keeps a pick's `favors` only when
its token verifies, so the `(both)` marker can only reach a text when this tool said so. A
favors value the model filled in, or a pick without a token, is stripped, and
`compose_itinerary` reports how many in `favors_dropped`.

**At least one pick for both.** When none of the top `take` picks is `both` and a lower
shortlist entry is, that entry replaces the last pick (only when `take` is two or more, so the
top pick never moves). `companion.promoted_shared_pick` names it.

```json
// request (after resolve_taste with companion_mentions: ["Kacey Musgraves"])
{ "taste": [ { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson" },
             { "id": "urn:tag:genre:place:restaurant:thai", "name": "Thai food" } ],
  "companion_taste": [ { "id": "fx-artist-kacey-musgraves", "name": "Kacey Musgraves" } ],
  "lat": 32.079, "lng": -81.095, "take": 3 }

// response (abridged, mock fixtures)
{ "places": [
    { "name": "Lemongrass Lantern", "favors": "guest", "fit": { "guest": 0.92, "companion": 0.48 },
      "favors_line": "That one leans your way." },
    { "name": "The Low Lantern Listening Room", "favors": "both", "fit": { "guest": 0.8, "companion": 0.83 },
      "favors_line": "This one you both will like." },
    { "name": "Pastel Diner & Pie", "favors": "companion", "fit": { "guest": 0.55, "companion": 0.88 },
      "favors_line": "That one is for your plus-one." } ],
  "companion": { "scored": true, "shared_pick": true, "promoted_shared_pick": null },
  "meta": { "upstream": [ { "endpoint": "/v2/insights" }, { "endpoint": "/v2/insights" }, { "endpoint": "/v2/insights" } ] } }
```

**The text message.** The ` (both)` marker is 7 characters and the 320 limit still holds. It
gives way after the reason and link steps and before `drop_last_pick` in `TRUNCATION_ORDER`,
so a marker never costs a pick. With no marker present the step is skipped.

**Mock mode.** `fixtures/qloo.insights.companion.json` holds hand-made cases (never a recorded
response) for the scoring calls. The fixture transport reads any `qloo.insights.*.json`
overlay before the base file, and a match value of `*` means "param present", so the scoring
calls never fall through to the shortlist fixture.

### `cross_domain`

"People who love X also love Y" across categories: music taste to films, a director to
books, and so on. `target` is one of `artist`, `movie`, `book`, `podcast`, `place`,
`tv_show`. A `place` target also needs `lat` and `lng` (and takes `radius_miles`). The
guest's own inputs are never returned as recommendations. Each result carries a `pick_token`
signed over its name alone, so `compose_itinerary` can tell it from one the model made up.

Toward places, a cuisine works as in `recommend_nearby` (hard `filter.tags`, one relaxed
retry, `cuisine_filter` on the response, `tags` on each place). Toward films, books, music,
podcasts, and shows every taste stays a signal.

```json
// request
{ "taste": [ { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson" } ], "target": "movie", "take": 1 }

// response
{ "ok": true, "tool": "cross_domain", "status": "ok", "target": "movie",
  "results": [ { "name": "Inside Llewyn Davis", "entity_id": "fx-movie-inside-llewyn-davis",
    "type": "movie", "year": 2013, "affinity": 0.9, "why": "Fans of Sturgill Simpson love it",
    "why_trace": { "basis": "explainability", "drivers": [
      { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson", "score": 0.86 } ] },
    "source": "Qloo", "pick_token": "..." } ],
  "meta": { "upstream": [ { "service": "qloo", "endpoint": "/v2/insights", "via": "mock", "ms": 1 } ] } }
```

### `events_nearby`

Live events from the Ticketmaster Discovery API.

| Field | Type | Notes |
|---|---|---|
| `lat`, `lng` | number | |
| `radius_miles` | number, default 10 | 1-50 |
| `when` | `tonight` (default) or `weekend` | tonight = now to 4 am after the call's calendar day (the end of its evening, below); weekend = Friday 5 pm (or now, if later) to Sunday 11 pm, in the property's timezone |
| `classification` | optional | `music`, `sports`, `arts & theatre`, `film`, `family`, `comedy`. Sent to Ticketmaster as `classificationName` (it matches a segment, genre, or subgenre; `segmentName` would miss comedy and family, which are genres), then applied again to what comes back, so a `film` request returns only film events. An event with no classification at all is kept |
| `timezone` | optional IANA zone | defaults to `DEFAULT_TIMEZONE` |
| `take` | number, default 5 | 1-10 |
| `artist` | optional `{ id, name }` | the band or singer the guest named, exactly as `resolve_taste` returned it. Adds `by_taste` to the answer (below). The id must look like an entity id and the name must be present, or the call is a 400 |

```json
// request
{ "lat": 32.079, "lng": -81.095, "when": "tonight", "classification": "music", "take": 1 }

// response
{ "ok": true, "tool": "events_nearby", "status": "ok",
  "window": { "when": "tonight", "start": "2026-10-15T23:02:12.089Z",
              "end": "2026-10-16T08:00:00.000Z", "timezone": "America/New_York" },
  "events": [ { "id": "fx-evt-1", "name": "Hollow Pines String Band", "venue": "The Lyric Annex",
    "start": "2026-10-17T00:00:00Z", "url": "https://example.com/events/hollow-pines",
    "local_date": "2026-10-16", "local_time": "20:00:00", "category": "Music", "source": "Ticketmaster",
    "when_label": "Tonight 8pm", "tonight": true, "say": "Tonight at eight, The Lyric Annex, Hollow Pines String Band.",
    "pick_token": "..." } ],
  "meta": { "upstream": [ { "service": "ticketmaster", "endpoint": "/events.json", "via": "mock", "ms": 0 } ] } }
```

Event links that are not https come back as `url: null`. (The mock fixture returns the
same events whatever the window; the live API filters by it.)

What "tonight" means, in the property's timezone, measured from the time of the call: an
evening runs from 4 pm on a calendar day to 4 am the next morning, and tonight is the evening
of the call's own calendar day. That holds after midnight too: at 00:16 on Friday a guest who
says "tonight" means Friday evening, so a Friday 8 pm show is `Tonight 8pm`. A call between
midnight and 4 am also counts shows later in those same small hours as tonight. Any other show
on the call's date is `Today`; anything else is its weekday.

| Call (New York) | Show | `when_label` | `say` opens with |
|---|---|---|---|
| Fri 00:16 | Fri 8 pm | `Tonight 8pm` | `Tonight at eight` |
| Fri 6 pm | Fri 8 pm | `Tonight 8pm` | `Tonight at eight` |
| Fri 10 am | Fri 2 pm | `Today 2pm` | `Today at two in the afternoon` |
| Thu 3 pm | Fri 8 pm | `Fri 8pm` | `Friday at eight` |
| Fri 11 pm | Sat 12:30 am | `Tonight 12:30am` | `Tonight at twelve thirty in the morning` |

Every field below is built from Ticketmaster's own fields and the property's timezone, nothing else:

| Field | Notes |
|---|---|
| `when_label` | for the text: `Tonight 8pm`, `Today 2pm`, or the weekday, `Fri 8pm`, by the rule above. A date with no time is `Sat`, or `Today`, never `Tonight` |
| `tonight` | boolean, the same test |
| `say` | one spoken-ready line: day word, time in words, venue, name. `Friday at seven thirty, The Lyric Annex, Hollow Pines String Band.` It always opens with its own day word (`Tonight`, `Today`, or the weekday, the same word as `when_label`), so the agent never has to add one. It says nothing about taste or fit, because Ticketmaster does not |
| `pick_token` | HMAC over the name and `when_label` (`lib/pick-token.js`); `compose_itinerary` prints an event's `when_label` only when it verifies |

#### Shows by similar artists (`by_taste`)

With `artist` set, the answer also carries `by_taste`: at most two shows, tonight or this
weekend, by artists Qloo ranks close to the one the guest named. The code is
`server/tools/events-by-taste.js`.

1. Qloo: `GET /v2/insights` with `filter.type=urn:entity:artist`, the named artist as
   `signal.interests.entities`, the same id in `filter.exclude.entities` (so it never comes back
   as its own neighbor), and `take=5`. Cached 30 days (`SIMILAR_ARTISTS_TTL` in `lib/cache.js`).
2. Ticketmaster, one similar artist at a time in Qloo's order: `GET /attractions.json` with that
   artist's name as `keyword` (cached 30 days), kept only on an exact name match, then
   `GET /events.json` with that `attractionId` near the inn.
3. It stops at two shows, one per artist.

The window is "tonight or this weekend": tonight ends at 4 am after the call's calendar day (the
rule above), the weekend runs Friday 5 pm to Sunday 11 pm. One Ticketmaster request covers both,
from the top of the hour (so calls in the same hour share a cache key, as the plain listing's
request does too) to whichever ends later, and each show is kept only when it starts inside one
of the two.

Never the named artist's own show: a similar artist with the same name, or a show whose name
carries the named artist's name (a co-bill), is dropped.

| Field | Notes |
|---|---|
| `status` | `ok`, `empty` (no show in the window), or `degraded` with a `reason` (Qloo could not answer; the plain listing still does) |
| `named` | the named artist's name, as passed in |
| `similar_checked` | how many similar artists were looked up before it stopped |
| `events[].artist` | the similar artist, as Qloo named it |
| `events[].why` | `Fans of <named> also love <artist>, per Qloo`: the reason for the text, always Qloo's |
| `events[].say` | `Fans of <named> also love <artist>, playing Saturday at eight at The Tidewater Hall.` |
| `events[].when_label`, `pick_token` | as for any event: the token covers the name and `when_label`, so `compose_itinerary` keeps the day only when it verifies |
| `events[].reason_source`, `source` | `Qloo` for the reason, `Ticketmaster` for the date and venue |

The keyword is a name Qloo returned, never the guest's words, and it still passes the PII
guard's free-text rule (`assertNoPii` with the `query` key: 80 characters at most, nothing shaped
like an email, phone, or room number) before it leaves; a name the guard refuses is skipped.

With live Qloo and mock Ticketmaster (no key yet) the fixture shows are fictional, so the same
guard as the plain listing applies: no Qloo call is made and no show is read
(`server/test/events-by-taste.test.js`, "the guard").

A cold similar-artists request took about three seconds live (2026-10-22, the
QLOO-NOTES "Artist to artist" row has the command); the 30-day cache is what keeps the call
inside its budget, so `npm run prewarm` warms it for the sample guest and every battery name.

### `compose_itinerary`

Builds the text message. Pure function: no upstream calls, fully deterministic.

| Field | Type | Notes |
|---|---|---|
| `picks` | 1-5 of `{ name, why?, url?, when_label?, favors?, pick_token? }` | in rank order, copied as the tools returned them |
| `picks[].requested` | boolean, optional | true only if the guest asked for this event by name; kept only on an event whose `pick_token` verifies, and it makes that event the last pick a long text drops |
| (response) `favors_dropped` | number | picks whose `favors` was removed because no tool issued their `pick_token` for that name and value |
| (response) `when_dropped` | number | events whose `when_label` was removed for the same reason |
| (response) `tokens_dropped` | number | picks that sent a `pick_token` no tool issued for that pick (checked on every pick, including a name-only `cross_domain` result); the token is dropped and the pick is still sent by name. A real token carrying one forged `favors` or `when_label` is not counted here: that field is dropped and counted in its own counter |
| `guest.party_size` | number | used in the header |
| `guest.when` | `tonight` or `weekend` | used in the header, except that a plan with a verified event that is not tonight says `Your plan` instead of `Tonight` |
| `intro` | string, optional | replaces the default header |

Rules:

- At most **320 characters**, including the fixed footer
  `Picks from Qloo taste graph + Ticketmaster. Reply STOP to opt out.`
- **https links only.** Other links are dropped from the text and listed in `rejected_links`.
- **GSM-7 only.** Smart quotes, dashes, and ellipses become ASCII, accents are stripped, and
  emoji are removed, so the message is billed in 160/153-character segments instead of
  70/67. At 320 characters the message is at most 3 segments.
- When the full message is too long, content gives way in this order, and the response
  lists each step taken in `truncation`:
  1. `drop_header`
  2. `drop_last_why`: lower picks' reasons, lowest-ranked first, each one whole, never the top
     pick's
  3. `drop_last_link`: lower picks' links, lowest-ranked first, each one whole, never the
     top pick's (a link is never shortened, so every composed body passes `send_sms`)
  4. `drop_marker`: the ` (both)` markers
  5. `drop_last_pick`: whole picks, lowest-ranked first, skipping an event flagged
     `requested`, which goes last; at least one pick stays
  6. `drop_why`: the remaining pick's whole reason
  7. `drop_detail`
  8. `trim_name`
  9. `drop_link`: last, because a shortened link is a broken link

  Each step runs only while the text is still over 320, so every pick the guest heard stays
  as long as its words and links can make room.

  A reason is never trimmed. It is either in the text whole or not at all, because a cut
  reason ("Strong match for") reads as a broken sentence and can change its meaning.

```json
// request
{ "picks": [
    { "name": "Lemongrass Lantern", "why": "Fans of Sturgill Simpson love it; tagged Thai",
      "url": "https://example.com/lemongrass-lantern" },
    { "name": "Hollow Pines String Band", "when_label": "Tonight 8pm", "pick_token": "<from events_nearby>",
      "url": "https://example.com/events/hollow-pines" } ],
  "guest": { "party_size": 2, "when": "tonight" } }

// response
{ "ok": true, "tool": "compose_itinerary", "status": "ok",
  "body": "Tonight for 2:\n1. Lemongrass Lantern - Fans of Sturgill Simpson love it; tagged Thai https://example.com/lemongrass-lantern\n2. Hollow Pines String Band Tonight 8pm https://example.com/events/hollow-pines\nPicks from Qloo taste graph + Ticketmaster. Reply STOP to opt out.",
  "char_count": 270, "segments": 2, "encoding": "GSM-7", "picks_included": 2,
  "truncation": [], "rejected_links": [], "favors_dropped": 0, "when_dropped": 0, "tokens_dropped": 0, "meta": { "upstream": [] } }
```

This tool composes the text only. Sending it is a separate step that must confirm delivery
before the agent tells the guest it was sent.

### `area_insights`

Aggregate taste intelligence for the innkeeper dashboard. Nothing in it is about one guest.

| Field | Type | Notes |
|---|---|---|
| `lat`, `lng` | number | the property |
| `radius_miles` | number, default 2 | |
| `interests` | `{id, name}[]`, optional | taste signals to map; required for demographics |
| `compare` | `{ a: [...], b: [...] }`, optional | two interest groups; needs entity ids on both sides |

Each section has its own `status`: `ok`, `skipped` (inputs not given), or `degraded` (the
upstream call failed, with `reason`). One failing section does not fail the call; the top
level `status` becomes `degraded`. This matters for demographics: `filter.type=urn:demographics`
is documented, but its availability on the hackathon host was not confirmed when this was
built.

```json
// request
{ "lat": 32.079, "lng": -81.095, "radius_miles": 2,
  "interests": [ { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson" } ] }

// response (abridged)
{ "ok": true, "tool": "area_insights", "status": "ok",
  "area": { "lat": 32.079, "lng": -81.095, "radius_miles": 2 },
  "heatmap": { "status": "ok", "cells": [
    { "lat": 32.0801, "lng": -81.0912, "geohash": "djuxfx", "affinity": 0.92, "popularity": 0.71 } ] },
  "demographics": { "status": "ok",
    "age": { "24_and_younger": -0.01, "25_to_29": 0.13, "30_to_34": 0.17, "35_to_44": 0.12,
             "45_to_54": -0.01, "55_and_older": -0.22 },
    "gender": { "male": 0.08, "female": -0.08 }, "interests_counted": 2 },
  "compare": { "status": "skipped", "reason": "no compare groups given" } }
```

### `send_sms`

Sends the text `compose_itinerary` built. The agent binds `to` to the platform's caller id, so
the model cannot choose the recipient.

| Field | Type | Notes |
|---|---|---|
| `to` | E.164 string | bound to `system__caller_id` |
| `body` | string | at most 320 characters, every link https; sent exactly as given, nothing appended |

Answers `{ ok: true, sent: true, sid, status }` only after Twilio returned 2xx with a message sid.
Any other outcome is a 502 with `sent: false` and a `say` line, so the agent never claims a text
went out when it did not. At most three texts go to one number per hour; the fourth answers 429
with `reason: "rate_limited"`, `sent: false`, and `say: "The text could not be sent right now,
so here is the top pick by name."`, and nothing reaches Twilio. The log records the
message sid and Twilio's status, never the number or the body. `SMS_MOCK=1` returns a fake
`SMmock...` sid.

### `log_session`

The agent's last call on every guest call: one anonymous row for the innkeeper dashboard.

| Field | Filled by | Notes |
|---|---|---|
| `session_id` | platform, `system__conversation_id` | primary key; a repeat call updates the row |
| `caller_id` | platform, `system__caller_id` | stored ONLY as HMAC-SHA256 keyed by `CONCIERGE_TOOL_SECRET` |
| `call_duration_secs` | platform | used to back-date `started_at` |
| `property_id`, `persona` | compile-time constants | |
| `entities` | model | up to 12 taste names; anything that looks like an email, phone, or room number is dropped |
| `picks_count`, `events_count`, `sms_sent` | model | |

Table: `sessions(id, property_id, persona, started_at, caller_hash, entities_json, picks_count,
events_count, sms_sent, created_at, trace_count)` in `SESSIONS_PATH`. No names, numbers, transcripts, or
message bodies are stored. `trace_count` is added to older databases on open (guarded
`ALTER TABLE`). Traces live in `session_traces(seq, session_id, tool, trace_json,
counterfactual_json, created_at)`, at most 40 rows per session. The response adds
`trace_calls`, the number of upstream requests linked to this call.

## Guest taste fingerprint

Taste tools usually learn an audience from a form one person fills in once. This line
learns it from the calls: every caller names a few things they love, Qloo resolves them to
ids, and those ids add up, call after call, into a fingerprint of the people who call this
number. The fingerprint then drives every innkeeper panel, so the dashboard describes the
inn's own callers rather than a zip code.

**What is stored.** At `log_session` time the server reads the session's own call trace
and copies the resolved ids that call sent to Qloo onto its row, in a new column
`sessions.entity_ids_json` (a JSON array of ids, at most 16). The ids come from exactly two
trace params, split on commas and deduplicated:

| Trace param | Holds | Example |
|---|---|---|
| `signal.interests.entities` | Qloo entity ids the guest named | `fx-artist-sturgill-simpson` |
| `signal.interests.tags` | Qloo tag ids for kinds of things | `urn:tag:genre:place:restaurant:thai` |

A request with no `signal.*` (the popularity counterfactual) contributes nothing. Taste
names stay in `entities_json` as before. The response gains `taste_ids`, how many ids the
call added. Nothing about the caller is involved: no number, no caller hash, no transcript.
The column is added to older databases on open (guarded by `PRAGMA table_info`); a row from
before it existed reads its ids from its persisted trace instead.

**Test calls.** `sessions.is_test` (same guarded migration) is 1 when the session id starts
with one of `TEST_SESSION_PREFIXES` in `lib/sessions.js` (`test-` from the voice platform's
agent-testing harness, and our own end-to-end probe prefixes). Older rows are flagged by
prefix on open. Test calls are stored, so a run can be inspected, but every dashboard read leaves them out: call
counts, the sessions list, the gate, the fingerprint, and the last-call time.

**`GET /api/properties/:id/fingerprint`** (`?sample=1` for the preview):

```json
{ "ok": true, "basis": "callers", "sessions": 9,
  "gate": { "min": 5, "count": 9, "open": true },
  "entities": [ { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson", "sessions": 4 } ],
  "tags": [ { "id": "urn:tag:genre:place:restaurant:thai", "name": "Thai food", "sessions": 3 } ],
  "generated_at": "2026-10-16T18:00:00.000Z" }
```

- `basis`: `callers` (this inn's own calls), `sample` (hand-made fictional callers, only
  when asked for while gated), or `none` (below the floor: no guest signal anywhere).
- `sessions`: the sample size, the number of calls that named at least one taste.
- `gate`: the five-call k-anonymity floor, counted on calls that named a taste, so a
  fingerprint never rests on fewer than five people. Real callers always win over the sample.
- Labels come from the same session's own resolve_taste requests and stored names. When
  the pairing of ids to names is ambiguous an entity is left unnamed rather than mislabeled;
  a tag falls back to its own id (`...:thai` reads "Thai").
- Aggregate only. A test checks that no caller hash, session id, or phone-shaped string
  ever appears in this response or in the insights response.

The sample fingerprint is nine calls: the sample call in `fixtures/sample-session.json`
(its ids read from its trace, the same path a real call takes) plus eight fictional callers
in `fixtures/fingerprint.sample-callers.json`. Both are hand-written; neither holds a
Qloo response.

**How the panels use it.** `GET /api/properties/:id/insights` sends the fingerprint's five
most-named ids to Qloo directly. A caller's own ids are never re-resolved. In live mode the
sample callers' fixture ids are replaced at request time by the ids `/search` returns for their
displayed names, so no fixture id goes upstream.

| Panel | Qloo call | Fingerprint param |
|---|---|---|
| Where tastes run hottest | `GET /v2/insights` `filter.type=urn:heatmap`, `filter.location`, `filter.location.radius`, `heatmap.dimensions=quality` | `signal.interests.entities`, `signal.interests.tags` |
| Hottest named areas | a second `GET /v2/insights` `filter.type=urn:heatmap` with `output.heatmap.boundary=urn:entity:locality`, no dimensions | `signal.interests.entities`, `signal.interests.tags` |
| Who shares these tastes | `GET /v2/insights` `filter.type=urn:demographics` | `signal.interests.entities`, `signal.interests.tags` |
| Your callers lean toward | `GET /v2/insights` `filter.type=urn:tag` | `signal.interests.entities`, `signal.interests.tags` |
| The town around the inn leans toward | `GET /v2/insights` `filter.type=urn:tag`, `filter.location` | none: the inn's location and no taste signal |
| Callers vs. town, one quiet line | `GET /v2/analysis/compare` | `a.signal.interests.entities` = the fingerprint's entity ids; `b.signal.interests.entities` = the top 5 places from an unsignaled `GET /v2/insights` `filter.type=urn:entity:place` near the inn |

The dashboard shows two lists. "Your callers lean toward" is Qloo's tag insight over the
fingerprint (the tastes your callers named); "The town around the inn leans toward" is the same
insight with the inn's location and no taste signal at all. Compare stays as one quiet line,
only where the two groups share a tag. "Hottest named areas" comes from the second heatmap call
with the locality boundary; each hottest cell also carries a quality affinity. Callers' lists
stay dark below five calls that name a taste; the town list holds no guest data. Age and gender
are never sent. Measuring command: `/usr/bin/node --test server/test/area-lean.test.js`.

**Checked live on key day:** the compare call (a = fingerprint, b = top local places).
The live API accepts place ids in a group. It answers with each group's tags (`results.a`,
`results.b`), each counting how many of that group's entities carry the tag, plus a list of
linking tags. The panel shows, per tag, the share of each group that carries it and the
difference. A music fingerprint and a set of places share few tags, so most rows lean
clearly one way. If the call fails, the panel shows as delayed and the other panels are
unaffected.

Every panel in the insights response carries `basis` (`callers`, `sample`, or `area` when no
guest signal was sent; `none` on a gated panel) and `sample_size`, and the top level repeats
both, so the dashboard can tag each panel CALLERS n, SAMPLE, or AREA.

**The honest caveat.** Qloo's heatmap and demographics describe people who share these
tastes around here, not the callers themselves. The dashboard says so under the fingerprint
card, and the fingerprint is a small, self-selected sample, always shown with its count.

## How Qloo is load-bearing

Four of the nine tools (`curl -s localhost:8787/health`, under `tools`) call Qloo directly, and the rest exist to put Qloo's picks in
front of the guest. Every capability below is
called from `lib/qloo.js` and appears by endpoint in each response's `meta.upstream` and
in the server log, one JSON line per call (endpoint and parameters, never the key).

| # | Qloo capability | Endpoint and key parameters | Used by | What it does for the guest or innkeeper |
|---|---|---|---|---|
| 1 | Entity search | `GET /search` `query`, `take` | `resolve_taste` | "Sturgill Simpson" becomes an artist id |
| 2 | Tag search | `GET /v2/tags` `filter.query`, `feature.typo_tolerance`, `filter.parents.types=urn:entity:place` for food, place, and vibe words | `resolve_taste` | "thai food" becomes the thai restaurant genre tag |
| 3 | Location-scoped insights | `GET /v2/insights` `filter.type=urn:entity:place`, `filter.location`, `filter.location.radius`, `filter.price_level.max`, `filter.rating.min`, `sort_by=affinity` | `recommend_nearby` | places near the inn ranked for this guest's taste and budget |
| 4 | Cross-domain affinity | `GET /v2/insights` with signals from one domain and `filter.type` of another | `cross_domain`, `recommend_nearby` | a music taste picks a restaurant; a director picks a book |
| 5 | Explainability | `feature.explainability=true` on every insights call | all recommendation tools | the per-pick "why", traced to the guest's own inputs |
| 6 | Heatmap | `GET /v2/insights` `filter.type=urn:heatmap` | `area_insights` | where around the property a taste runs hottest |
| 7 | Demographics | `GET /v2/insights` `filter.type=urn:demographics` | `area_insights` | which age and gender groups lean toward the guests' tastes |
| 8 | Callers vs. town | `GET /v2/insights` `filter.type=urn:tag` on the fingerprint and on the inn's location alone, plus `GET /v2/analysis/compare` `a.signal.*`, `b.signal.*` | the dashboard API | two lean lists, with compare as one quiet line where they share a tag |
| 9 | Popularity baseline (counterfactual) | `GET /v2/insights` same place filters, no `signal.*` and no cuisine `filter.tags` | `recommend_nearby` | shows what the guest would have heard without their tastes, next to the pick Qloo made for them |
| 10 | Artist to artist | `GET /v2/insights` `filter.type=urn:entity:artist`, `signal.interests.entities=<artist>`, `filter.exclude.entities=<artist>`, `take=5` | `events_nearby` (`artist`) | the reason in "fans of X also love Y, playing Friday at eight": Qloo picks Y, Ticketmaster only says when and where |

What each capability did when measured live, and what we did not ship: [`docs/QLOO.md`](../docs/QLOO.md).

Each call's requests are visible on the property dashboard (`/property/:id`, Calls, "Qloo
calls (n)") and the landing page shows the exact request behind its sample pick.

Ticketmaster adds what a taste graph does not hold: what is on tonight. With a named artist, it answers for the artists Qloo chose.

## Checked against the live API

The client was written from Qloo's documentation before a hackathon key was issued. The key
arrived on 2026-10-19, and the client was checked against the live API on 2026-10-22. Ten of the thirteen shapes we had read from the docs matched; the
compare response differed and was fixed (`tools/area-insights.js` `compactCompare`); rate
limits and cache lifetime are policy no single call confirms. `npm run probe:qloo` prints every
shape side by side with what the normalizers read. The row-by-row record is
[`QLOO-NOTES.md`](../QLOO-NOTES.md); what the live API taught us is
[`docs/LEARNED.md`](../docs/LEARNED.md).

## Tests

```bash
npm test                     # Node's built-in runner, offline, mock transports
npm run battery -- --mock    # sixteen simulated callers and two two-call sequences, eighteen criteria, offline
```

The suite covers every tool end to end over HTTP on its mock path, the SMS composer, the
shared-secret auth, the why trace, the PII guard (including that a refused request never
reaches the transport), the cache and its modes, the fingerprint floor, and the battery's own
scoring. It stays offline even with a live key in the shell. What each layer proves and how to
read a scorecard: [`docs/TESTING.md`](../docs/TESTING.md).

## Deployed (2026-10-15)

Deployed at **https://concierge.southernsky.cloud**: dashboard (`/`, `/build`, `/property/demo`), `/api/*` (writes need `X-Admin-Token`), `/health`, and `POST /tools/<name>` with `X-Concierge-Secret`. Caddy proxies the whole hostname to the container. No fake sessions are seeded in production (sessions come only from `log_session`). `/health` reports each service's mode (Qloo, Ticketmaster, texts) and whether the cache is frozen.
Container `bellhop-concierge` on the Reliable VPS, port 4040. See `deploy/README.md` for deploy, layout, and rollback.
