# Bellhop Concierge: DESIGN-LANGUAGE

Edition of Bellhop (SouthernSky). Public AGPL reference dashboard. Written 2026-10-15 as the design spec, and kept as the record of why the pages look the way they do.
Precedence: this file > register > brand constants > the house design doctrine. Rule IDs in brackets (H1, C7, MB8...) are doctrine rules; cite them in review.

## As built (2026-10-22)

The spec ran ahead of the build in a few places. Where this file and the running pages differ, the pages are the truth, and this list says where:

- **The demo inn is The Juniper House,** Savannah, GA. The test line is (706) 810-9262, Harper answering, capped at twenty calls a day. Earlier drafts below used a placeholder inn name and a different number.
- **Guests name three things,** not two. Every "two things" in the original copy now reads "three things" on the site and on the room cards.
- **No ring-back or in-browser call.** The landing offers the number to call. Sections 5.1 and 5.9 describe a flow that was designed and not built.
- **Two sources besides the innkeeper: Qloo and Ticketmaster.** No other place source is used, so the blue source chip only ever says Ticketmaster.
- **Light is the default theme,** with dark a full toggle, as recommended in section 1.
- **Landing layout** follows section 9's order of volume; its exact copy lives in `dashboard/src/pages/Landing.jsx`.
Token files: `concierge.tokens.css` (this edition) layered over `tokens.css` (verbatim copy of the house sheet, so the public repo is self-contained). Components reference semantic tokens only [C1].

---

## 1. Register decision

**Name: FRONT DESK.** A fourth register, derived, not blended: the calm density of the tool register slowed down to a hospitality pace, with one marketing-grade moment (the number) and nothing else loud.

**Why (README step 1: how long is a visit, who is it for).** Two audiences, one surface: a judge who spends 40 seconds deciding whether this is real (marketing instinct), and an inn owner who spends 20 minutes once to build their concierge and then 2 minutes a week reading it (tool instinct). Neither wants the neon marketing register (it reads as a game, and a boutique owner will not trust their front door to it) or the house tool register (dense, mono, terminal; it reads as a developer product, and it is dark-only). Torn rule says "pick tool"; we pick tool's calm and discard its density. Feel target: *a well-run small hotel's front desk: warm paper, one brass bell, nothing out of place, staff who say exactly what they know and where they learned it.* Deadpan-premium, legibility-first.

**What Front Desk keeps from the brand constants [brand section 1-8]:**
- Green means ALIVE (the line is answering). It is the only thing that pulses. [brand 1, 5]
- Purple means CREATIVE: here, taste-graph data and the concierge's character (persona). [brand 2]
- Tracked-uppercase dim micro-labels and mono for data/IDs/numbers. [brand 4]
- Brick modularity: same-shaped cards on a grid, visible seams, 1px hairlines, 4px atoms. [brand 6]
- Color = meaning; short, quiet, verb-first copy. [brand 7, 8]

**Deliberate deviations (flagged, not hidden):**
1. **Light is the default theme; dark is a full toggle.** Brand says "dark-native, no light mode." Reasons: (a) the buyer is a hospitality operator opening a link on a phone in daylight; (b) a boutique-hospitality read is paper and brass, not terminal; (c) a Devpost judge arrives from a white page and a dark flash is a jolt. Dark ships and passes the same audits (judges can toggle; the tokens.css `prefers-color-scheme` path stays intact). Decided: light default. The cost of reverting is one attribute (`data-theme="dark"` on `<html>`).
2. **Accent is brass gold (`--gold-500` / `--gold-700`), not green, for "interactive."** This is the house `tokens.css` accent, so it is not a new hex. Green stays reserved for ALIVE so the one pulsing dot on the page can never be mistaken for a button. [C9]
3. **Sans body, mono only for data.** Brand allows display-mono + sans; Front Desk uses sans for everything a human reads and mono only for numbers, IDs, timestamps, provenance labels. [T8]

Register law [R4]: one register per surface. The demo landing and the dashboard are the SAME register at different volume (landing: bigger type, more air; dashboard: standard). Never add scanlines, neon, or ambient glow to either.

---

## 2. Color

### 2.1 Semantic table (mandatory: a color with no row may not appear) [C1, C3]

| Role | Token | Means | Never means |
|---|---|---|---|
| Ink / surfaces | `--color-bg/surface/surface-2/surface-3`, `--color-border` | structure | emphasis |
| Text | `--color-text`, `--color-text-dim`, `--color-text-faint` | 3 tiers only | decoration |
| **Accent (brass)** | `--color-accent`, `-hover`, `-tint`, `--color-focus` | interactive: buttons, links, selected, focus ring | success, decoration |
| **Live (green)** | `--color-live`, `--color-success` | the line is answering right now; a completed good thing | "go" buttons |
| **Taste (purple)** | `--color-taste`, `-tint` | data that came from Qloo's taste graph; the persona's character | primary actions |
| Info (blue) | `--color-info` | a non-Qloo external source (Ticketmaster); neutral notices | links |
| Warning (amber) | `--color-warning` | degraded, partial, "you should look at this" | errors |
| Danger (red) | `--color-danger` | failed, destructive confirm, locked-out | locks (locks are neutral) |

Locked guardrails are NEUTRAL (hatched surface + lock icon), never red or amber: a lock is a promise, not a problem.

Source coloring is a feature: every number and pick carries a source chip. Purple chip = "Qloo". Blue chip = "Ticketmaster". Neutral chip = "you said it" / "typed" / "default". A judge learns in one glance what Qloo contributed.

### 2.2 Values and measured contrast (WCAG 2.x ratios computed 2026-10-15)

Dark (tokens.css values; `--color-bg #0b0d12`, `--color-surface #12151c`, `--color-surface-2 #171b24`)

| Pair | on bg | on surface | on surface-2 | Verdict |
|---|---|---|---|---|
| text `#e6e9f0` | 16.0 | 15.0 | 14.2 | pass |
| text-dim `#98a1b3` | 7.5 | 7.0 | 6.6 | pass |
| text-faint `#6b7488` | 4.1 | 3.9 | 3.7 | non-essential only [C7] |
| accent `#d4a437` | 8.5 | 8.0 | 7.5 | pass |
| on-accent `#171106` on accent fill | 8.2 | | | pass |
| green / amber / red / blue | 11.2 / 11.6 / 7.0 / 7.6 | | | pass |
| taste `#a78bfa` | 7.1 | 6.7 | 6.3 | pass |
| chip text on own 14% tint (surface) | gold 6.3, green 7.9, purple 5.4, red 5.4, blue 5.8 | | | pass |
| field border `#6b7488` | 4.1 | 3.9 | 3.7 | pass (3:1 UI) |

Light (`--color-bg #f7f8fa`, `--color-surface #ffffff`, `--color-surface-2 #eef0f5`)

| Pair | on bg | on surface | on surface-2 | Verdict |
|---|---|---|---|---|
| text `#14171f` | 16.9 | 17.9 | 15.7 | pass |
| text-dim `#4d5566` | 7.0 | 7.5 | 6.6 | pass |
| text-faint `#7b8396` | 3.6 | 3.8 | 3.3 | non-essential only |
| accent text/link `#8a6413` (gold-700) | 5.1 | 5.4 | 4.7 | pass |
| white on accent fill `#8a6413` | 5.4 | | | pass |
| taste `#6240c4` | 6.5 | 6.9 | 6.0 | pass |
| red `#b91c1c` / blue `#1d4ed8` | 6.1 / 6.3 | | | pass |
| **green `#15803d` / amber `#a16207` as TEXT on tint** | 4.3 / 4.2 | | | **FAIL** as plain text, so chips use `--color-success-text #166534` (6.2) and `--color-warning-text #854d0e` (5.9); the base greens/ambers are for dots, bars, and icons only (3:1 UI) |
| gold chip text `#7a560f` on gold tint | 5.6 | | | pass |
| field border `#7b8396` | 3.6 | 3.8 | 3.3 | pass (3:1 UI) |

Hairline `--color-border` is decorative grouping (1.3-1.5:1 by design); never the only cue for an input edge (that is `--color-field-border`).

### 2.3 60/30/10 [C2]
Landing, squinted: 60% bg/surface paper, 30% text and cards, <=10% brass + the green live dot + one purple Qloo panel. The number is ink-colored, not brass: weight and size are its only volume knob [H3].

---

## 3. Depth, radius, spacing

- **Edge strategy: hairline borders** [D1], 1px `--color-border`. Resting cards: no shadow. Floating layers (sheet, popover, toast, call modal): `--shadow-float`. Light theme may use `--shadow-raise` on the ONE focal card per screen (the number card, the config card on desktop) and nowhere else.
- **Ladder** [D4]: page (`bg`) -> card (`surface`) -> inset/hover (`surface-2`) -> pressed/input (`surface-3`) -> floating.
- **Radius** [P1]: 8 controls and chips-with-text (`--r-control`), 12 cards (`--r-card`), 16 bottom sheets (`--r-sheet`), pill for status chips and the mic button. Nested radius = outer - padding.
- **Spacing**: 4px atoms from tokens.css (`--space-1..16`). Inside-card gaps 8/12/16; between cards 16 (390) / 24 (1440); between page sections `--space-section`. Label to field 4, field to field 16, group to group 24+ [S2]. Page column `--page-max` 1152px, centered; prose `--prose-max` [T3].
- **Glow** [D5]: ONLY `--glow-live` on the live dot, the live badge, and the active-call ring, and only in dark. In light, "alive" is the pulse ring (a transform/opacity animation), never a halo. The brass number is NOT glowing; static things do not glow.
- **z-index**: use the tokens.css ladder; call modal = `--z-modal`, toasts = `--z-toast`.

---

## 4. Type

Two families, zero webfonts (house rule: no external requests): `--font-sans` for everything a person reads; `--font-mono` for numbers that must align or be copied, IDs, timestamps, provenance micro-labels.

| Step | Token | Size (390 -> 1440) | Weight / leading / tracking | Used for |
|---|---|---|---|---|
| Number | `--text-number` | 36 -> 72 | 600 / 1.0 / -0.02em, tabular-nums | the phone number, once per page |
| Display | `--text-2xl` | 26 -> 40 | 600 / 1.15 / -0.02em | page h1 only |
| Title | `--text-xl` | 20 -> 28 | 600 / 1.15 | section h2 |
| Lead | `--text-lg` | 17 -> 20 | 400 / 1.4 | the one explainer sentence under h1 |
| Body | `--text-md` | 15 -> 16 | 400 / 1.55 | prose, field values, all inputs (>=16px on touch) |
| UI | `--text-sm` | 13 -> 14 | 500 / 1.35 | buttons, chips, row labels, table cells |
| Micro | `--text-xs` | 12 -> 13 | 500 / 1.2, UPPERCASE, +0.08em, mono for provenance only | eyebrow labels, badges |

Input and textarea font-size is `max(16px, var(--text-md))` [MB7]. Tabular-nums on every number [T7]. Uppercase always tracked [T5]. Weights 400/500/600 only [T6]. Sentence case everywhere except Micro.

**Numbers carry sources [IN4 + house rule].** A number is never rendered alone. The component is `<Stat value unit source asOf>`: value in body-or-larger, then unit/delta, then a Micro source line ("Qloo, demographics, 2 mi radius" / "Ticketmaster, as of 6:12 pm"). A stat with no source prop fails the build lint (see section 12).

---

## 5. Component set

All components are designed in the states: rest, hover (`@media (hover:hover) and (pointer:fine)` only, one wrapper project-wide [MB6]), focus-visible (`--ring`), active (one step deeper), disabled (reduced opacity, `not-allowed`, still >=3:1). Hit areas >=48px on coarse pointers via `--touch-min` [MB1].

### 5.1 PhoneNumberCard ("Call your concierge")
The one focal point of the landing [H1]. Layout: Micro eyebrow naming the demo inn -> number in `--text-number`, `font-variant-numeric: tabular-nums`, `<a href="tel:...">` wrapping the whole number -> one line under it in Lead size: "Tell it three things you love. It texts you three places nearby, with the reason for each." -> LiveBadge row (see below) -> actions.
- Phone (coarse pointer): the number is a 56-64px tall full-width brass button ("Call now") pinned in the bottom thumb zone with `--pad-safe-bottom` as a sticky bar once the card scrolls out of view [MB2, MB5]; the number text stays in the card.
- Desktop (hover+fine): `tel:` is useless on a laptop, so the card offers "Copy number" and "Ring my phone" (opens the ring-back sheet, 5.9). Both are real buttons, same size as each other, "Ring my phone" is the brass primary.
- States: hover = border to `--color-accent`; focus ring around the whole card link; **offline** (agent unreachable) = badge flips to amber `Line busy, try again in a minute` and the number stays visible and tappable; never remove the number.
- Seen-first rule: the number must be visible without scrolling at 390x844 and 1440x900, above everything except a 24px wordmark.

### 5.2 LiveBadge
Pill: dot + label. States: `Answering now` (green dot, pulse ring 2s ease-out loop, transform+opacity only; dark may add `--glow-live`), `Test mode` (brass outline, no pulse), `Paused` (neutral), `Line busy` (amber, icon). Always label + dot, never color alone [ST7]. Reduced motion: dot is static, ring replaced by a solid 2px outline [M6]. The pulse is the only continuous animation on the page [M5].
Truth rule: LiveBadge reads `GET /health` (and a last-call timestamp) on load and every 30 s; it NEVER claims `Answering now` from a hard-coded value. A judge who calls and gets nothing while the badge says live ends the demo.

### 5.3 ConfigCard (the live editable card) with provenance badges
The builder's right-hand artifact: a titled list of fields grouped into 5 cells (Place, Guests, Voice, House, Handoff). Row = Micro label (left, dim) / value (body) / ProvenanceBadge / edit affordance.
- **ProvenanceBadge** (Micro, mono, 24px tall pill, neutral surface-2 with 1px border, leading 12px glyph; tap opens a popover with the exact source). Five values:
  - `SPOKEN` (mic glyph): popover shows the quote and timestamp ("'we're a six-room inn above the old bank'", 2:07).
  - `TYPED` (keyboard glyph).
  - `FROM SITE` (link glyph): the URL and what was read.
  - `DEFAULT` (dashed outline): we filled it; "Change me" is the only call to action.
  - `CONFIRMED` (check glyph): innkeeper tapped confirm on an exact string (phone, wifi, times). Exact strings are never `SPOKEN`-final; STT is not trusted for them [R8 5.4].
  Distinct by glyph and label, not color [ST7].
- **Row states.** Empty: dashed `--color-field-border`, placeholder written as the question ("Where do guests park?"). Filling (voice just landed): a 280ms background fade from `--color-accent-tint` to transparent (state change the user caused [M3]). Unconfirmed exact string: amber dot + "Tap to confirm". Edited by hand: badge flips to `TYPED`. Conflict (voice overwrote a typed value): the typed value wins; the spoken one appears as a one-line "Use what I said instead?" undo chip.
- **Secret fields** (wifi, access codes): masked, a lock-eye toggle, labeled `NEVER SPOKEN ALOUD`; delivered by text to the booking phone only (R8 locked rule).
- **Completeness meter**: a segmented bar (one brick per cell, 5 bricks, brand modularity) with text "3 of 5 sections ready", never a bare percentage. Preview unlocks at 3 of 5 minimum.
- Container query: the card lays out as label-above-value under 28rem container width, label-beside-value above it [MB10]. No viewport media queries inside it.

### 5.4 MicButton (hold nothing: tap to talk)
Pill, 56px tall (64 on phone), the secondary-to-primary control in the interview; the typed answer box is always visible beside or under it, never hidden behind it [R8: voice must never be the only path].
States, each with label + icon + one motion meaning:
1. **Idle**: mic glyph + "Talk to the builder" (brass outline, brass text).
2. **Asking permission**: neutral, label "Allow the microphone to continue", plus an inline "Type instead" link. Never a blank screen waiting on a browser prompt.
3. **Listening**: solid brass fill, level meter bars (4 bars, transform scaleY from real input level), label "Listening". 
4. **Thinking**: bars freeze to a thin line, label "Writing that down", 1 inline loader maximum [ST4].
5. **Speaking** (builder talking): purple outline (character voice), label "Builder is talking", tap to interrupt.
6. **Denied / no mic / insecure context**: amber tint, "Your browser can't use the microphone here. Type your answers and we'll build the same thing." The text input takes focus automatically.
7. **Network lost**: amber, "Lost the connection. What you've told us is saved. Reconnect or keep typing."
Hit target 48px min; keyboard: Space toggles, Esc stops. `aria-pressed` and a live-region announcing state changes.

### 5.5 InterviewPanel
Question card (Micro `QUESTION 3 OF 11`, question in Lead size), the typed answer field (always visible, `rows=3`, 16px), MicButton, a "Skip for now" text button. Progress = 11 small bricks. The builder's last utterance appears as a captioned bubble (so a deaf or muted-laptop judge can follow). Read-back at the end is a dedicated card: "Here's what I heard. Anything wrong?" with the ConfigCard embedded and a single brass "Looks right" button.

### 5.6 GuardrailList (toggleable vs locked)
Two groups in one list, separated by space, not a divider [H7]: **Yours to adjust** then **Always on**.
- **Toggle row**: label, one-line plain-English consequence ("Humor: dry. Light jokes, never about guests"), control. Controls are switches for on/off, 3-step segmented for humor/warmth, an add-only chip input for avoid-topics. Switch = 52x32 visual, 48px hit, label/ state text beside ("On"/"Off"), never color alone.
- **Locked row**: `--pattern-locked` hatched surface, lock icon (16px, text-dim), the rule in body text, a one-line *why* in dim ("Because a stranger on the phone should never get your door code"). No switch, no disabled-switch (a greyed switch implies "could be enabled"). A tooltip-free design: the why is visible, not hover-only [MB6]. Rows are focusable (tabindex 0) with an accessible name "Locked: <rule>. <why>".
- The locked set is the trust signal to judges and owners: show it open by default on desktop, collapsed behind "Always on (9 rules)" on phone with the count in the button.
- The locked list renders from the same data the compiler lints against; if a locked rule is missing at Publish, Publish is blocked with `The safety rules are incomplete. This is a bug on our side, nothing was published.`

### 5.7 PersonaCard / PersonaPicker
Grid of same-shaped cards (1 col at 390, 2 at 768, 3 at 1440; minimum 2 cards: Harper, Maybelle, per PLAN section 10). Card: name, one-line character ("Dry night-desk insider. Understatement, never a joke at your expense."), a 6-word sample line in mono quotes, an audio sample button ("Hear Harper", 48px), a purple tint character stripe (4px top edge, the only purple fill on the card). Selected = 1px brass border via `box-shadow: 0 0 0 1px` plus a check glyph and "Selected" text [D2, ST7]. A final dashed "Custom voice" card, disabled, label `COMING LATER` (never a dead button; it has a sentence: "Want a voice that sounds like your place? Tell us.").
Audio sample states: idle / loading (inline) / playing (bars) / failed ("Couldn't play that sample. The text above is what they sound like.").

### 5.8 TrustLadder (Test / Suggest / Live)
A 3-step segmented control with a track line connecting steps, each step a card-button with title + one sentence:
- `Test`: "Only you can reach it. Call it as much as you like."
- `Suggest`: "Guests can call. Texts go to you first; you approve each one." (the intermediate rung owners already understand, per R8 pattern 3)
- `Live`: "Guests call, the concierge texts them directly."
Moving up needs a confirm sheet; moving to Live is disabled until one Preview call has completed (reason shown inline: "Make one preview call first."). Current rung: brass; reached-but-not-current: neutral check; LiveBadge mirrors it. The ladder is horizontal at >=40rem container width and a vertical stack below [MB10]. Never use red/green for rungs.

### 5.9 PreviewCall and RingBack (a flow with states)
Presented as a bottom sheet on phone, a centered dialog on desktop (`--z-modal`, scrim, focus trap, Esc closes unless a call is mid-ring).
- **Setup**: scripted guest chosen from 2 radio cards ("Couple arriving late, likes live music and natural wine" / "Family of four, kids, rainy day"), the innkeeper's phone field (`type=tel`, `inputmode=tel`, `autocomplete=tel`, E.164 normalize on blur), a consent line: "We'll call this number once, for this test, and delete it afterwards." The only privacy promise that appears is one the server actually performs (verify before ship).
- **Ringing**: big phone glyph with ring pulse (transform/opacity), text "Calling +1 (555) 013-4477", Cancel button. Timeout at 45 s.
- **On the call**: LiveBadge variant `On a call`, an elapsed timer (mono, tabular), live captions if available, an End button (destructive tint, outside the thumb-zone primary spot).
- **Done**: "Here's what your guest got." Shows the SMS itinerary preview (5.11) and the picks with their why chips; actions "Call again" / "Publish".
- **Failed states, each with a human sentence and one action**: no answer ("It rang out. Try again or use the browser call instead"), invalid number ("That doesn't look like a phone number. US numbers need ten digits."), carrier blocked, rate limit ("You've used your 3 test calls for now. Try the browser call; it's free."), server down.
- **Browser call fallback**: same sheet, "Talk to it here" button (reuses MicButton states). Always offered next to "Ring my phone" so a locked-down venue wifi or a judge who won't type a phone number still gets the wow moment.
- Publish is disabled until a preview (either kind) completed.

### 5.10 WhyChip and PickCard (the explainability atom)

As built, the landing renders this atom as `WhyPick` (`dashboard/src/components/WhyPick.jsx`); PickCard and WhyChip were retired. Tag matches carry no score, because Qloo's explainability never attributes tags.
The most important small component in the product [Qloo is load-bearing].
- **PickCard**: name (UI weight 600), meta line (distance, price, rating, each with a unit), then the **WhyChip**, then a SourceChip. Max 4 lines at 390.
- **WhyChip**: full-width-in-card, purple tint (`--color-taste-tint`) with `--color-taste-text`, 12px radius control, leading "why" glyph (a small branching-node icon), text is `place.why` verbatim from the server ("Fans of Sturgill Simpson love it; tagged Thai"). Tap/click expands in place (280ms height by transform-safe grid-rows trick or a cut) to show **drivers as bars**: one row per `why_trace.drivers` with the input's name and a bar proportional to `score`, labeled with the score as a number. Footer in Micro: `QLOO EXPLAINABILITY, AFFINITY 0.91`.
- **Honest fallback**: when `why_trace.basis` is `affinity`, the chip renders "Strong match for your overall taste" in neutral (not purple), with a Micro `QLOO AFFINITY, NO PER-INPUT REASON`. We never dress an unexplained result as explained.
- **SourceChip**: `QLOO` (purple outline) for places/cross-domain picks, `TICKETMASTER` (info blue outline) for events (event cards have no taste why; they show "Live listing, Fri 8pm" in the chip slot). Never a logo; a text chip with the service name.
- Expanded and collapsed are both keyboard operable (`button`, `aria-expanded`).

### 5.11 SmsPreview
A phone-shaped bubble (not a phone illustration): max-width 320px, surface-2, 16px radius with the tail corner at 4px, body in mono at `--text-sm` because it is literal text, wrapping at `ch`. Below it, Micro stats: `286 CHARACTERS, 2 SEGMENTS, GSM-7` from `compose_itinerary` (`char_count`, `segments`, `encoding`). If `truncation` is non-empty, an amber chip "Shortened to fit: trimmed reasons" listing steps in words. Links are shown as links with `https` visible. Empty: "No text yet. Make a preview call to see what a guest receives."

### 5.12 InsightPanel (aggregate taste intelligence)
Card with header (title + SourceChip + "radius 2 mi, as of date" in Micro), body, footer limits line ("Aggregate, anonymous. Based on 14 guest sessions."). Variants: Demographics (diverging bars for age and gender bands; value + unit "index vs. area average, +0.13", never a bare number), Heatmap (a map with graded cells, legend, a text list "Hottest 3 areas" as the accessible alternative), Compare (two segments side by side, the 3 biggest differences in words first, chart second). Every variant implements the five states in 5.13.

### 5.13 Insight states (every InsightPanel, no exceptions) [ST2, ST3, ST5]
Maps to server `status`:

| State | Trigger | Treatment | Copy (voice section 8) |
|---|---|---|---|
| Loading | request in flight | skeleton shaped like the chart, reserved height, single static shimmer-free skeleton in reduced motion | none (skeleton only); after 4s: "Still asking Qloo..." |
| **Gate: fewer than 5 sessions** | sessions < 5 | the panel does NOT render partial data. Quiet card: ring of 5 empty bricks, filled count shown (2 of 5 filled), no chart | "Taste insights switch on after 5 guest sessions. You have 2. This keeps any single guest from being picked out of the numbers." Action: "Preview what it will look like" opens the SAMPLE panel (5.14). |
| Empty (>=5 but no signal) | `status: empty` | muted illustration-free card | "Not enough overlap in what your guests named to draw a map yet. It tends to sharpen after a few more calls." |
| Skipped | `status: skipped` | neutral info row, not an error | "Add a few things your guests love and this section fills in." with "Add interests" action |
| Degraded | `status: degraded` + `reason` | amber tint banner on the panel only, other panels unaffected, last good data kept visible with an `AS OF <time>` Micro | "Qloo didn't answer this time, so we're showing what we had at 4:12 pm. We'll try again in a minute." Action: "Try again now" |
| Error (whole call) | 5xx / network | danger tint (restrained), no raw error | "We couldn't reach the insights service. Your concierge keeps answering calls as normal." Action: "Try again" |
| Demographics unavailable | `demographics.status: degraded` with the API host not supporting it | panel shows the amber state, not hidden | "Age and gender lean isn't available for this area right now." |

A degraded section never blanks its siblings; the page header shows at most ONE amber summary chip ("1 of 3 panels delayed").

### 5.14 SampleBadge (honesty about demo data)
Any panel showing seeded/demo data wears a persistent `SAMPLE DATA` Micro badge (neutral, dashed outline) and the footer reads "Shown with example data until your first 5 guest sessions." The public demo property is real configuration but its guest sessions are seeded; the demo landing says so in plain words. We do not let a sample look like measured data. (Marks provenance as a doctrine row: MEASURED vs SAMPLE.)

### 5.15 Chips, buttons, inputs, toasts (the bricks)
- **Button hierarchy**: Primary = solid brass (one per screen region), Secondary = brass outline, Tertiary = text button in `--color-accent-text`, Destructive = danger tint then confirm. Verb labels: "Ring my phone", "Publish concierge", "Save and continue". Never "OK", "Submit", "Click here" [P7].
- **Inputs**: surface fill with `--color-field-border` edge, 8px radius, label above (Micro is for badges only; field labels are UI weight 500 in `--color-text`), helper below in dim, error below in danger-text with icon, errors never replace the label. Autocomplete and inputmode set per field [MB7].
- **Toast**: bottom (above the safe area and above the sticky call bar), 4s, success is quiet [ST6]; errors persist with a Retry.
- **Status chips**: tint fill + full-color text from the `-text` tokens + glyph [C8].
- **Link-autofill field (Q0)**: one input with a leading link glyph, paste-aware; states: idle, reading ("Reading your listing..." skeleton rows appear in the ConfigCard), partial ("Found your name and address, couldn't read the rest. Fill the gaps by talking or typing."), failed ("We couldn't open that link. Check it's public, or skip this and tell us about the place.").
- **Skeletons/empties** are always shaped like the content and carry one sentence and one action [ST3].

---

## 6. Layout system

Mobile-first at 390; the page shell is the starter-kit trilogy [MB8]: `overflow-x: hidden` on the shell, `min-width: 0` on every flex/grid ancestor, `flex-wrap` on action rows. `100svh/dvh` only, never bare `100vh` [MB9]. Scroll containers `overscroll-behavior: contain`.
- **Page-level breakpoints only for shell changes** (768 and 1024, from tokens.css notes): 390 = single column + bottom tab bar (Dashboard: Home, Sessions, Insights, Settings; 4 slots, each 48px high + safe area); 768 = same single column, 2-col card grids; >=1024 = left rail nav (replaces the tab bar) and the two-pane builder (interview left, ConfigCard right, ConfigCard sticky).
- **Components decide their own layout with `@container`** (ConfigCard, TrustLadder, PersonaPicker, InsightPanel, PickCard).
- **Tables on small widths**: Sessions list is a card-stack below 40rem container width (each row becomes a 2-line card: time + outcome chip / topics), a table above it with column priority (Time, Party, Outcome always; Picks, Texted, Duration drop first) [IN1, IN2].
- Truncation policy [IN5]: names clamp to 2 lines on cards, 1 line with ellipsis in tables with full value in `title` and in the detail view; phone numbers and IDs mid-truncate (`+1 (555) ...4477`) only in mono contexts.

---

## 7. Motion

Two durations: `--dur-fast` 140ms (hover, focus, toggle, chip) and `--dur-slow` 280ms (sheet, expand, field-fill fade, progress). Easings `--ease-out` for entering, `--ease-in` for leaving, linear only for the level meter and a real progress bar [M1, M2]. Animate `opacity` and `transform` only [M4].

| Motion | Meaning | Where |
|---|---|---|
| Pulse ring (2s loop) | alive | LiveBadge, ringing phone, listening mic |
| Slide up (sheet) | arrived from below | PreviewCall sheet, confirm sheets |
| Fade of accent tint | a value just landed | ConfigCard field after speech |
| Cross-fade | state change | Mic states, insight skeleton to data |
| None | everything else | no page-load animation, no hover lift (M7), no parallax, no confetti |

Publish success is the biggest motion allowed: the LiveBadge changes to `Answering now` with one pulse and a toast; no celebration. `prefers-reduced-motion`: durations resolve to 1ms (tokens.css), pulses become static outlines, expand becomes a cut, nothing conveys by motion alone [M6].

---

## 8. Voice of the interface (copy)

Warm, concrete, never cute. Hotel-staff register: first names, plain verbs, no exclamation marks, no jokes in errors, no emoji, no em dashes (use a period, comma, or colon), no "oops", never the two-letter abbreviation for the field. Vocabulary: **"your concierge"**, **"the taste graph"**, **"intelligent software"** only if a noun is truly needed; never that abbreviation, "bot", or "assistant" in UI copy. (The concierge still says it is an automated assistant to callers, per the locked rule; that is spoken, owned by the prompt template, not by this UI.) Every number: unit and source adjacent.

Pattern: *what happened, in human words. What is safe. What to do next (one action).*

| Situation | Copy |
|---|---|
| Landing h1 | "Call the front desk at The Juniper House." |
| Landing lead | "Tell it three things you love. It texts you three places nearby, with the reason for each." |
| Qloo explainer | "Every pick comes from Qloo's taste graph or a live Ticketmaster listing. The concierge never makes up a place." |
| Empty sessions | "No calls yet. Share your number on a room card, or make a preview call to see how a call looks here." |
| Empty insights (gate) | "Taste insights switch on after 5 guest sessions. You have 2." |
| Mic denied | "Your browser can't use the microphone here. Type your answers and we'll build the same thing." |
| Autofill failed | "We couldn't open that link. Check it's public, or skip this and tell us about the place." |
| Preview first | "Make one preview call first. Then you can go live." |
| Publish confirm | "Publish The Juniper House? Guests who call this number will reach your concierge. You can pause it any time." Buttons: "Publish concierge" / "Not yet" |
| Pause | "Pause the line? Callers will hear that the front desk is closed and your handoff number." |
| Qloo down | "Qloo didn't answer this time. The concierge still takes calls, and falls back to the innkeeper's own picks." |
| Server error | "Something broke on our side. Nothing you entered was lost." |
| Success toast | "Saved." / "Published. The line is answering." |
| Locked-rule why | one clause, causal: "Because...", never "For security reasons" |

Never: "Oops!", "Awesome!", "Magic", "Seamless", "Powered by" anything, "Unlock", "Supercharge", "Just". Never blame the user ("Invalid input"): say what is needed ("US numbers need ten digits").

---

## 9. The judge-first-impression rule

In the first 5 seconds, at 390x844 and at 1440x900, **without scrolling or tapping**, the page communicates four things in this order of volume:

1. **The number** (largest element on the page, `--text-number`, tappable). *Volume 1.*
2. **It is live** (LiveBadge `Answering now`, truthful per 5.2). *Volume 2, smallest bright thing on the page.*
3. **What it does** (one Lead sentence: "Tell it three things you love. It texts you three places nearby, with the reason for each."). *Volume 2.*
4. **Qloo is load-bearing** (a single quiet purple line directly under the sentence: "Picks from Qloo's taste graph, with the reason shown. Live events from Ticketmaster." plus the SourceChip row). On desktop the sample PickCard with expanded WhyChip is already visible to the right of the number card; on phone it is the first block below the fold and a peek of it shows at the fold edge. *Volume 3.*

Squint test [H1]: exactly one thing survives, the number. Rules that follow:
- No hero image, no carousel, no video autoplay, no animated headline, no sign-up wall, no cookie banner in front of the number. The demo needs no login.
- Wordmark (Bellhop Concierge, 24px) and a "GitHub" text link are the only chrome in the first screen. "AGPL-3.0" appears in the footer and the repo link, not the hero.
- Honesty line near the fold: "The demo inn is fictional. Calls and texts are real." Plain, factual, one sentence; the claim must be true at ship.
- The 3-minute make-your-own path is a secondary CTA beside the number card ("Build your own concierge"), never competing in volume.

**As built (2026-10-22).** The landing is seven sections, one H1 and six H2s, readable top to bottom without a call:
1. Hero: "The front desk concierge for small inns.", the product sentence, and the number card naming the sample inn (no `tel:` link and an honest pending line while no number is set).
2. "What your words changed.": the no-taste list and the guest's list side by side, with lines joining the places on both (`QlooTrace.jsx` `Counterfactual`).
3. "How a call becomes a plan.": every request one call makes, in order, with a stepper the reader starts (`CallRail`).
4. "Why this pick.": the reason, the named drivers, tag matches as "matches your words" with no score, and the exact request behind a disclosure (`WhyPick.jsx`).
5. "What your callers love.": the area card, labeled with its sample size and badge, dark below five calls (`AreaCard.jsx`).
6. "Safe by default." and 7. "Run your own concierge."
The checks for all of it ship as `npm run verify:landing`, which `npm run smoke:dashboard` also runs.

---

## 10. States checklist (design these before decoration) [ST1-ST7]

Per screen the design must show: loading, empty, partial/degraded, error, success. Required non-happy states in every mockup: the "fewer than 5 sessions" gate, one amber degraded insight panel, mic denied, a locked guardrail row, a failed ring-back. Every interactive element: hover (fine pointer only), focus-visible ring, active, disabled. Touch path for every hover-revealed control: provenance badge popovers open on tap; drivers expand on tap; nothing is tooltip-only.

---

## 11. Accessibility and device law

- Focus ring `--ring` (2px bg gap + 2px brass) on all interactive elements; never `outline:none` without it [ST1].
- Keyboard drives the whole builder: Tab order = visual order; MicButton Space/Esc; sheets trap focus and Esc closes; ConfigCard rows are `button`s to edit.
- Live regions: interview captions `aria-live=polite`; LiveBadge changes `role=status`; call timer is NOT live-announced every second.
- Tap targets >=44px (48 on coarse via token); adjacent targets >=8px apart [MB1]. Primaries in the bottom third on phone; destructive (End call, Pause line, Delete) out of it [MB2]. Safe-area padding on sticky bars [MB5].
- Inputs >=16px; `viewport-fit=cover`; `color-scheme` set; selection and caret follow the accent [P3]; thin styled scrollbars in dark [P2].
- Images: sample/persona art has alt; decorative empty alt. Reserve aspect-ratio boxes for the heatmap [P5].
- Verify with a width audit at 390/768/1440 (`scrollWidth <= clientWidth` on the root element); that audit is the pre-ship gate [F02].

---

## 12. Review bar and build lints (cheap, mechanical, run before every ship)

1. `grep -nE '#[0-9a-fA-F]{3,8}' src --include=*.css --include=*.tsx --include=*.jsx | grep -v tokens` = zero hits [C1].
2. `grep -n 'outline: *none'` = zero without a replacement [ST1].
3. `grep -nE '\b100vh\b'` = zero; use `svh/dvh` [MB9].
4. `grep -rniE '\bAI\b|\bA\.I\.'` in rendered copy and `src` strings = zero [house rule]. Em dash check: a grep for the em dash character (U+2014) in rendered copy = zero.
5. Every `<Stat>`/number has `source` (type-enforced prop, or a lint) [house rule].
6. Contrast table in section 2.2 re-run if any token changes.
7. Width audit at 390/768/1440: `scrollWidth <= clientWidth` on `document.documentElement` [MB8].
8. Polish bar 12/12 run on the implemented DOM, not the mock [F02].

Self-assessment of this design language against the polish bar: designed on paper only, so items 6, 8, 9 (state audit, motion audit, device audit) are specified and must be verified on the implemented DOM. Items 1-5, 7, 11, 12 are satisfied at the specification level.

---

## 13. Decisions, settled

1. **Light default vs brand dark-native** (section 1, deviation 1): light default, dark a full toggle.
2. **Demo inn name and city:** The Juniper House, Savannah, GA.
3. **The demo number:** (706) 810-9262, a test line. It lives in one config value, so a swap is a config change, not a design change.
4. **Voice samples** for Harper and Maybelle: the builder shows a quoted sample line for each, and says the audio samples play in the hosted service.
