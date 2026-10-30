// The call on the landing page, in the words of a real call to Marisol's line on 2026-10-30
// (the caller is an actor; every line from the concierge is hers, trimmed for length, never
// reworded). `at` is milliseconds from the start of the scene; `who` is 'concierge' or 'guest'.
// The concierge never reads out a wifi password or a door code, here or on a real call.

export const CALL_LINES = [
  { at: 0, who: 'concierge', text: 'This is Marisol, your automated concierge at Casa Coralina, who am I speaking with?' },
  { at: 2400, who: 'guest', text: 'Hey Marisol, it\'s Danny. My wife Carmen and I just walked in. This place is gorgeous.' },
  { at: 5200, who: 'concierge', text: 'Hi Danny, welcome in! Just so you know, this call is being recorded so I can give you the best service possible going forward.' },
  { at: 8200, who: 'guest', text: 'Quick one first, what time\'s checkout Sunday?' },
  { at: 9800, who: 'concierge', text: 'Checkout is ten in the morning Sunday. Want me to help plan your night while I have you?' },
  { at: 12200, who: 'guest', text: 'Carmen wants live Latin music. I\'m more of a funk and soul guy, somewhere we can actually dance.' },
  { at: 15200, who: 'concierge', text: 'Cubaocho Museum & Performing Arts Center, a lively art museum in Little Havana with live music and a rum bar. Does that sound like your kind of place?' },
  { at: 18800, who: 'guest', text: 'Oh, that sounds amazing. One more, somewhere Cuban for dinner before.' },
  { at: 21200, who: 'concierge', text: 'El Cristo Restaurant, a lively Cuban spot on Calle Ocho serving classic dishes all day. How does that sound?' },
  { at: 24200, who: 'guest', text: 'Perfect. Can you text me those two?' },
  { at: 25800, who: 'concierge', text: 'It\'s on your phone, take a look.' },
];

/** When the text lands, then the picks page, in ms from the start. */
export const SMS_AT = 27200;
export const PAGE_AT = 28800;

/** The text that call sent, as compose_itinerary wrote it (the picks link is shortened here). */
export const SMS_BODY = 'Bellhop Concierge: Tonight:\n- El Cristo Restaurant, lively cuban restaurant\n- Cubaocho Museum & Performing Arts Center, lively art museum\nTap for links: concierge.southernsky.cloud/p/zwK08X\nvia Qloo + Ticketmaster. Reply STOP to opt out.';

export const PICKS = [
  { name: 'Cubaocho Museum & Performing Arts Center', detail: 'Little Havana, live music and a rum bar', why: 'Live Latin music, somewhere you can dance.' },
  { name: 'El Cristo Restaurant', detail: 'Calle Ocho, classic Cuban dishes', why: 'Cuban for dinner before, nothing fancy.' },
];
