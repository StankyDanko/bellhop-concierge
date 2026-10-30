# For the judges

The four criteria, equally weighted, and where each one can be checked. Every number here has
its command or source in [MEASUREMENTS.md](MEASUREMENTS.md).

## Technological implementation: how thoroughly Qloo is used

- **Thirteen Qloo capabilities in the shipped code,** each with the parameters we send and what
  the live API did: [QLOO.md](QLOO.md). The list is `CAPABILITIES` in
  `dashboard/src/content/landing.js`, and each entry is found in the server by the grep in
  MEASUREMENTS.md.
- **Every request goes through one client and one allowlist:** `server/lib/qloo.js` after
  `server/lib/pii-guard.js`. Each tool response records its upstream calls (`meta.upstream`).
- **Checked against the live API, not just the docs.** Ten of thirteen guessed shapes matched
  on key day, compare differed and was fixed: [`QLOO-NOTES.md`](../QLOO-NOTES.md).
- **A battery plays callers against the tools** and scores each call on the battery criteria,
  offline or live: `npm run battery -- --mock`, explained in [TESTING.md](TESTING.md).
- **It's live right now:** `curl -s https://concierge.southernsky.cloud/health`.

## Design: a complete, coherent product

- **Three ways in, one product.** A guest calls (833) 658-4321 and gets a text from the same
  number. An owner opens the
  [dashboard](https://concierge.southernsky.cloud/property/miami) and the
  [printable brief](https://concierge.southernsky.cloud/property/miami/brief). A new property
  starts at the [builder](https://concierge.southernsky.cloud/build).
- **One config file per property** ([`config/examples/`](../config/examples/)), compiled into a
  linted voice agent by [`bin/compile.js`](../bin/compile.js). Twelve guardrails are locked on.
- **The conversation is designed, not just prompted.** One pick at a time, no "name a favorite"
  questions, the guest's reaction steers the next pick. The rules live in
  [`template/concierge.md`](../template/concierge.md) and are held line by line across the
  inn, rental, and road templates by tests in `compiler/test/`.

## Potential impact: a real problem for a real audience

- **The audience:** small inns and short-term rentals, where nobody staffs a desk at 11pm.
- **The problem is measurable:** "property and area information" is 9.0% of 10 million guest
  messages (Conduit, "What 10 million guest messages are about",
  https://www.conduit.ai/blog/what-10-million-guest-messages-are-about, read 2026-10-22).
- **A rental's stay questions are answered in the owner's own words** (`stay_info`), and door
  codes and wifi passwords are never spoken.
- **Privacy is a floor, not a setting:** caller numbers stored only as a keyed hash, texts only
  to the number that called, taste panels dark below five calls. [PRIVACY.md](PRIVACY.md).

## Quality of the idea: a creative, non-obvious use of Qloo

- **A phone call as the interface to a taste graph.** The guest never fills in a profile; a
  show mentioned in passing becomes a Qloo id.
- **The no-taste contrast.** Every place call runs again with no taste, so the owner sees what
  the guest's taste changed, measured as a whole list, not one top pick.
- **Cross-domain on a call:** a band picks a film, a film picks a place, and Qloo's similar
  artists meet Ticketmaster's calendar for "fans of the band you named also love this act,
  playing Friday".
- **What the live API taught us**, written down so the next builder starts ahead:
  [LEARNED.md](LEARNED.md).
