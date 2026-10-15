# Personas

A persona is the voice the concierge speaks in. The host picks one in the intake (Q3), and the
compiler folds its compiled sections into the agent prompt. Two ship here as demo personas:

| Persona | Who she is | Pick her for | Humor ceiling |
|---|---|---|---|
| [Harper](harper.md) | The night desk. Calm, dry, makes a bet about your taste. | The default. City inns, boutique hotels, any host who wants a good front desk. | 1 |
| [Maybelle](maybelle.md) | A Southern hostess who keeps the neighborhood in her head. | Southern inns, garden bed and breakfasts, talkative hosts. | 2 |

The host's `humor_level` (0 to 2) is capped by the persona's ceiling, so a host who asks for
more humor than a persona carries gets that persona's maximum, never more.

## File format

Each persona is one Markdown file:

- **Front matter**: `id`, `display_name`, `humor_ceiling`, `tts_stability`, and `opener`, the
  first message the agent speaks. The opener must name the persona, say it is an automated
  concierge, say the call is recorded, and ask for one band, in two sentences at most.
- **Human sections** (anything not marked compiled): the voice bible for whoever tunes it.
- **`## ... (compiled)` sections**: copied into the prompt word for word. They follow the same
  rules the compiler lints for: no dashes, no web addresses, no phone numbers, no word "live",
  short sentences, one question per turn. A worked example in a prompt outweighs any rule
  written next to it, so the sample lines are the most important text in the file.

Slots allowed inside a persona: `{{property_name}}` and `{{handoff_name}}`.

## Adding one

Write the file, add its id to `PERSONA_IDS` in `config/schema.js`, and run the tests: the
compile tests run every persona through the linter. Then listen to it on the real voice
before anyone else does. Text that reads well can still sound wrong spoken.

## The full library

These two are the demo set for the picker in this reference implementation. The hosted
Bellhop product carries a larger persona library and builds custom personas for a host; that
library and the process behind it are not part of this repository.
