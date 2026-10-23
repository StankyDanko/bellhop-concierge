# Testing

Four layers, from cheapest to most expensive. The first three need no keys and no network.
Counts drift as tests are added, so this page doesn't print them: each command prints its own.

| Layer | Command | Needs | What it proves |
|---|---|---|---|
| Unit and contract suite | `npm test` | nothing | every tool, the text composer, the privacy guard, the cache, the battery's own scoring |
| Dashboard smoke | `npm run build:dashboard` then `npm run smoke:dashboard` | nothing | the server boots and the pages a judge opens load |
| Battery, offline | `npm run battery -- --mock` | nothing | sixteen simulated callers and two two-call sequences pass eighteen criteria on fixtures |
| Battery, live | `npm run battery -- --live --port <free port>` | a Qloo key in `server/.env` | the same callers against the live API |
| Probe | `npm run probe:qloo` | a Qloo key | one call per capability, the raw shape next to what our code read from it |

## The suite

`npm test` runs Node's built-in test runner over `server/` and `compiler/`. Every Qloo,
Ticketmaster, and text call in it goes through a mock transport: the same code path as live,
with the network swapped out at the bottom. It stays offline even with a live key exported in
the shell, because the test helpers build their own mock configs and never read the
environment.

**Fixtures are hand-written fakes.** Everything in `server/fixtures/` was typed by hand: `fx-`
ids, fictional places, invented scores. Qloo's hackathon terms forbid storing their responses in
a public repository, and none are here. When a test needs a live shape, it gets that shape with
made-up values.

One naming trap worth knowing: the fixture transport reads every file named
`qloo.insights.<anything>.json` as an overlay on `qloo.insights.json`, so a new fixture with that
prefix silently changes every mocked insights answer. Name new fixtures outside that pattern
(the no-taste list is `qloo.unsignaled-places.json` for this reason).

## The battery

`server/scripts/battery.js` plays callers from `server/battery/scenarios.json` against the tool
server over HTTP, in the order the voice agent calls the tools, and scores each call on the
criteria in `server/battery/criteria.js`. No phone, no voice platform, no texts sent.

The fifteen callers cover: an artist with a cuisine, an artist with a mood phrase, a director
with a cuisine, two couples (different tastes, two things each), a family with kids, a tight
budget, a name that won't resolve, a misspelled cuisine, tonight and this weekend with events, a
twenty-mile radius, a film request, a book request, and a guest who names three things.

The eighteen criteria, in plain words:

| | Criterion | What trips it (a warn or a fail) |
|---|---|---|
| C1 | Every named thing resolved, or was reported as not found | a name silently dropped |
| C2 | Mood phrases went to tag search, never to entity search | "spicy and loud" looked up as a band |
| C3 | Every pick sits inside the radius that was applied | a place outside it |
| C4 | Every pick has a reason: Qloo's explainability, or the honest fallback | a pick with no reason |
| C5 | Dropping the second thing the guest named changes the picks | the second taste did nothing |
| C6 | The no-taste contrast is present and tells the two lists apart | missing, or indistinguishable |
| C7 | With a plus-one whose tastes differ, not every pick is labelled "both" | everything "both" |
| C8 | With kids along, no adults-only places | a bar or a brewery in the picks |
| C9 | Cross-domain never hands back one of the guest's own inputs | the band recommended to its fan |
| C10 | The text is 320 characters or fewer, plain characters, every line traceable to a tool | too long, or a line nobody returned |
| C11 | Each tool answers in under 2.5 s, the whole chain in under 6 s | a slow tool or chain |
| C12 | Every outbound Qloo parameter passed the privacy allowlist | anything that didn't |
| C13 | A second call from the same number hears a new opener and a new food choice | the same opener or pair twice running |
| C14 | A returning call skips places already texted and carries the earlier tastes | a texted place picked again, or a remembered id in the recorded trace |
| C15 | After "forget me" nothing is left and the next call is new | a row left, or a probe call still remembered |
| C16 | Nothing remembered appears in any dashboard response | a memory field, the number, a hash, or a remembered line in any /api answer |
| C17 | Weather changes only the order: the pick set is identical with and without it | a place added or dropped by the weather step, the rain clause said twice, or a clause with no reorder |
| C18 | Shows by similar artists: each names an artist Qloo ranked close (its keyword lookup and the Qloo artist call are in the trace), at most two, each with a when_label, a pick_token, and Qloo's reason. Not applicable when no artist was passed or the server has no live listing | the named artist's own show or a co-bill carrying that name, a third show, or a show not traced to a Qloo similar artist |

In the offline battery the fixture places carry no outdoor tags, so C17 passes with zero places
moved; the reorder itself is proved by `server/test/weather.test.js`.

C13 to C16 run only on the two-call sequences in scenarios.json. Each call in a sequence first
posts the initiation webhook with a fictional 555-01xx number; the mock run moves its clock a day
for the next-day sequence. Live runs stay same-day and cannot see the memory file, so C15 reports
the row count as not visible.

Each criterion returns pass, warn, fail, or n/a. N/a means the caller didn't exercise it (C8
only applies when kids are along). A tool that was called and failed is a fail, never an n/a.
`--strict` exits non-zero on any fail; warns never fail a run.

Offline, C5 is all warns, and that is expected. The mock fixtures answer a place request with
the same places whatever signals it carries, so dropping the second taste cannot change the
picks there. Taste sensitivity is a property of the live taste graph, and it is measured live:
see the battery rows in [MEASUREMENTS.md](MEASUREMENTS.md).

A run writes `scorecard.md` (verdicts and counts only, safe to share) and `raw.jsonl` (the raw
tool responses). In live mode `raw.jsonl` holds Qloo data: keep it out of the repository. The
default output directory is under your system temp directory; `--out <dir>` picks another.

**Live runs spend quota.** `--cap N` stops before N live upstream requests (default 150),
`--pace-ms` spaces tool calls (default 2000 ms live), and the run stops on the first rate limit
it sees. It starts its own server on `--port`, with a throwaway cache and session log,
Ticketmaster and texting mocked, and stops it when done.

## The probe

`npm run probe:qloo` makes one live call per Qloo capability and prints, side by side, the raw
response shape and what our normalizers read from it. It writes nothing to disk. Redirect its
output somewhere outside the repository. [`QLOO-NOTES.md`](../QLOO-NOTES.md) has the table it was
read against and the verdict for each row.

## Pre-warm

`npm run prewarm -- --dry-run` lists every Qloo request shape the demo makes, offline.
`npm run prewarm -- --apply` sends them live, one per two seconds, into the private cache, so a
frozen demo (`CACHE_FREEZE=1`) can keep answering after the key is switched off.

## The hooks

`npm run hooks` turns on `scripts/githooks/`. Every commit then passes a copy check, a leak
check, and, when code changed, `npm test`. What each one refuses: [CONTRIBUTING.md](../CONTRIBUTING.md).
