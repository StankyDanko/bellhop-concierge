# Roadmap

What's built, what's being built, and what's next. Short on purpose.

## Shipped

October 15 to 17, 2026 (`git log --reverse` has the details):

- **The tool server.** Taste resolution, places near the inn, cross-domain picks, live events,
  the text composer, and area insights, over Qloo and Ticketmaster. A PII guard on every
  outbound Qloo parameter. A private cache with mock, live, and cache-only modes.
- **The compiler and the template.** An innkeeper's answers and a persona go in, a linted voice
  agent definition comes out. The first two inn voices shipped here; the builder still offers
  them.
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

October 23 to 29, 2026:

- **Any city in the US.** Hollis, the road concierge, answers the public toll-free line,
  (833) 658-4321, and finds out where the caller is as they talk (`template/road.md`).
- **Short-term rentals.** Casa Coralina, a fictional Miami rental, with Marisol answering the
  stay questions from the owner's own stay sheet (`stay_info`) before the evening ones.
- **One concierge per number.** No transfers between concierges; each property's line is
  compiled from its own config file.
- **One pick at a time.** The concierge says one pick and its reason, then lets the guest react,
  and the reaction steers the next pick. Tastes come from the chat, never from a quiz.
- **A text with a picks page.** Picks by name and one short link to a page that opens each one.
- **A second call that picks up the first.** Returning-guest memory (first name, town, tastes,
  what was texted), cleared at once by `forget_guest`. The opener and the mood choice are picked
  per call from small pools (`server/conversation/`), so a caller doesn't hear the same words
  twice, and picks already offered stay out.
- **Fresher picks.** Films and shows lean recent unless the guest asks for older, and a
  "lesser known" ask caps popularity.

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
