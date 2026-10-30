// The scripted call on the landing page: a written example, not a recording. Swap the lines
// for a real transcript by editing this file only. `at` is milliseconds from the start of the
// scene; `who` is 'concierge' or 'guest'. Places and the guest are fictional. The concierge
// never reads out a wifi password or a door code, here or on a real call.

export const CALL_LINES = [
  { at: 0, who: 'concierge', text: 'This is Marisol, your automated concierge at Casa Coralina. Who am I speaking with?' },
  { at: 2100, who: 'guest', text: 'Hey Marisol, it\'s Danny.' },
  { at: 3300, who: 'concierge', text: 'Hi Danny. Quick note, this call is recorded. How\'s the house treating you?' },
  { at: 5500, who: 'guest', text: 'Love it. What time is checkout?' },
  { at: 6900, who: 'concierge', text: 'Checkout is ten in the morning. Want me to plan your night?' },
  { at: 8700, who: 'guest', text: 'Yes. Live Latin music, or Carmen\'s leaving me.' },
  { at: 10500, who: 'concierge', text: 'Can\'t have that. La Clave Room, six minutes away, a salsa band at nine. Want it by text?' },
  { at: 13300, who: 'guest', text: 'Oh, that sounds amazing. Yes.' },
];

/** When the text lands, then the picks page, in ms from the start. */
export const SMS_AT = 15000;
export const PAGE_AT = 16600;

/** Shaped like a real text from compose_itinerary (server/lib/sms.js): tag, picks, one link, footer. */
export const SMS_BODY = 'Bellhop Concierge: Tonight:\n- La Clave Room, live salsa band at 9, 6 min\n- La Ventanita de Coralina, cafecito on the way\nTap for links: concierge.southernsky.cloud/p/x7Kq2\nvia Qloo + Ticketmaster. Reply STOP to opt out.';

export const PICKS = [
  { name: 'La Clave Room', detail: 'Salsa band at 9 pm, 6 minutes away', why: 'Live Latin music, like you asked.' },
  { name: 'La Ventanita de Coralina', detail: 'Owner\'s pick, on the way', why: 'A cafecito before the dancing.' },
];
