# Privacy

How data moves through a call, for builders. The guest-facing version, in plainer words, is the
live [privacy page](https://concierge.southernsky.cloud/privacy); its text lives in
`dashboard/src/legal-content.js`. Where the two overlap they say the same thing, and the code
named here is what makes each line true.

## What leaves the server

| To | What goes | What never goes | Enforced by |
|---|---|---|---|
| Qloo | entity ids, tag ids, the coordinates being searched (the property's, or the city the caller named), a radius, filters (type, price, rating, cuisine), and the one free-text field: the taste the guest named, capped at 80 characters | a name, a phone number, an email, a room number, anything about the caller | `server/lib/pii-guard.js`: an allowlist of parameter names and value shapes, checked before every request. A taste that looks like an email, a phone number, or a room number is refused, and a test proves a refused request never reaches the network |
| Ticketmaster | the same coordinates, a radius, a time window, a kind of event | anything about the caller | `server/lib/ticketmaster.js` builds the only request it can send |
| The text sender | the plan text and the number that called | any other number | `send_sms` binds the recipient to the caller's own number; the agent can't choose it. At most twelve texts to one number in an hour (`SENDS_PER_HOUR` in `server/tools/send-sms.js`) and ten in one call (`TEXTS_PER_CALL`) |

## What is kept

The session log (`server/data/sessions.sqlite`, never in git) holds, per call:

- a keyed hash of the caller's number (HMAC-SHA256, `server/lib/sessions.js`), so repeat callers
  can be counted. Not the number.
- returning-guest memory (`server/lib/memory.js`), off unless `GUEST_MEMORY_SECRET` is set, in its
  own SQLite file, keyed by a second keyed hash of the number with its own secret so it can never
  be joined to the session log: the first name the caller gave, the town the call searched, the tastes that resolved (in the guest's own filtered words), the
  ids of places texted, party size, kids, nights, and which opening lines were heard. Seven days
  after the last call by default, the stated stay plus one day when said, never past fourteen days
  after the last call or thirty after the first. "Forget me" deletes it at once and unlinks past
  session rows. Nothing under server/api/ can open it (a test enforces this).
- the tastes named and the Qloo ids they resolved to.
- counts: picks, events, whether a text went out.
- the call trace: each upstream request, its endpoint and parameters, and how it was answered.

Not kept, anywhere: the number itself, a transcript, a recording, a message body, and no name
outside the memory above. The voice platform records the call on its side; this server never
stores the recording.

## The five-call floor

The innkeeper's taste panels describe the inn's callers as a group. With two callers, a
"what your callers love" list is close to describing two people. So every panel built from guest
tastes stays dark until five calls have named a taste that resolved (`SESSION_GATE = 5` in
`server/api/routes.js`). The count uses only what the guest's own words resolved to, never a
generic fallback the server sent on its own. Test calls are stored but never counted. Below the
floor the dashboard shows a labeled sample, made of fictional callers.

The panels also never send an age or a gender. Demographics come back from Qloo as the
leanings of people who share these tastes nearby, never as a guess about a caller.

## Qloo data stays out of git

Qloo's hackathon terms allow private server-side caching and forbid storing response data in a
public repository. So:

- Live responses live in `server/data/cache.sqlite`, gitignored, and the pre-commit hook refuses
  any `*.sqlite` file and anything force-added past the ignore rules.
- Fixtures in `server/fixtures/` are hand-written fakes with `fx-` ids and fictional places.
- Probe and battery output is written outside the repository.
- These docs carry words and counts only. Examples use placeholders like `<ARTIST_ID>`.

## Credentials

The Qloo key travels only as a header. Ticketmaster's key is a query parameter by that API's
design, so it's added inside the transport, below logging and caching: it never reaches a log
line or a cache key. All keys live in `server/.env`, which the pre-commit hook refuses to commit.
