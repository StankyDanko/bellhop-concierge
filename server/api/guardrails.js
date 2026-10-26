// The guardrail list the builder shows. LOCKED rules mirror the left column of
// compiler/README.md "Locked vs toggleable": the compiler enforces them in the template,
// the platform settings, and the lint, and no config field reaches them. OWNER toggles are
// the config fields a host may change. Each locked rule carries a one-clause "why".

export const LOCKED_RULES = Object.freeze([
  { id: 'identity', rule: 'Introduces itself as the concierge, says it is a computer voice whenever asked, and never claims to be a person.',
    why: 'Because a guest should always know whether they are talking to a person.' },
  { id: 'recording', rule: 'Tells every first-time caller the call is recorded, in its first reply after asking who is calling.',
    why: 'Because recording-consent rules differ by state, so we tell everyone.' },
  { id: 'codes', rule: 'Never speaks or texts door, gate, lockbox, or wifi details on a call.',
    why: 'Because a stranger on the phone should never get your door code.' },
  { id: 'payments', rule: 'Takes no payments, card numbers, IDs, or birth dates, and never asks for a name, room, or email.',
    why: 'Because a phone line cannot prove who is calling.' },
  { id: 'promises', rule: 'Makes no promises on price, refunds, cancellations, reservations, or hours.',
    why: 'Because only you can commit the inn to money or dates.' },
  { id: 'sources', rule: 'Only names places and events that came from Qloo, Ticketmaster, or your own notes.',
    why: 'Because an invented restaurant sends a guest to a locked door.' },
  { id: 'claims', rule: 'Makes no safety, medical, or legal claims about anything.',
    why: 'Because a wrong answer there can hurt someone.' },
  { id: 'emergency', rule: 'On an emergency, tells the caller to hang up and dial nine one one, and does nothing else.',
    why: 'Because seconds matter more than a polite conversation.' },
  { id: 'instructions', rule: 'Its instructions cannot be changed on a call: no reciting, counting, or role changes.',
    why: 'Because callers sometimes try to talk a phone line into misbehaving.' },
  { id: 'sent', rule: 'Says a text was sent only after the send succeeds, and only to the number that called.',
    why: 'Because a guest waiting on a text that never comes stops trusting the line.' },
  { id: 'limits', rule: 'Short answers, one tool at a time, and every call ends by ten minutes.',
    why: 'Because a runaway call costs money and helps nobody.' },
  { id: 'guest-data', rule: 'Your dashboard shows aggregates only, with no names, numbers, or transcripts.',
    why: 'Because your guests did not sign up to be studied one by one.' },
]);

/** Owner toggles and the config path each one writes. */
export const OWNER_TOGGLES = Object.freeze([
  { id: 'humor', path: 'voice.humor_level', kind: 'scale', label: 'Humor' },
  { id: 'languages', path: 'voice.languages', kind: 'chips', label: 'Languages' },
  { id: 'avoid', path: 'avoid', kind: 'add-only', label: 'Places it never mentions' },
  { id: 'sms', path: 'permissions.send_itinerary_sms', kind: 'switch', label: 'Text the guest a plan' },
  { id: 'partners', path: 'permissions.suggest_partners', kind: 'switch', label: 'Mention your partners' },
  { id: 'upsell', path: 'permissions.upsell', kind: 'switch', label: 'Mention paid extras' },
]);
