# Roadmap

What's built, what's being built, and what waits on the Qloo key. Short on purpose.

## Shipped

All of it on October 15, 2026, in this order (`git log --reverse` has the details):

- **The tool server.** Taste resolution, places near the inn, cross-domain picks, live events,
  the text composer, and area insights, over Qloo and Ticketmaster. A PII guard on every
  outbound Qloo parameter. A private cache with mock, live, and cache-only modes.
- **The compiler, the template, and two personas.** An innkeeper's answers and a persona go in,
  a linted voice agent definition comes out. Harper and Maybelle.
- **Texts and the session log.** `send_sms` reports success only on a real send, to the number
  that called. `log_session` stores a keyed hash of the caller, never the number.
- **The dashboard, deployed.** The landing page, the builder, and the innkeeper dashboard at
  [concierge.southernsky.cloud](https://concierge.southernsky.cloud).
- **The plus-one.** One question for the guest's companion, each pick scored for both people,
  and at least one pick they'll both like.
- **The receipts.** The Qloo calls behind every session, and the counterfactual: what the guest
  would have heard without their tastes, on the dashboard.
- **The brief.** One printable page for the front desk, with tear-off room cards.

## In flight

- **The guest taste fingerprint.** Each call already resolves what the guest loves into Qloo
  ids. Pooled per inn (ids only, no names or numbers), those become the signal for every
  dashboard panel, so the insights are about the people who call this number instead of the zip
  code. Shown with its sample size, because a small inn gets a small sample.

## After the key arrives

First, `npm run probe:qloo` against the live host, and fix whatever shapes the docs got wrong.
Then, in rough order:

- **Your callers vs your town.** `/v2/analysis/compare` with the fingerprint on one side and
  the town's top places on the other: what this inn's guests like that the town doesn't.
- **Event and flyer fit.** The innkeeper pastes a few local events; each is scored against the
  fingerprint with the same filter the plus-one scoring uses. Which flyers go in the rooms.
- **The tag card.** The place tags the fingerprint leans toward, with the town's beside them.
  What to leave on the breakfast table.
- **A heatmap from the fingerprint,** not from a generic query. Which town the day-trip cards
  point toward.
- **Trend arrows.** What's rising among the callers' tastes this season, if `/v2/trending` has
  enough signal at inn scale. Probe first.

## Not doing

- **Accounts and logins** in this repo. Writes on the demo take an admin token, and that is enough for now.
- **Review or revenue claims.** Nothing here says what it will earn anyone.
- **Pricing.** Not in this repository.
