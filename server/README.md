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
npm test        # node --test, 50 tests, no network, no keys
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

Mock and live share every line of code above the transport, including normalization, so a
tool that works in mock mode exercises the same paths it will use live. Cache-only mode
exists for the period after the hackathon key is deactivated: a demo seeded while the key
was live keeps answering the same questions.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `CONCIERGE_TOOL_SECRET` | (required, 16+ chars) | shared secret the agent sends in `X-Concierge-Secret`; the server will not start without it |
| `PORT` | `8787` | listen port |
| `QLOO_API_KEY` | | hackathon key, sent only as the `X-Api-Key` header |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | hackathon keys do not work on staging or production hosts |
| `QLOO_MOCK` | | `1` = fixtures |
| `QLOO_TIMEOUT_MS` | `4500` | per attempt; the voice platform waits about 10 s for a tool |
| `QLOO_RETRIES` | `2` | extra attempts on 429/5xx/timeouts only, backoff 250 ms then 500 ms |
| `TICKETMASTER_API_KEY` | | Discovery API consumer key (free tier). Without it `events_nearby` answers `status: "degraded"` |
| `TICKETMASTER_MOCK` | | `1` = fixtures |
| `TICKETMASTER_TIMEOUT_MS` | `4000` | |
| `CACHE_PATH` | `server/data/cache.sqlite` | |
| `CACHE_ONLY` | | `1` = never call upstream |
| `DEFAULT_TIMEZONE` | `America/New_York` | property timezone for "tonight" and "this weekend" |

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
- **Credentials never reach a log line or a cache key.** Qloo's key is a header. Ticketmaster's
  key is a query parameter by that API's design, so it is appended inside the transport,
  below the logging and caching layer.

## Tool contracts

All tools are `POST /tools/<name>` with a JSON body and the `X-Concierge-Secret` header.

Every success response has `ok: true`, the tool's `status` (`ok`, `empty`, or `degraded`),
the tool's own fields, and `meta.upstream`: one record per upstream call with its service,
endpoint, and whether it was answered `live`, from `cache`, or from `mock` fixtures.

Errors are never reported as success:

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `invalid_input`, `invalid_json` | the body failed validation (message says which field) |
| 401 | `unauthorized` | missing or wrong secret |
| 413 | `body_too_large` | body over 32 KB |
| 422 | `pii_refused` | the request would have sent personal data to Qloo |
| 502 | `unauthorized`, `forbidden`, `rate_limited`, `timeout`, `cache_miss`, ... | upstream failed; the response includes `say`, a line the agent can speak instead of inventing an answer |

### `resolve_taste`

Turns what the guest said into Qloo ids. Named things go through Qloo `/search`.
Category-shaped mentions ("thai food", "jazz bars") go through `/v2/tags`, as do names
that do not match closely. Each result carries a `confidence` (word overlap between the
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

### `recommend_nearby`

Places near the property, ranked by Qloo affinity for this guest's taste.

| Field | Type | Notes |
|---|---|---|
| `taste` | `{id, name}[]`, 1-8 | from `resolve_taste`; ids starting `urn:tag:` are sent as tag signals |
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
`feature.explainability=true`.

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
    "why": "Fans of Thai food and Sturgill Simpson love it",
    "why_trace": { "basis": "explainability", "drivers": [
      { "id": "urn:tag:genre:place:restaurant:thai", "name": "Thai food", "score": 0.88 },
      { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson", "score": 0.61 } ] },
    "source": "Qloo" } ],
  "applied": { "radius_miles": 3, "budget": 3, "min_rating": 4, "when": "tonight",
               "party_size": 2, "kids": false, "filtered_for_kids": 0 },
  "meta": { "upstream": [ { "service": "qloo", "endpoint": "/v2/insights", "via": "mock", "ms": 4 } ] } }
```

`url` is the place's website when it is https, otherwise an https map search link.

**The why trace.** `why_trace.basis` is `explainability` when Qloo attributed the result to
specific inputs; the drivers are those inputs, strongest first. When Qloo ranked a result
without attributing it, the basis is `affinity` and the reason says only "Strong match for
your overall taste". The server never invents an attribution.

### `cross_domain`

"People who love X also love Y" across categories: music taste to films, a director to
books, and so on. `target` is one of `artist`, `movie`, `book`, `podcast`, `place`,
`tv_show`. A `place` target also needs `lat` and `lng` (and takes `radius_miles`). The
guest's own inputs are never returned as recommendations.

```json
// request
{ "taste": [ { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson" } ], "target": "movie", "take": 1 }

// response
{ "ok": true, "tool": "cross_domain", "status": "ok", "target": "movie",
  "results": [ { "name": "Inside Llewyn Davis", "entity_id": "fx-movie-inside-llewyn-davis",
    "type": "movie", "year": 2013, "affinity": 0.9, "why": "Fans of Sturgill Simpson love it",
    "why_trace": { "basis": "explainability", "drivers": [
      { "id": "fx-artist-sturgill-simpson", "name": "Sturgill Simpson", "score": 0.86 } ] },
    "source": "Qloo" } ],
  "meta": { "upstream": [ { "service": "qloo", "endpoint": "/v2/insights", "via": "mock", "ms": 1 } ] } }
```

### `events_nearby`

Live events from the Ticketmaster Discovery API.

| Field | Type | Notes |
|---|---|---|
| `lat`, `lng` | number | |
| `radius_miles` | number, default 10 | 1-50 |
| `when` | `tonight` (default) or `weekend` | tonight = now to 3 am; weekend = Friday 5 pm (or now, if later) to Sunday 11 pm, in the property's timezone |
| `classification` | optional | `music`, `sports`, `arts & theatre`, `film`, `family`, `comedy` |
| `timezone` | optional IANA zone | defaults to `DEFAULT_TIMEZONE` |
| `take` | number, default 5 | 1-10 |

```json
// request
{ "lat": 32.079, "lng": -81.095, "when": "tonight", "classification": "music", "take": 1 }

// response
{ "ok": true, "tool": "events_nearby", "status": "ok",
  "window": { "when": "tonight", "start": "2026-10-15T23:02:12.089Z",
              "end": "2026-10-16T07:00:00.000Z", "timezone": "America/New_York" },
  "events": [ { "id": "fx-evt-1", "name": "Hollow Pines String Band", "venue": "The Lyric Annex",
    "start": "2026-10-17T00:00:00Z", "url": "https://example.com/events/hollow-pines",
    "category": "Music", "source": "Ticketmaster", "when_label": "Fri 8pm" } ],
  "meta": { "upstream": [ { "service": "ticketmaster", "endpoint": "/events.json", "via": "mock", "ms": 0 } ] } }
```

Event links that are not https come back as `url: null`. (The mock fixture returns the
same events whatever the window; the live API filters by it.)

### `compose_itinerary`

Builds the text message. Pure function: no upstream calls, fully deterministic.

| Field | Type | Notes |
|---|---|---|
| `picks` | 1-5 of `{ name, why?, url?, detail? }` | in rank order; `detail` is a short label such as `when_label` |
| `guest.party_size` | number | used in the header |
| `guest.when` | `tonight` or `weekend` | used in the header |
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
  2. `trim_why_32`: each why to 32 characters at a word boundary
  3. `trim_why_20`
  4. `drop_last_pick`: lowest-ranked picks, one at a time; at least one stays
  5. `drop_why`
  6. `drop_detail`
  7. `trim_name`
  8. `drop_link`: last, because a shortened link is a broken link

```json
// request
{ "picks": [
    { "name": "Lemongrass Lantern", "why": "Fans of Thai food and Sturgill Simpson love it",
      "url": "https://example.com/lemongrass-lantern" },
    { "name": "Hollow Pines String Band", "detail": "Fri 8pm", "why": "Live string band",
      "url": "https://example.com/events/hollow-pines" } ],
  "guest": { "party_size": 2, "when": "tonight" } }

// response
{ "ok": true, "tool": "compose_itinerary", "status": "ok",
  "body": "Tonight for 2:\n1. Lemongrass Lantern - Fans of Thai food and Sturgill Simpson love it https://example.com/lemongrass-lantern\n2. Hollow Pines String Band Fri 8pm - Live string band https://example.com/events/hollow-pines\nPicks from Qloo taste graph + Ticketmaster. Reply STOP to opt out.",
  "char_count": 286, "segments": 2, "encoding": "GSM-7", "picks_included": 2,
  "truncation": [], "rejected_links": [], "meta": { "upstream": [] } }
```

This tool composes the text only. Sending it is a separate step that must confirm delivery
before the agent tells the guest it was sent.

### `area_insights`

Aggregate taste intelligence for the host dashboard. Nothing in it is about one guest.

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

## How Qloo is load-bearing

Four of the six tools call Qloo directly, and the other two exist to put Qloo's picks in
front of the guest. Every capability below is
called from `lib/qloo.js` and appears by endpoint in each response's `meta.upstream` and
in the server log, one JSON line per call (endpoint and parameters, never the key).

| # | Qloo capability | Endpoint and key parameters | Used by | What it does for the guest or host |
|---|---|---|---|---|
| 1 | Entity search | `GET /search` `query`, `take` | `resolve_taste` | "Sturgill Simpson" becomes an artist id |
| 2 | Tag search | `GET /v2/tags` `filter.query`, `feature.typo_tolerance` | `resolve_taste` | "thai food" becomes a cuisine tag |
| 3 | Location-scoped insights | `GET /v2/insights` `filter.type=urn:entity:place`, `filter.location`, `filter.location.radius`, `filter.price_level.max`, `filter.rating.min`, `sort_by=affinity` | `recommend_nearby` | places near the inn ranked for this guest's taste and budget |
| 4 | Cross-domain affinity | `GET /v2/insights` with signals from one domain and `filter.type` of another | `cross_domain`, `recommend_nearby` | a music taste picks a restaurant; a director picks a book |
| 5 | Explainability | `feature.explainability=true` on every insights call | all recommendation tools | the per-pick "why", traced to the guest's own inputs |
| 6 | Heatmap | `GET /v2/insights` `filter.type=urn:heatmap` | `area_insights` | where around the property a taste runs hottest |
| 7 | Demographics | `GET /v2/insights` `filter.type=urn:demographics` | `area_insights` | which age and gender groups lean toward the guests' tastes |
| 8 | Audience compare | `GET /v2/analysis/compare` `a.signal.*`, `b.signal.*` | `area_insights` | how two guest segments differ |

Ticketmaster adds what a taste graph does not hold: what is on tonight.

## When the live key arrives

The client was written from Qloo's documentation before a hackathon key was issued. These
are the places most likely to need a correction, all of them in one file each:

- `lib/why.js` `collectDrivers`: the inner shape of `query.explainability`. The walker
  accepts any nesting that names an input id with a score, but the field names are a best
  reading of the docs.
- `lib/qloo.js` `toWktPoint`: geo filters are sent as `POINT(lng lat)`. If the host wants
  `lat,lng`, it is a one-line change.
- `lib/qloo.js` `normalizeEntity` and `tools/area-insights.js` `compact*`: property names for
  rating, price, website, heatmap cells, and the compare response.

`npm run probe:qloo` prints exactly these shapes.

## Tests

```bash
npm test
```

50 tests on Node's built-in runner, all offline: the SMS composer (length, footer, links,
GSM-7, segment math, truncation order), shared-secret auth, the why trace, the PII guard
(including that a refused request never reaches the transport), the cache (TTL, cache-only,
mock bypass, bounded retries, no credentials in logs), and the mock path of every tool end
to end over HTTP.
