# Bellhop Concierge

A phone concierge small inns put on the room card. A guest calls and names three things they
love; Qloo's taste graph picks three places near the inn, each with the reason it was picked;
the plan arrives as one text. The innkeeper gets a dashboard and a one-page brief to print.

A twelve-room inn doesn't have a concierge. It has an innkeeper who is also the plumber, the
baker, and the person who picks up the phone at 11pm. This is for them.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/), October 2026. Project page: [Devpost](https://devpost.com/software/bellhop-concierge).
[Live demo](https://concierge.southernsky.cloud) · call **(706) 810-9262** ·
[Architecture](docs/ARCHITECTURE.md) · [How we use Qloo](docs/QLOO.md) ·
[What we learned](docs/LEARNED.md) · [AGPL-3.0](LICENSE)

## Try it

| | |
|---|---|
| **Call it** | **(706) 810-9262.** Harper answers for The Juniper House, a demo inn in Savannah, GA. Name a band you love and what you feel like eating. |
| **See it** | [concierge.southernsky.cloud](https://concierge.southernsky.cloud): a sample pick, the Qloo request behind it, and what the guest would have heard without their tastes. |
| **Run the inn** | [`/property/demo`](https://concierge.southernsky.cloud/property/demo): calls, the exact text a guest gets, where each line came from, area insights. |
| **Print the brief** | [`/property/demo/brief`](https://concierge.southernsky.cloud/property/demo/brief): one page for the front desk, room cards tear off the bottom. |
| **Build your own** | [`/build`](https://concierge.southernsky.cloud/build): eleven questions, a preview, then publish. |

**Where the demo stands.** Qloo is live: the hackathon key arrived on October 19, 2026, every
capability below was checked against the live API on October 22, and the public server reports Qloo
as live. The number is a test line, capped at twenty calls a day. The server says which mode
each service is in, Qloo, Ticketmaster, and the text sender, so you never have to take our word
for it:

```bash
curl -s https://concierge.southernsky.cloud/health
```

Or on your own machine, no keys needed:

```bash
git clone https://github.com/StankyDanko/bellhop-concierge && cd bellhop-concierge
npm install
npm test        # the offline suite; it prints its own count
npm run mock    # the tool server on :8787, answering from hand-written fixtures
curl -s -X POST localhost:8787/tools/resolve_taste \
  -H 'X-Concierge-Secret: local-dev-secret-change-me' -H 'content-type: application/json' \
  -d '{"mentions":["Sturgill Simpson","thai food"]}'
```

## How a call works

1. The guest names what they love, in their own words: a band, a film, a cuisine, a mood.
2. Each name goes to Qloo's `/search` and becomes an entity id. Each cuisine or mood goes to
   `/v2/tags`, scoped to places, and becomes a tag. Nothing is guessed: a name that doesn't
   resolve is said back as not found.
3. `/v2/insights` ranks places near the inn for those ids, with a stated cuisine as a hard
   filter and explainability on, so each pick comes back with the inputs that drove it.
4. If a plus-one came along, the shortlist is scored once per person, and each pick says who
   it's for.
5. The same place call runs again with no taste at all. The two lists, side by side, show what
   the guest's taste changed.
6. Ticketmaster adds what's on tonight or this weekend.
7. One text, at most 320 characters, goes to the number that called, and only that number.

The picture, the nine tools, and what is stored where: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Why Qloo is load-bearing

- **Taste in, places out.** The voice line knows no restaurants. Every place, event, and reason
  the guest hears comes back from a tool call on that call, and the tools are Qloo first.
  Each response records its upstream calls (`meta.upstream`), and the dashboard shows the
  request behind every pick.
- **The reason is Qloo's, or it says so.** The reason line comes from Qloo's explainability,
  which names the entities that drove a pick. Qloo doesn't attribute tags, so when a pick
  matches the guest's cuisine the reason says "tagged Thai" as a fact about the place, and when
  nothing is attributed it says "Strong match for your overall taste". Nothing is made up.
- **Taste changes the answer, measurably.** Without taste, Qloo returns the town's popular
  list. With it, the guest's list moved away from that one for every simulated caller in the
  latest live battery run: 12 of 12 run, 3 held back by the call cap (2026-10-22,
  `npm run battery -- --live`).
- **The innkeeper's panels are the callers' own tastes.** The ids each caller resolved add up to
  a fingerprint, and the heatmap, demographics, and the callers' lean list are asked of that, behind a
  five-call floor.

Every capability, the parameters we send, and what we measured live: [docs/QLOO.md](docs/QLOO.md).
Where every number on this page comes from: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

## What the innkeeper gets

- **A concierge that knows their favorites.** Eleven questions in the builder, including the
  local spots they love and why (the concierge quotes the reason), a choice of two voices,
  Harper or Maybelle, a preview, then publish. Twelve guardrails are locked on and can't be
  switched off: it says it's automated, it says the call is recorded, and it never speaks a
  door code, takes a payment, or names a place that didn't come from Qloo, Ticketmaster, or
  the innkeeper's own notes.
- **A dashboard.** Calls, the text a guest gets and where every line of it came from, and area
  insights. Panels about guest tastes stay dark until five calls are in.
- **A brief.** One printable page for the front desk, with room cards that tear off the bottom.

## What it never does

- **Sends personal data to Qloo.** Every outbound parameter passes an allowlist first: ids,
  tags, coordinates, filters, and the guest's own words for a taste (80 characters at most).
  A taste mention shaped like an email, a phone number, or a room number is refused, by
  parameter name and by value, before it leaves the server. The concierge never asks a name.
- **Keeps a caller's number.** The session log stores a keyed hash of it, never the number,
  never a name, never a transcript.
- **Texts anyone but the caller.** The recipient is bound to the number that called, not
  chosen by the model, and one number gets at most three texts an hour.
- **Commits Qloo data.** The fixtures in `server/fixtures/` are hand-written fakes with
  fictional places. Real responses live only in a private, gitignored cache.

The whole data flow, one table: [docs/PRIVACY.md](docs/PRIVACY.md).

## Honest limits

1. **Hours go stale.** Picks come from place data, and places change their hours. The
   concierge never invents an opening hour, but it can't promise one either.
2. **Speech recognition gets names wrong.** Each match carries a confidence, the concierge
   says the name back in its next line, and a name the tools can't find gets one "what is it
   most like?" instead of a guess.
3. **Distances are as the crow flies,** from the inn's coordinates. The concierge says "about a
   quarter mile", never "five minutes", because it doesn't know the streets.
4. **The reason names artists and films, not moods.** Qloo's explainability attributes entity
   signals only; across 90 live results, a tag was attributed 0 times. So the reason line
   names the entity, the cuisine is enforced as a filter instead of hoped for as a signal, and
   the call trace shows everything else that was sent. Details: [docs/LEARNED.md](docs/LEARNED.md).
5. **Demographics describe people who share these tastes nearby,** not this inn's guests. The
   callers' fingerprint is a small, self-selected sample, which is why every panel shows its
   call count and stays dark under five.
6. **Hackathon keys are switched off after the event.** Cache freeze (`CACHE_FREEZE=1`) keeps a
   pre-warmed demo answering the questions it was asked while the key was live, and nothing new.

## Tested

```bash
npm test                         # unit and contract suite, offline, mock transports
npm run smoke:dashboard          # boots the server, loads the pages a judge opens
npm run battery -- --mock        # fifteen simulated callers and two two-call sequences, sixteen criteria, offline
```

The battery plays callers against the tool server in the order the voice agent calls the
tools and scores each call: every name resolved or said unresolved, every pick inside the
radius, every pick with a reason, the text under 320 characters, every outbound parameter
through the allowlist, and seven more. With a key, `--live` runs the same callers against
Qloo. What each layer checks and how to read a scorecard: [docs/TESTING.md](docs/TESTING.md).

## What's in the repo

| Path | What it is |
|---|---|
| [`server/`](server/README.md) | The tool server the voice line calls: nine tools over Qloo, Ticketmaster, and Twilio, a PII guard, a private cache, the dashboard API, and the battery. |
| `dashboard/` | The landing page, the builder, the innkeeper dashboard, and the printable brief (React, Vite). |
| [`compiler/`](compiler/README.md) | Turns an innkeeper's answers and a persona into a voice agent definition, then lints it. |
| [`template/`](template/concierge.md) | The concierge prompt, with its locked rules. |
| [`personas/`](personas/README.md) | Harper and Maybelle. |
| `config/` | The config schema and the demo inn. |
| [`docs/`](docs/ARCHITECTURE.md) | Architecture, how we use Qloo, what we learned, testing, privacy, measurements. |
| [`QLOO-NOTES.md`](QLOO-NOTES.md) | Every Qloo shape we read from the docs, and how each held up live. |
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
