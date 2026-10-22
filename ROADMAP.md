# Roadmap

What's built, what's being built, and what's next. Short on purpose.

## Shipped

October 15 to 17, 2026 (`git log --reverse` has the details):

- **The tool server.** Taste resolution, places near the inn, cross-domain picks, live events,
  the text composer, and area insights, over Qloo and Ticketmaster. A PII guard on every
  outbound Qloo parameter. A private cache with mock, live, and cache-only modes.
- **The compiler, the template, and two personas.** An innkeeper's answers and a persona go in,
  a linted voice agent definition comes out. Harper and Maybelle.
- **Texts and the session log.** `send_sms` reports success only on a real send, to the number
  that called. `log_session` stores a keyed hash of the caller, never the number.
- **The dashboard, deployed.** The landing page, the builder, and the innkeeper dashboard at
  [concierge.southernsky.cloud](https://concierge.southernsky.cloud).
- **The plus-one.** One question for the guest's companion, and each pick scored for both people.
- **The receipts.** The Qloo calls behind every session, on the dashboard.
- **The brief.** One printable page for the front desk, with tear-off room cards.
- **The guest taste fingerprint.** Each call's resolved Qloo ids, pooled per inn (ids only, no
  names or numbers), become the signal for the innkeeper's panels, behind a five-call floor,
  with test calls left out.
- **Proof on every pick.** Places and events carry a signed token, so the text can never carry a
  claim the tools did not make.

October 22, 2026, the day the key arrived:

- **Key day.** `npm run probe:qloo` against the live API. Ten of thirteen guessed shapes matched;
  compare differed and was fixed. The record is [QLOO-NOTES.md](QLOO-NOTES.md).
- **A cuisine is a filter.** A stated cuisine goes out as a hard `filter.tags` on the place's
  genre tag, relaxed once when too few places fit. Tag search is scoped to places.
- **The whole-list contrast.** The guest's top five beside the town's popular five, instead of
  one top pick against another.
- **The rank rule for two.** "You'll both like this" when each person ranks a pick in their own
  top half; no label when a person's scores are flat.
- **Callers vs. town.** Two lean lists, what this inn's callers favor and what the town favors,
  with compare as one quiet line; a quality heatmap and named areas.
- **The battery.** Fifteen simulated callers, twelve criteria, offline or live, stopping on the
  first rate limit. See [docs/TESTING.md](docs/TESTING.md).
- **Ready for the key to go dark.** A paced pre-warm of every request shape the demo makes, and
  cache freeze to keep answering from it.

What the live API taught us along the way: [docs/LEARNED.md](docs/LEARNED.md).

## In flight

- **A second call that sounds new.** The opener, the food choice, and the bet, picked per call
  from small pools (`server/conversation/`), so a guest who calls back doesn't hear the same
  words twice. The chooser is built and tested; wiring it into the call comes next.

## Next, measured and waiting

Each of these answered live on 2026-10-22 ([docs/QLOO.md](docs/QLOO.md)); none is in the call yet.

- **A table you can book.** `filter.external.exists=resy` changes the list completely.
- **Worth the drive.** `diversify.by` city spreads picks across nearby towns.
- **Name a town, not a pin.** `filter.location.query` lets an innkeeper type a town.
- **Event and flyer fit.** The innkeeper pastes a few local events; each is scored against the
  fingerprint with the same filter the plus-one scoring uses.

## Not doing

- **Trend arrows,** for now. `/v2/trending` came back empty for the window we tried and doesn't
  take places.
- **Accounts and logins** in this repo. Writes on the demo take an admin token, and that is
  enough for now.
- **Review or revenue claims.** Nothing here says what it will earn anyone.
- **Pricing.** Not in this repository.
