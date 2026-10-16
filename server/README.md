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
| `SMS_MOCK` | | `1` = `send_sms` returns a fake sid and sends nothing |
| `TWILIO_ACCOUNT_SID` | | account the texts are sent from |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | | revocable API key pair (preferred) |
| `TWILIO_AUTH_TOKEN` | | used only when no key pair is set |
| `SMS_FROM_NUMBER` | | the verified sending number, E.164. Without it (and credentials) live sending is `disabled` and fails closed |
| `SMS_TIMEOUT_MS` | `8000` | |
| `SESSIONS_PATH` | `server/data/sessions.sqlite` | the session log |

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

Every tool except `send_sms` takes `session_id`, bound by the compiler to the platform's
`system__conversation_id` (the same binding `log_session` uses). When it is present, the
server files the tool's trace under it in the `session_traces` table, and `log_session`
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

**The counterfactual.** After the taste call, `recommend_nearby` makes one more cached
`GET /v2/insights` with the same `filter.type`, `filter.location`, radius, price and rating
filters, and `take=5`, but no `signal.*` and no `sort_by`, so Qloo ranks by general
popularity. The kids filter applies to both. The response gains:

```json
"counterfactual": {
  "without_qloo_taste": { "name": "Harborside Burger Hall", "reason": "most popular place nearby" },
  "with_qloo": { "name": "Lemongrass Lantern", "why": "Fans of Thai food and Sturgill Simpson love it" },
  "same": false,
  "say": "Without your tastes, the top pick would be Harborside Burger Hall. With them, it is Lemongrass Lantern, because fans of Thai food and Sturgill Simpson go there." }
```

When both calls agree, `same` is true and `say` reads "Your tastes agree with the crowd on
this one: X is both the most popular place nearby and your best match." If the extra call
fails, `counterfactual` is `null` and the picks are unaffected. It is never put in the SMS
body. In mock mode the unsignaled call answers from `fixtures/qloo.unsignaled-places.json`
(hand-made, not Qloo data).

**The why trace.** `why_trace.basis` is `explainability` when Qloo attributed the result to
specific inputs; the drivers are those inputs, strongest first. When Qloo ranked a result
without attributing it, the basis is `affinity` and the reason says only "Strong match for
your overall taste". The server never invents an attribution.

### Companion scoring

A couple on a weekend away is the most common caller, so the concierge asks one optional
question when the guest is clearly not alone: "And one thing your plus-one loves?" The answer
counts toward the stop rule (two named things from the guest plus one from the plus-one is
three, and the game stops). This section is how the tools score each pick per person.

> **Shape unverified until the live key arrives.** The param that restricts insights results
> to a list of ids is sent as `filter.results.entities`, the spelling in Qloo's Deep Dive
> docs. Another public entry describes the same move as `filter.entities`. The PII guard
> accepts both (as entity-id lists only), and `npm run probe:qloo` tries both side by side in
> its "companion scoring" probe. If the live API wants the other spelling, change
> `PER_PERSON_FILTER` in `tools/recommend-nearby.js`. The scale of `query.affinity` on a
> filtered call, and so the thresholds below, are also unverified.

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

| `favors` | Rule (`lib/why.js`) | `favors_line` |
|---|---|---|
| `both` | both affinities at least 0.5 and within 0.15 of each other | This one you both will like. |
| `guest` | otherwise, the guest's is higher (ties go to the guest) | That one leans your way. |
| `companion` | otherwise, the plus-one's is higher | That one is for your plus-one. |

The lines never name the plus-one or guess who they are to the guest.

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
gives way after `drop_last_pick` in `TRUNCATION_ORDER`, and it is also tried before each pick
drop when dropping it alone is enough, so a marker never costs a pick and is never cut for
nothing. With no marker present the truncation steps are exactly as before.

**Mock mode.** `fixtures/qloo.insights.companion.json` holds hand-made cases (never a recorded
response) for the scoring calls. The fixture transport reads any `qloo.insights.*.json`
overlay before the base file, and a match value of `*` means "param present", so the scoring
calls never fall through to the shortlist fixture.

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

### `send_sms`

Sends the text `compose_itinerary` built. The agent binds `to` to the platform's caller id, so
the model cannot choose the recipient.

| Field | Type | Notes |
|---|---|---|
| `to` | E.164 string | bound to `system__caller_id` |
| `body` | string | at most 320 characters, every link https; sent exactly as given, nothing appended |

Answers `{ ok: true, sent: true, sid, status }` only after Twilio returned 2xx with a message sid.
Any other outcome is a 502 with `sent: false` and a `say` line, so the agent never claims a text
went out when it did not. At most three texts go to one number per hour. The log records the
message sid and Twilio's status, never the number or the body. `SMS_MOCK=1` returns a fake
`SMmock...` sid.

### `log_session`

The agent's last call on every guest call: one anonymous row for the host dashboard.

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

## How Qloo is load-bearing

Four of the eight tools call Qloo directly, and the rest exist to put Qloo's picks in
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
| 9 | Popularity baseline (counterfactual) | `GET /v2/insights` same place filters, no `signal.*` | `recommend_nearby` | shows what the guest would have heard without their tastes, next to the pick Qloo made for them |

Each call's requests are visible on the property dashboard (`/property/:id`, Calls, "Qloo
calls (n)") and the landing page shows the exact request behind its sample pick.

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

Tests on Node's built-in runner, all offline: the SMS composer (length, footer, links,
GSM-7, segment math, truncation order), shared-secret auth, the why trace, the PII guard
(including that a refused request never reaches the transport), the cache (TTL, cache-only,
mock bypass, bounded retries, no credentials in logs), and the mock path of every tool end
to end over HTTP.

## Deployed (2026-10-15)

Live in mock mode at **https://concierge.southernsky.cloud**: dashboard (`/`, `/build`, `/property/demo`), `/api/*` (writes need `X-Admin-Token`), `/health`, and `POST /tools/<name>` with `X-Concierge-Secret`. Caddy proxies the whole hostname to the container. No fake sessions are seeded in production (sessions come only from `log_session`).
Container `bellhop-concierge` on the Reliable VPS, port 4040. See `deploy/README.md` for deploy, layout, and rollback.
