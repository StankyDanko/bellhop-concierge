# Personas

A persona is the voice the concierge speaks in. The innkeeper picks one in the intake (Q3), and the
compiler folds its compiled sections into the agent prompt. Two inn personas ship here as demo personas,
plus the road persona that answers the main line:

| Persona | Who she is | Pick her for | Humor ceiling |
|---|---|---|---|
| [Harper](harper.md) | The night desk. Calm, dry, makes a bet about your taste. | The default. City inns, boutique hotels, any innkeeper who wants a good front desk. | 1 |
| [Maybelle](maybelle.md) | A Southern hostess who keeps the neighborhood in her head. | Southern inns, garden bed and breakfasts, talkative innkeepers. | 2 |
| [Hollis](road.md) | The road concierge. Asks where you are tonight, then plays the same game. | The main line, for a caller anywhere in the United States. Not offered to innkeepers. | 1 |

Hollis has `mode: road`. A road persona compiles through `template/road.md` instead of
`template/concierge.md`: there is no inn, so the first question is the city and state, every place
tool takes that locality instead of fixed coordinates, and one transfer reaches the inn edition when
a caller asks for the inn demo. `compiler/test/road-template.test.js` holds the two templates
together line by line, so a fix to one cannot skip the other.

The innkeeper's `humor_level` (0 to 2) is capped by the persona's ceiling, so an innkeeper who asks for
more humor than a persona carries gets that persona's maximum, never more.

## File format

Each persona is one Markdown file:

- **Front matter**: `id`, `display_name`, `humor_ceiling`, `tts_stability`, `mode` (`inn`, the
  default, or `road`), and `opener`, the first message the agent speaks. The opener must name the
  persona, say it is an automated concierge, say the call is recorded, and ask for one band (a road
  persona asks for the city and state instead), in two sentences at most.
- **Human sections** (anything not marked compiled): the voice bible for whoever tunes it.
- **`## ... (compiled)` sections**: copied into the prompt word for word. They follow the same
  rules the compiler lints for: no dashes, no web addresses, no phone numbers, no word "live",
  short sentences, one question per turn. A worked example in a prompt outweighs any rule
  written next to it, so the sample lines are the most important text in the file.

- **`## Example call checks`** (not compiled): one line per example call, `- <title>: n, n, n`,
  giving how many named things the caller has said after each of their turns. A test uses it
  to hold every example call to the stop rule (see `compiler/README.md`).

Slots allowed inside a persona: `{{property_name}}` and `{{handoff_name}}`.

## Adding one

Write the file, add its id to `PERSONA_IDS` in `config/schema.js`, and run the tests: the
compile tests run every persona through the linter. Then listen to it on the real voice
before anyone else does. Text that reads well can still sound wrong spoken.

## The full library

These two are the demo set for the picker in this reference implementation. The hosted
Bellhop product carries a larger persona library and builds custom personas for an innkeeper; that
library and the process behind it are not part of this repository.
