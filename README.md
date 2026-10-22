# Bellhop Concierge

A phone number on the room card. A guest calls, names two things they love, and Qloo's taste
graph picks three places and events near the inn, each with the reason it was picked. The plan
goes out as one text. The innkeeper gets a dashboard and a one-page brief to print.

A twelve-room inn doesn't have a concierge. It has an innkeeper who is also the plumber, the
baker, and the person who picks up the phone at 11pm. This is for them.

Built for the Qloo Agentic Hackathon, October 2026. Licensed AGPL-3.0.

## Try it in 30 seconds

| | |
|---|---|
| **Call it** | **(706) 810-9262.** Harper answers for The Juniper House, a demo inn in Savannah, GA. Name a band you love and what you feel like eating. |
| **See it** | [concierge.southernsky.cloud](https://concierge.southernsky.cloud): a sample pick, the Qloo request behind it, and what the guest would have heard without their tastes. |
| **Run the inn** | [`/property/demo`](https://concierge.southernsky.cloud/property/demo): calls, the exact text a guest gets, where each line came from, area insights. |
| **Print the brief** | [`/property/demo/brief`](https://concierge.southernsky.cloud/property/demo/brief): one page for the front desk, room cards tear off the bottom. |
| **Build your own** | [`/build`](https://concierge.southernsky.cloud/build): eleven questions, a preview, then publish. |

Straight talk about the demo today: the number is a test line, capped at twenty calls a day.
Until the hackathon key arrives, Qloo answers from hand-written mock fixtures, and so do
Ticketmaster and the text sender. The live server tells you which is which:

```bash
curl -s https://concierge.southernsky.cloud/health
```

Or on your own machine, no keys needed:

```bash
git clone https://github.com/StankyDanko/bellhop-concierge && cd bellhop-concierge
npm install
npm test        # the offline suite, all green
npm run mock    # the tool server on :8787, answering from fixtures
curl -s -X POST localhost:8787/tools/resolve_taste \
  -H 'X-Concierge-Secret: local-dev-secret-change-me' -H 'content-type: application/json' \
  -d '{"mentions":["Sturgill Simpson","thai food"]}'
```

## How Qloo is load-bearing

The voice line doesn't know any restaurants. Every place, event, and reason the guest hears
comes back from a tool call on that call, and the tools are Qloo first. Every call is recorded
in the response's `meta.upstream` (endpoint, and whether it was answered live, from cache, or
from mock fixtures), and the dashboard shows the request behind each pick.

| Qloo capability | The call | What it does here | Today |
|---|---|---|---|
| Entity search | `GET /search` | "Sturgill Simpson" becomes an artist id | mock fixtures until the hackathon key arrives |
| Tag search | `GET /v2/tags` | "thai food" becomes a cuisine tag | mock fixtures until the key arrives |
| Insights near the inn | `GET /v2/insights`, `filter.type=urn:entity:place`, `filter.location`, radius, price, rating, `sort_by=affinity` | places near the inn, ranked for this guest | mock fixtures until the key arrives |
| Explainability | `feature.explainability=true` on every insights call | the reason line: "Fans of Thai food and Sturgill Simpson love it." When Qloo doesn't attribute a pick, the reason says so, and nothing is made up | mock fixtures until the key arrives |
| Cross-domain affinity | insights with signals from one domain and `filter.type` of another | a band picks a restaurant; a director picks a book | mock fixtures until the key arrives |
| Per-person scoring | insights with `filter.results.entities` set to the shortlist, once with the guest's signals and once with the plus-one's | "This one you both will like." At least one pick works for both of them | mock fixtures; the filter's spelling is checked by `npm run probe:qloo` when the key arrives |
| The unsignaled counterfactual | the same place call with no taste signals at all | "Without your tastes, the top pick would be X. With them, it's Y." Proof that the taste graph changed the answer. Dashboard only, never in the text | mock fixtures until the key arrives |
| Heatmap | insights, `filter.type=urn:heatmap` | where around the inn a taste runs hottest | mock fixtures until the key arrives |
| Demographics | insights, `filter.type=urn:demographics` | which age and gender groups lean toward these tastes in the area | mock fixtures until the key arrives |
| Guest taste fingerprint | the ids every caller resolved, aggregated behind a five-call floor, sent as `signal.interests.entities` and `signal.interests.tags` to the heatmap, demographics, and compare calls | the panels describe the people who call this number, not the town, with the sample size shown | mock fixtures until the key arrives |
| Audience compare | `GET /v2/analysis/compare` | how two groups of tastes differ | mock fixtures until the key arrives |

Ticketmaster's Discovery API adds what a taste graph doesn't hold: what's on tonight and this
weekend. The details, request and response shapes included, are in
[`server/README.md`](server/README.md).

## What the innkeeper gets

- **A concierge that knows their favorites.** Eleven questions in the builder, including the
  local spots they love and why (the concierge quotes the reason), a choice of two voices,
  Harper or Maybelle, a preview, then publish. Twelve guardrails are locked on and
  can't be switched off: it says it's automated, it says the call is recorded, and it never
  speaks a door code, takes a payment, or names a place that didn't come from Qloo,
  Ticketmaster, or the innkeeper's own notes.
- **A dashboard.** Calls, the text a guest gets and where every line of it came from, and
  area insights. Panels about guest tastes stay dark until five calls are in, so a panel never
  describes just one or two callers.
- **A brief.** One printable page for the front desk, with room cards that tear off the bottom.

## What it never does

- **Sends personal data to Qloo.** Every outbound parameter passes an allowlist first. Only
  ids, tags, coordinates, and filters go out. A taste mention that contains an email, a phone
  number, or a room number is refused before it leaves the server.
- **Keeps a caller's number.** The session log stores a keyed hash of it, never the number,
  never a name, never a transcript.
- **Texts anyone but the caller.** The recipient is bound to the number that called, not
  chosen by the model, and one number gets at most three texts an hour.
- **Commits Qloo data.** The fixtures in `server/fixtures/` are hand-written fakes with
  fictional places. Real responses live only in a private, gitignored cache.

## Honest limits

1. **Hours go stale.** Picks come from place data, and places change their hours. The
   concierge never invents an opening hour, but it can't promise one either.
2. **Speech recognition gets names wrong.** Each match carries a confidence, the concierge
   says the name back in its next line, and a name the tools can't find gets one "what is it
   most like?" instead of a guess.
3. **Distances are as the crow flies,** from the inn's coordinates. The concierge says "about a
   quarter mile", never "five minutes", because it doesn't know the streets.
4. **The Qloo shapes are a careful reading of the docs, not yet a live response.** The client
   was written before a key existed. `npm run probe:qloo` prints every shape side by side the
   day one arrives, and the places most likely to need a fix are listed in `server/README.md`.
   Each guess, how it gets checked, and the key-day steps: [QLOO-NOTES.md](QLOO-NOTES.md).
5. **Demographics describe people who share these tastes nearby,** not this inn's guests. The
   callers' fingerprint is a small, self-selected sample, which is why every panel shows its
   call count and stays dark under five.
6. **Hackathon keys are switched off after the event.** Cache freeze (`CACHE_FREEZE=1`) keeps a
   pre-warmed demo answering the questions it was asked while the key was live, and nothing new.

## What's in the repo

| Path | What it is |
|---|---|
| [`server/`](server/README.md) | The tool server the voice line calls: eight tools over Qloo, Ticketmaster, and Twilio, a PII guard, a private cache, and the dashboard API. |
| `dashboard/` | The landing page, the builder, the innkeeper dashboard, and the printable brief (React, Vite). |
| [`compiler/`](compiler/README.md) | Turns an innkeeper's answers and a persona into a voice agent definition, then lints it. |
| [`template/`](template/concierge.md) | The concierge prompt, with its locked rules. |
| [`personas/`](personas/README.md) | Harper and Maybelle. |
| `config/` | The config schema and the demo inn. |
| `deploy/`, `Containerfile`, `deploy.mjs` | How the demo is shipped. |
| `scripts/githooks/` | The checks every commit passes. See [CONTRIBUTING.md](CONTRIBUTING.md). |

Where it's headed: [ROADMAP.md](ROADMAP.md).

## Run it

Node 20 or newer. The npm scripts call `/usr/bin/node`; if your Node lives elsewhere, run the
same files with `node`.

```bash
npm install
npm test                    # the offline suite
npm run mock                # tool server + dashboard API on :8787, fixtures only
npm run build:dashboard     # build the dashboard; the server serves it
npm run smoke:dashboard     # boot the server and check the pages a judge opens
npm run compile -- config/examples/demo-inn.json   # the demo inn as an agent definition
npm run hooks               # turn on the repo's commit checks
```

Live mode reads keys from `server/.env` (`npm run live`). The variables are listed in
[`server/README.md`](server/README.md).

## License

AGPL-3.0-only. See [LICENSE](LICENSE). This is the reference implementation. The hosted
product's hardening, client configs, and credentials are not in this repository.

---

Bellhop Concierge is an edition of Bellhop by SouthernSky. Built by
[StankyDanko](https://github.com/StankyDanko), one brick at a time. 🧱
