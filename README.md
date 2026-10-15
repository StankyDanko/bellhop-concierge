# Bellhop Concierge

The concierge line for small inns, boutique hotels, and rental hosts: one phone number on the room
card. A guest calls, a personable front-desk voice learns what they're into in about a minute, and
Qloo's taste graph plus live event data turn that into a "tonight and this weekend" itinerary by
text, with a reason for every pick. The host builds their own concierge by talking to it, previews
it, and publishes it. Over time the host sees anonymous, aggregate taste intelligence about their
guests.

This is the open reference implementation of the Concierge edition of Bellhop, SouthernSky's phone
receptionist. It is licensed under AGPL-3.0 (see LICENSE). Built for the Qloo Agentic Hackathon,
October 2026.

## What is here

| Path | What it is | Status |
|---|---|---|
| [`server/`](server/README.md) | The tool server the voice agent calls: taste resolution, nearby picks, cross-domain picks, live events, the text-message composer, and area insights for the host dashboard. Qloo and Ticketmaster clients with a mock layer and a private cache. | working, mock mode |
| [`config/`](config/schema.js) | The host config schema (`schema.js`, generated `schema.json`) and a demo inn in Savannah, GA. | working |
| [`personas/`](personas/README.md) | Two demo personas, Harper and Maybelle: voice bibles and sample lines. | working |
| [`template/`](template/concierge.md) | The sanitized concierge prompt template with its locked guardrails. | working |
| [`compiler/`](compiler/README.md) | Turns a host config and a persona into an ElevenLabs agent definition, then lints it. | working |
| `docs/` | Architecture and setup docs | in progress |

## Quick start

```bash
npm install
npm test       # offline test suite
npm run mock   # tool server on :8787 using synthetic fixtures, no API keys needed
npm run compile -- config/examples/demo-inn.json   # the demo inn as an agent definition
```

See [server/README.md](server/README.md) for the endpoint contracts, live and cache-only
modes, and how each Qloo capability is used.

Qloo response data is never committed to this repository. Cached responses live in
`server/data/`, which is gitignored.
