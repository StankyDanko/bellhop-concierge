# Bellhop Concierge dashboard: SCREENS

Companion to `DESIGN-LANGUAGE.md` (component names in CAPS refer to its section 5). Ship date **2026-10-28**; hackathon deadline Oct 30. Priority: **MUST** = the entry fails or looks fake without it; **SHOULD** = materially strengthens judging; **COULD** = cut first.
Data contracts: `server/README.md` (tool responses; `area_insights` per-section `status`). Build order from R8: compiler + ConfigCard (typing alone works) -> concierge agent + tool server -> voice builder -> preview/ring-back -> insight panels.

Global shell (all screens): 390 = single column, 16px gutters, bottom tab bar (4 slots) on dashboard screens only; 768 = 2-col card grids; 1440 = 1152px centered column, left rail on dashboard screens. Wordmark top-left, theme toggle and GitHub link top-right (text link, 48px target). Footer: "Bellhop Concierge, an edition of Bellhop by SouthernSky. AGPL-3.0. Source." and the sourcing line "Picks from Qloo taste graph and Ticketmaster."

---

## 0. Route map and cut order

| Route | Screen | Priority |
|---|---|---|
| `/` | 1. Demo landing | **MUST** |
| `/build` | 2. Builder (Q0 to ring-back) | **MUST** (typed path); voice **SHOULD** |
| `/p/:id` | 3a. Property home + sessions | **SHOULD** |
| `/p/:id/insights` | 3b. Area insights | **MUST** at least one live panel (Qloo on the innkeeper side is part of the 25% score) |
| `/p/:id/settings` | 4. Settings | **COULD** (read-only version SHOULD) |

If time runs out, cut in this order: Settings write paths, Compare panel, "what to stock" suggestions, voice interview (keep typed), heatmap map tiles (keep ranked list), sessions detail view, theme toggle. Never cut: the number, the LiveBadge truth check, WhyChip, Preview call (browser fallback acceptable), locked-guardrail list, the 5-session gate, SampleBadge.

---

## 1. Demo landing for judges (`/`) **MUST**

**Purpose:** in 5 seconds a judge knows the number, that it is live, what it does, and that Qloo is why (DESIGN-LANGUAGE section 9). No login.

**Primary action:** Call the number (phone: `tel:` full-width brass bar; desktop: "Ring my phone"). **Secondary:** "Build your own concierge" (to `/build`).

**Layout at 390 (single column, in order):**
1. Wordmark row (24px) + theme toggle + "GitHub" link.
2. Eyebrow (Micro): `THE ALDER HOUSE, SAMPLE INN` (name TBD) and LiveBadge `Answering now` on the same row (wraps).
3. h1 (Display): "Call the front desk." Lead sentence: "Tell it two things you love. It texts you three places nearby, with the reason for each."
4. PhoneNumberCard: the number at `--text-number` (36px, fits on one line at 390 with tabular-nums; verify the width audit), caption "Free to call. The inn is fictional; the calls and texts are real."
5. Qloo line (purple SourceChip + one sentence): "Picks come from Qloo's taste graph, with the reason shown. Live events from Ticketmaster."
6. Sticky bottom bar (appears when card scrolls away): "Call now" brass button + number text, `--pad-safe-bottom`.
7. How it works strip: 3 numbered bricks stacked: "1. You call and name something you love." / "2. Qloo's taste graph finds places and events you'd love, near the inn." / "3. You get one text with each pick and why." Each brick has a Micro source tag (`VOICE`, `QLOO`, `SMS`).
8. "Built on Qloo" explainability panel (below): sample PickCard from a fixture (SAMPLE badge) with an expanded WhyChip showing driver bars; caption "This is a real response shape from the tool server. Calls use live Qloo." (only if true at ship; otherwise say "example").
9. "Eight Qloo capabilities, one call" compact list: the 8 rows from the server README table, collapsed to name + one-line purpose + endpoint in mono, collapsed by default on phone behind "See how Qloo is used (8)".
10. For owners: one card, "Run your own concierge in about three minutes." with "Build yours" button, and the honest-limits line.
11. Footer.

**Layout at 1440:** 12-col grid inside 1152px. Hero is two columns: left (7 cols) = eyebrow, h1, Lead, PhoneNumberCard (number at 72px), Qloo line, secondary CTA; right (5 cols) = the sample PickCard with expanded WhyChip, already visible without scrolling (this is what makes "Qloo is load-bearing" land in the first screenful). Below: How it works as a 3-up row; the 8-capabilities as a two-column list; the "For owners" band; footer. Desktop-only: "Copy number" and "Ring my phone" replace `tel:`.

**States:** number always rendered; LiveBadge `Line busy` (amber) if `/health` fails, copy "Line busy, try again in a minute" without removing the number; Qloo panel falls back to the SAMPLE badge; ring-back opens the PreviewCall sheet (ring-back variant: single scripted guest "Surprise me", no property config needed).

**Cut list:** the 8-capabilities list (COULD), sticky call bar (SHOULD; falls back to normal button), theme toggle (COULD). Never cut: items 2 to 5 and 8.

---

## 2. Builder (`/build`) **MUST (typed), SHOULD (voice)**

A single page with a stepper, not separate routes. Steps: **Autofill, Interview, Guardrails, Persona, Preview, Publish**. Progress is the 5-brick completeness meter (ConfigCard) plus a step label; users can jump back to any completed step.

### 2.1 Q0 Link autofill **SHOULD**
- **Primary action:** "Read my listing" (after paste). **Skip:** "Skip, I'll tell you about the place."
- 390: heading "Start from your website or listing", one link field (paste-aware, `inputmode=url`), helper "A website, Google Maps, or Airbnb link. We only read public pages.", Primary button in the thumb zone, a text link to skip under it.
- 1440: two panes. Left: the field and button. Right: the (empty) ConfigCard in its dashed empty state, so the destination is visible before anything exists.
- States: reading (skeleton rows appear in the ConfigCard), partial, failed (copy in DESIGN-LANGUAGE 5.15).
- Cut: whole step (COULD) but it is the fastest wow after the ring-back; keep if the scraper is a day's work or less.

### 2.2 Interview **MUST (typed path)**
- **Primary action:** answer the question ("Save and continue"). Voice is secondary-primary: MicButton beside the field.
- 390: single column. Stack: Micro `QUESTION 3 OF 11` + bricks, question (Lead), builder caption bubble, typed answer field (always visible), MicButton (full-width pill, thumb zone), "Skip for now". ConfigCard is NOT shown inline; instead a persistent bottom pill "Your card, 3 of 5" opens it as a bottom sheet (shows live fills, provenance badges). The row that just landed flashes in the pill.
- 1440: two panes, interview left (5 cols), ConfigCard right (7 cols, sticky). Fields fill live with the accent-tint fade; ProvenanceBadges visible on every row.
- Exact-string questions (Q4, Q5, Q10 phone) show a typed field only plus a "Confirm" button; voice may prefill but the badge stays `SPOKEN` until confirmed (then `CONFIRMED`).
- Q list: Q1 name/where/feel, Q2 guests, Q3 voice and humor (hands off to the Persona picker), Q4 access, Q5 wifi/house, Q6 rules, Q7 3 to 5 favorite spots with why, Q8 avoid list, Q9 top five questions, Q10 handoff, Q11 permissions and languages (R8). For the Oct 28 build, **MUST** = Q1, Q2, Q4, Q7, Q10; **SHOULD** = Q5, Q6, Q8, Q11; **COULD** = Q9 (seed 5 default FAQs instead).
- Read-back card: "Here's what I heard. Anything wrong?" ConfigCard + "Looks right".
- States: mic denied, network lost, STT low confidence on a proper noun ("Did you say 'Weatherford Street'?" with confirm/retype), injection-flag (a field containing instruction-like text shows an amber note "We kept this as text only, it won't change how your concierge behaves"; it is quoted data, never instructions).
- Cut: voice (keep typed; the card works by typing alone), phone-number version of the builder (already cut by R8), document upload (cut).

### 2.3 Guardrails **MUST**
- **Primary action:** "Looks right" (continue).
- 390: GuardrailList: "Yours to adjust" (5 toggle rows: humor 3-step, languages chips, avoid-topics add-only chip input, offers on/off, can-send-itinerary on/off) then "Always on (9 rules)" collapsed with count; tapping expands locked hatched rows with the visible *why*.
- 1440: two columns: adjustable left, locked right (open by default). The locked column is the trust signal; its header says "Always on. Not adjustable, by design."
- Locked list contents come from the shared locked-rules data (identity disclosure, emergency handoff, no codes to unverified callers, no payments, no price/refund promises, no safety-of-neighborhood claims, recording notice, claims limited to sources, no guest personal data in logs). States: add-only avoid input rejects duplicates and shows chip errors inline; Publish lint failure blocks (copy in 5.6).
- Cut: languages and offers toggles (COULD), keep humor, avoid-topics, escalation (handoff lives here as well as Settings).

### 2.4 Persona picker **MUST**
- **Primary action:** "Choose Harper" (button label updates to the selected name).
- 390: one-column PersonaCards (Harper, Maybelle, custom placeholder); audio sample button 48px per card; selected = brass border + "Selected".
- 1440: 3-up grid, equal height.
- States: sample loading/playing/failed; none selected disables Continue with helper "Pick a voice to continue."
- Cut: audio samples (fall back to text sample line), custom card (COULD).

### 2.5 Preview and ring-back **MUST (the wow; browser fallback acceptable)**
- **Primary action:** "Ring my phone" (secondary: "Talk to it here" browser call).
- 390: bottom sheet; setup (scripted guest radio cards, phone field, consent line), ringing, on-call (timer, captions, End), done (SmsPreview + two PickCards with WhyChips), failures (no answer, invalid number, rate limit, server down).
- 1440: centered dialog with a split: left = call state, right = the result as it arrives (picks and SmsPreview), so a judge watching sees Qloo's reasons appear as the call happens.
- Gate: Publish disabled until a preview completes; TrustLadder stays on Test until then.
- Cut order: scripted-guest choice (keep one), live captions, the second PickCard; never cut the browser-call fallback.

### 2.6 Publish **MUST**
- **Primary action:** "Publish concierge".
- Screen: summary of the ConfigCard (read-only, with a "changes since preview" diff chip), TrustLadder (default Test; innkeeper can choose Suggest or Live after the preview), a single confirm sheet ("Publish The Alder House? ..."), success state: LiveBadge flips and the PhoneNumberCard for THEIR number appears with "Put this on your room card" and a **Copy number** and **Print a room card** (COULD) action.
- 390: single column, Publish button pinned in the thumb zone; 1440: summary left, ladder and publish right.
- Failure: "We couldn't publish. Nothing changed and your answers are saved." Retry.

---

## 3. Property dashboard (`/p/:id`)

Tab bar (390) / left rail (1440): Home, Sessions, Insights, Settings. Header strip on every page: property name, LiveBadge, trust level chip, and at most one amber summary chip.

### 3a. Home and sessions list **SHOULD**
- **Primary action:** "Preview call" (to rerun) when empty; "Open session" when not.
- Content: three StatTiles in a row of bricks (Calls this week, Texts sent, Handoffs to you), each with unit, delta vs last week, and a source line `OWN LOG`; below, Sessions list (aggregate only: time, party size, outcome chip `Itinerary sent` / `Handed off` / `No answer needed`, topic tags like "live music, thai"; **no names, no numbers, no transcripts**), and the SmsPreview of the most recent itinerary.
- 390: tiles stack 1 per row (or 3 compact in a row if each fits at 108px; verify via container query), sessions as card-stack, SmsPreview collapsed behind "See the text a guest got".
- 1440: tiles 3-up, sessions as a table (Time, Party, Outcome, Topics, Texted; right-aligned tabular numbers) with SmsPreview in a right column.
- States: **empty** ("No calls yet. Share your number on a room card, or make a preview call to see how a call looks here." Action: "Make a preview call"); loading skeleton rows; error ("We couldn't load your calls. The line is still answering."); the demo property shows SAMPLE DATA badges on seeded sessions.
- Cut: sessions detail view (COULD), tiles delta (COULD), print room card.

### 3b. Area insights **MUST (at least heatmap or demographics live, with degraded states designed)**
- **Primary action:** "Compare two kinds of guests" (opens Compare setup) or, when gated, "Preview what this will look like".
- **First card: "Your callers' taste fingerprint"** (`/api/properties/:id/fingerprint`, component `Fingerprint.jsx`, styles `fingerprint.css`). Brass top rule. The basis line "People who call this number, not the town."; the sample size in digits and words ("9 calls, all time", then "(nine calls that named a taste)"); the top tastes as brass chips, each with the number of calls that named it; the Micro caveat "Qloo describes people who share these tastes around here, not your callers."; a mono footer naming the Qloo params it feeds (`signal.interests.entities`, `signal.interests.tags`). Gated (`basis: none`): gate bricks, "Your fingerprint appears after 5 calls that name a taste. You have N.", and "Preview it with sample callers" (48px target). Sample: SAMPLE tag + SAMPLE DATA badge and "Fictional callers, to show how it looks."
- **Basis tag on every panel below it:** `CALLERS n` (brass tint), `SAMPLE` (dashed), or `AREA` (neutral, no guest signal sent). Gated panels carry no tag. The brief's "What guests asked for" section repeats the sample-size line.
- Panels: Demographics, Heatmap, Compare (now "Your callers vs. your town": the fingerprint against the most popular places near the inn), then "What to stock or partner with" (suggestion cards derived from the insights, each phrased as an observation plus an action: "Guests who named live music lean 25 to 34 (+0.13 vs area). Try a record player and a local-band flyer." Each suggestion carries its Qloo source chip and is labeled `A SUGGESTION, NOT A FORECAST`; we do not claim revenue or review lift).
- 390: panels stack; Heatmap shows a map card at 4:3 (aspect-ratio reserved) with the ranked "Hottest 3 areas" list below as the accessible, scrollable equivalent; Compare shows the three biggest differences as sentences first.
- 1440: Heatmap left (7 cols) with Demographics right (5 cols); Compare full width; suggestions as a 3-up card row.
- States (all from DESIGN-LANGUAGE 5.13), shown for every panel: loading skeleton; **fewer-than-5-sessions gate** (the panel never partially renders; the innkeeper sees the count "2 of 5"); empty; skipped; degraded (amber, last good data with AS OF); error. SampleBadge on the demo property's seeded data. The page header shows one summary chip, e.g. "1 of 3 panels delayed".
- Interaction: radius control (1, 2, 5 mi segmented), interests selector chips (from the sessions' resolved taste, aggregate), "Refresh" with `AS OF` timestamp. No guest-level drill-down exists, by design.
- Cut: Compare (COULD), suggestions (SHOULD, cheap: text templates over panel data), radius control (COULD), map tiles (use a cell grid with a legend if tiles are not ready).

### 3c. Innkeeper brief and room card (`/property/:id/brief`) **SHOULD**

**Purpose:** the work product an innkeeper forwards. One letter page they print or save as PDF and hand to a co-owner, a manager, or a guest-services hire, with a tear-off room card at the bottom. Reached from the "Print the innkeeper brief" link in the property header.

- **Primary action:** "Print or save as PDF" (`window.print()`, disabled until every section has loaded). **Secondary:** "Back to the front desk".
- **Content, top to bottom:** header (eyebrow `FRONT DESK CONCIERGE BRIEF`, inn name, town, date prepared, the number in tabular figures); What it does (three plain sentences); What guests asked for (top tastes from `/sessions`); What the area is strong in (ranked lists from `/insights`: taste affinity by block, ages leaning in, two kinds of guests); How picks are made (Qloo, Ticketmaster, the innkeeper's own picks, then the honest-limits line); What it will not do (the locked list from `/api/guardrails`); the room cards.
- **Room cards:** a 3:2 card (4 by 6 proportions) and a 5:3 nightstand card (3 by 5 proportions), each inside a dashed cut line: inn name, "Need a plan tonight?", "Call the front desk concierge", the number, "Tell it two things you love. It texts you three places nearby." The large card adds "An automated line. Calls are recorded." Hairlines only, no fills: they survive a black and white printer.
- **Paper, in every theme:** the sheet uses the paper and slate tokens directly, so a dark-theme print is still black on white.
- **Print:** `@page { size: letter; margin: 0.6in }`; topbar, footer and toolbar hidden; no section breaks across a page. Gate: one page in both the zero-session state and an eight-session state.
- 390: single column, cards stacked full width, print button full width. 1440: the letter sheet centered on the page background.
- **States:** below five calls, guest tastes show the sample guest with a SAMPLE DATA badge and "Shown as an example until five guests have called."; any insights section that is gated, skipped, or degraded is left off with one line saying why (sections sharing a reason share the line); a property without a published number gets "Your number appears here once it is published" and a blank write-in line on the cards (the demo shows "Number goes live at submission" when no demo number is set); an unreachable `/api/guardrails` falls back to the same module the server serves.
- **Never:** a review lift, revenue, pricing, or "replaces a concierge". Every number on the page comes from the call log or Qloo, with its source next to it.

---

## 4. Settings (`/p/:id/settings`) **COULD (read-only SHOULD)**

- **Primary action:** "Save changes" (appears only when dirty; sticky in the thumb zone at 390).
- Sections as cards: **Numbers** (the property number with copy and "Put on a room card" actions; test numbers list; the innkeeper's handoff phone with confirm-by-text), **Trust level** (TrustLadder, same component as the builder), **Handoff** (who gets the call, hours reachable as a simple day/time editor, triggers: safety, damage, complaint, refund, cancellation are locked ON and shown as locked rows; adjustable: "also hand off when guests ask for a person"), **Concierge** (persona, humor, avoid-topics, links back to the builder steps), **Pause the line** (destructive-tint button at the bottom, outside the thumb zone, with confirm: "Pause the line? Callers will hear that the front desk is closed and your handoff number.").
- 390: stacked cards, section jump list at top (horizontal chips, scrollable inside its own container); 1440: left sub-nav (Numbers, Trust, Handoff, Concierge) with the cards to the right.
- States: unsaved changes (bar with "Save changes" and "Discard"), save success (quiet toast), validation errors inline ("US numbers need ten digits"), a phone number change requires confirmation text (state: "Sent a code to +1 (555) 013-4477").
- Cut: hours editor (use a default 9 to 5 with an edit link), every write path (ship read-only with "Edit in builder" links), Pause (keep: it is the safety valve and cheap).

---

## 4b. Privacy and Terms (`/privacy`, `/terms`) **MUST**

- **Purpose:** the two pages a carrier's toll-free review and a careful judge both expect. Plain English, short, and true to the code. Linked from the footer beside "Source", and served on a direct load (`APP_ROUTES`, checked by the smoke test).
- **Privacy, top to bottom:** when you call (automated and recorded, said first; the demo inn is fictional); what a call sends to Qloo (ids, tags, coordinates, filters; never a name, number, or room); what we keep (a keyed hash of the caller's number, the tastes and their ids, pick counts, the request record; no names, transcripts, or message bodies); the text message (offered, one per call, only to the calling number, at most three per number an hour, STOP) and, set apart, "Mobile numbers and consent are never sold, shared, or transferred to third parties for marketing."; the innkeeper dashboard (aggregates only, dark under five calls); questions (the SouthernSky site). Effective date under the title.
- **Terms:** the bridge sentence as the lead; what this is (a hackathon demo, the twenty-calls-a-day test line, no warranty); about the picks (third-party data, hours go stale); text messages (program, consent, frequency, STOP, rates); the code (AGPL-3.0, source link); questions.
- **Footer, every page:** "Source", "Privacy", "Terms" as 48px links, and once, in small type: "Bellhop Concierge is a product of SouthernSky, a service of E Brands, LLC."
- One reading column at `--prose-max` at every width; 390 keeps 16px gutters; no horizontal scroll; light and dark from theme tokens (`legal.css`).
- **Never:** pricing, revenue, outcome claims, or an email address or phone number on either page.

---

## 5. Shared fixtures needed before design is testable (small, do first)

Seeded property (name, city covered by Qloo, lat/lng), a ConfigCard JSON with provenance per field, 2 personas with a sample line, 5 and 14 session aggregates (to show both the gate and the filled state), three `area_insights` payloads (ok, one section degraded, all skipped), one `recommend_nearby` response with `why_trace.basis` of `explainability` and one of `affinity`, and one `compose_itinerary` result with a non-empty `truncation`. Mock mode (`npm run mock`) already produces the response shapes; the session aggregates and ConfigCard JSON are the new pieces.

---

## 6. Per-screen device gate (run at 390 / 768 / 1440 before calling any screen done)

Zero horizontal scroll (width audit); the number visible without scrolling on `/`; every primary reachable in the bottom third on phone; every hover affordance has a tap path; inputs >=16px; sheets scroll and trap focus; reduced-motion and dark-theme passes; every number has its source; no em dashes, no "AI" in rendered text.
