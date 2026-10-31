// The words on /privacy, /terms, and /sms-opt-in, in one place. The React pages render this
// module, and dashboard/scripts/build-legal.mjs renders the same module into dist/privacy.html,
// dist/terms.html, and dist/sms-opt-in.html, the copies a fetcher that runs no JavaScript
// reads. Edit here only.
//
// Every claim matches the code: server/lib/pii-guard.js (what reaches Qloo),
// server/lib/ticketmaster.js (what reaches Ticketmaster), server/lib/sessions.js (what is
// stored), server/tools/send-sms.js (who gets a text, and how often), and SESSION_GATE in
// server/api/routes.js (the five-call floor).
//
// Shapes: a page has a title, a lead, and sections. A section has blocks:
//   { p: Inline }  a paragraph       { ul: Inline[] }  a list       { key: string }  set apart
//   { quote: string }  words the concierge says, verbatim
//   { card: RoomCard }  the printed room card ({ inn, hook, call, number, line, fine })
// Inline is a string, or an array of strings and links: { text, href } leaves the site,
// { text, to } stays in it.

export const EFFECTIVE = 'October 16, 2026';
export const SITE = 'https://southernsky.cloud';
export const REPO_URL = 'https://github.com/StankyDanko/bellhop-concierge';
export const BRIDGE = 'Bellhop Concierge is a product of SouthernSky, a service of E Brands, LLC.';
export const SUPPORT_EMAIL = 'support@southernsky.cloud';
/** The toll-free line, verified for texting. Printed on the opt-in page's room card only. */
export const OPT_IN_NUMBER = '(833) 658-4321';
/** Hollis's first sentence (personas/road.md `opener`, default opener hook). */
export const OPENER = 'This is Hollis, your automated concierge, who am I speaking with?';
/** What the concierge says in its next turn on every first call (template/concierge.md, The opening). */
export const RECORDING_LINE = 'Just so you know, this call is being recorded so I can give you the best service possible going forward.';
export const OFFER_LINE = 'Want me to text the ones you liked?';
export const STOP_HELP = 'Reply STOP to opt out, HELP for help. Message and data rates may apply.';
export const SMS_SENTENCE = 'Mobile numbers and consent are never sold, shared, or transferred to third parties for marketing.';

/** The footer, shared by the app shell and the static pages. */
export const FOOTER = {
  edition: 'Bellhop Concierge, an edition of Bellhop by SouthernSky. AGPL-3.0.',
  sources: 'Picks from the Qloo taste graph and Ticketmaster.',
  affiliation: 'Not affiliated with Airbnb or any booking platform.',
  bridge: BRIDGE,
};

const questions = (extra = []) => ({
  id: 'questions',
  heading: 'Questions',
  blocks: [{ p: ['Reach SouthernSky at ', { text: 'southernsky.cloud', href: SITE }, '.', ...extra] }],
});

export const PRIVACY = {
  path: '/privacy',
  title: 'Privacy',
  docTitle: 'Privacy, Bellhop Concierge',
  description: 'What a call to Bellhop Concierge sends, what it keeps, and how the text works.',
  lead: 'We keep what the dashboard needs to count and rank tastes, and a short memory of your last call so the concierge can pick up where you left off. Here is the whole of it.',
  sections: [
    {
      id: 'call',
      heading: 'When you call',
      blocks: [{ ul: [
        'The concierge says it is automated in its first sentence and asks who is calling, then says the call is recorded in its very next line. If you ask whether it is a person, it also says it is a computer voice.',
        "The call runs on ElevenLabs' voice platform, which records it. This server never stores a transcript or a recording.",
        'Two demo lines: Hollis, a road concierge for any US city, at (833) 658-4321, and Marisol at (706) 810-9262 for Casa Coralina, a fictional rental shown on the dashboard.',
      ] }],
    },
    {
      id: 'qloo',
      heading: 'What a call sends to Qloo',
      blocks: [
        { p: "Taste ids, tags, the coordinates being searched, a search radius, and filters such as a kind of place. The one free-text field is the taste you named, capped at 80 characters." },
        { p: 'Never your phone number, an email address, or your room. Every outbound parameter is checked against an allowlist before it leaves the server, and a taste that contains an email address, a phone number, or a room number is refused. Your first name never leaves this server. Ticketmaster gets a location, a date range, and a kind of event, nothing about you.' },
      ],
    },
    {
      id: 'kept',
      heading: 'What we keep',
      blocks: [
        { ul: [
          'A keyed hash of the number that called, so repeat callers can be counted. Not the number itself.',
          'The tastes you named and the taste ids they resolved to.',
          'How many picks and events came back, and whether a text went out.',
          'A record of each request the call made to Qloo or Ticketmaster, so the dashboard can show where every pick came from. It never holds a number, a name, or a message.',
          'The picks page a text links to: the picks in that text (name, a few words, a time, a web address) under a random code, deleted 30 days after the text. It holds no number, no name, and nothing else about the call.',
          'A short memory for the concierge: the first name you gave, the town you were in, the tastes you named, and the places it suggested or texted. It is filed under a separately keyed hash of your number and is deleted 7 days after your last call, and never kept more than 30 days. Say "forget me" on any call and it is deleted then.',
        ] },
        { p: 'No transcripts. No message bodies. The rental host dashboard never sees the memory.' },
      ],
    },
    {
      id: 'sms',
      heading: 'The text message',
      blocks: [
        { ul: [
          'The concierge offers to text you the plan. If you say yes, it sends a text, to the number you are calling from. It cannot text any other number.',
          'A text when you ask for one, up to ten on a call, and at most twelve texts to one number in an hour.',
          'Reply STOP to any text and the carrier stops them. Message and data rates may apply.',
          'Texts are sent through Twilio. Your number is used only to deliver the text you asked for.',
        ] },
        { key: SMS_SENTENCE },
      ],
    },
    {
      id: 'dashboard',
      heading: 'The rental host dashboard',
      blocks: [{ p: "The rental host sees totals and rankings: which tastes came up, how many calls, how many texts. Never a caller's number or name. Until a property has five calls, the guest panels stay dark, so one guest can't be picked out of a short list. Anything shown before then is a labeled sample." }],
    },
    questions([' The ', { text: 'terms', to: '/terms' }, ' cover the demo line and the code.']),
  ],
};

export const TERMS = {
  path: '/terms',
  title: 'Terms',
  docTitle: 'Terms, Bellhop Concierge',
  description: 'Terms for the Bellhop Concierge demo line, its text messages, and its source code.',
  lead: `${BRIDGE} This site and its phone line are a demo of a hackathon entry.`,
  sections: [
    {
      id: 'demo',
      heading: 'What this is',
      blocks: [{ ul: [
        'A working demo with two lines: Hollis for a night out in any US city, and Marisol for Casa Coralina, a fictional short-term rental.',
        'The demo number takes up to three hundred calls a day, three at a time.',
        'It is offered as is, with no warranty of any kind. It may be slow, down, or changed without notice.',
      ] }],
    },
    {
      id: 'picks',
      heading: 'About the picks',
      blocks: [{ p: "Picks come from third-party data: Qloo's taste graph and Ticketmaster's event listings. Places change their hours, and events sell out or move. The concierge never makes up an hour, but it can't promise one either. Check with the place before you go." }],
    },
    {
      id: 'sms',
      heading: 'Text messages',
      blocks: [
        { ul: [
          'Program: Bellhop Concierge, the toll-free demo line answered by Hollis. The text is the plan you asked for on the call.',
          'A text goes out when you ask for one or say yes to the offer, and only to the number you are calling from.',
          'Frequency: a text when the guest asks for one, up to ten on a call, and at most twelve to one number in an hour.',
          'Reply STOP to any text to stop them. Message and data rates may apply.',
        ] },
        { key: SMS_SENTENCE },
        { p: ['How your number is handled is on the ', { text: 'privacy page', to: '/privacy' }, '. How a guest asks for a text, step by step, is on the ', { text: 'opt-in page', to: '/sms-opt-in' }, '.'] },
      ],
    },
    {
      id: 'code',
      heading: 'The code',
      blocks: [{ p: ['The source is licensed under the GNU Affero General Public License, version 3. Read it, run it, or fork it: ', { text: 'the source on GitHub', href: REPO_URL }, '.'] }],
    },
    questions(),
  ],
};

export const SMS_OPT_IN = {
  path: '/sms-opt-in',
  slug: 'opt-in',
  title: 'How guests opt in to texts',
  docTitle: 'Text opt-in, Bellhop Concierge',
  description: 'How a guest of a property on Bellhop Concierge asks for a text: the room card, the words on the call, and the consent. The concierge says it is automated in its first sentence and that the call is recorded in its next line.',
  lead: 'Bellhop Concierge sends a text only when a guest asks for one, out loud, on a call to the concierge. Here is every step the guest sees and hears, from the card in the room to the text.',
  sections: [
    {
      id: 'card',
      heading: 'The card in the room',
      blocks: [
        { p: 'A host sets a card like this in the guest room. It is how a guest finds the number to call. This one is for Casa Coralina, the fictional sample rental.' },
        { card: {
          inn: 'Casa Coralina',
          hook: 'Need a plan tonight?',
          call: 'Call Hollis, the concierge:',
          number: OPT_IN_NUMBER,
          line: 'Ask for a text and the plan goes to the number you call from. A night out in any US city.',
          fine: 'An automated line. Calls are recorded.',
        } },
        { p: 'Toll-free number, verified for texting.' },
        { p: ['The same card as an image: ', { text: 'room-card-coralina-833.png', to: '/room-card-coralina-833.png' }, '.'] },
      ],
    },
    {
      id: 'script',
      heading: 'What the concierge says',
      blocks: [
        { p: 'The first sentence of every call, which says the concierge is automated:' },
        { quote: OPENER },
        { p: 'The next line, on every first call, which says the call is recorded:' },
        { quote: RECORDING_LINE },
        { p: 'When the plan is ready, the concierge asks before it sends anything:' },
        { quote: OFFER_LINE },
        { p: 'The text goes out only if the guest says yes, and only to the number that called.' },
      ],
    },
    {
      id: 'consent',
      heading: 'What the guest agrees to',
      blocks: [
        { ul: [
          'A text when the guest asks for one, up to ten on a call, each sent only after the guest says yes.',
          'Only to the number the guest is calling from. The concierge cannot text any other number, and it never asks for one.',
          'About 1 to 3 texts per month per guest.',
          'The text is the plan the guest asked for: each pick by name with a few words, and one link to a page where each name opens its website, a map, or its tickets. No marketing.',
        ] },
        { key: STOP_HELP },
        { key: SMS_SENTENCE },
        { p: ['Support: ', { text: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` }, '.'] },
      ],
    },
    {
      id: 'more',
      heading: 'The rest of the policy',
      blocks: [{ p: ['How a number is handled is on the ', { text: 'privacy page', to: '/privacy' }, '. The text program terms are on the ', { text: 'SMS terms page', to: '/sms-terms' }, '.'] }],
    },
  ],
};

/** Inline -> an array of segments, so both renderers walk one shape. */
export const segments = (inline) => (Array.isArray(inline) ? inline : [inline]);
