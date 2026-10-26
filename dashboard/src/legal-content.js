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
/** The toll-free line under carrier review. Printed on the opt-in page's room card only. */
export const OPT_IN_NUMBER = '(833) 658-4321';
/** Harper's first sentence (personas/harper.md `opener`), with the demo inn's name filled in. */
export const OPENER = 'This is Harper, your concierge at The Juniper House, who am I speaking with?';
/** What the concierge says in its next turn on every first call (template/concierge.md, The opening). */
export const RECORDING_LINE = 'Just so you know, this call is being recorded so I can give you the best service possible going forward.';
export const OFFER_LINE = 'Want me to text these? Any text I send goes only to the number you are calling from.';
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
  description: 'What a call to Bellhop Concierge sends, what it keeps, and how the one text works.',
  lead: 'We keep what the dashboard needs to count and rank tastes, and nothing that says who you are. Here is the whole of it.',
  sections: [
    {
      id: 'call',
      heading: 'When you call',
      blocks: [{ ul: [
        'The concierge asks who is calling, then says the call is recorded in its very next line. If you ask whether it is a person, it says it is a computer voice.',
        "The call runs on ElevenLabs' voice platform, which records it. This server never stores a transcript or a recording.",
        'The demo inn, The Juniper House, is fictional. The calls to it are real.',
      ] }],
    },
    {
      id: 'qloo',
      heading: 'What a call sends to Qloo',
      blocks: [
        { p: "Taste ids, tags, the inn's coordinates, a search radius, and filters such as a kind of place. The one free-text field is the taste you named, capped at 80 characters." },
        { p: 'Never your phone number, an email address, or your room. Every outbound parameter is checked against an allowlist before it leaves the server, and a taste that contains an email address, a phone number, or a room number is refused. The concierge never asks your name. Ticketmaster gets a location, a date range, and a kind of event, nothing about you.' },
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
        ] },
        { p: 'No names. No transcripts. No message bodies.' },
      ],
    },
    {
      id: 'sms',
      heading: 'The text message',
      blocks: [
        { ul: [
          'The concierge offers to text you the plan. If you say yes, it sends one text, to the number you are calling from. It cannot text any other number.',
          'One text per call, and at most three texts to one number in an hour.',
          'Reply STOP to any text and the carrier stops them. Message and data rates may apply.',
          'Texts are sent through Twilio. Your number is used only to deliver the text you asked for.',
        ] },
        { key: SMS_SENTENCE },
      ],
    },
    {
      id: 'dashboard',
      heading: 'The innkeeper dashboard',
      blocks: [{ p: "The innkeeper sees totals and rankings: which tastes came up, how many calls, how many texts. Never a caller's number or name. Until an inn has five calls, the guest panels stay dark, so one guest can't be picked out of a short list. Anything shown before then is a labeled sample." }],
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
        'A working demo. The inn on the demo line, The Juniper House, is fictional.',
        'The demo number is a test line, capped at twenty calls a day.',
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
          'Program: Bellhop Concierge. The text is the plan you asked for on the call.',
          'The concierge offers the text. It goes out only if you say yes, and only to the number you are calling from.',
          'Frequency: one text per call, and at most three to one number in an hour.',
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
  description: 'How a guest of an inn on Bellhop Concierge asks for a text: the room card, the words on the call, and the consent.',
  lead: 'Bellhop Concierge sends a text only when a guest asks for one, out loud, on a call to the inn. Here is every step the guest sees and hears, from the card in the room to the text.',
  sections: [
    {
      id: 'card',
      heading: 'The card in the room',
      blocks: [
        { p: 'The inn sets this card in the guest room. It is how a guest finds the number to call.' },
        { card: {
          inn: 'The Juniper House',
          hook: 'Need a plan tonight?',
          call: 'Call the concierge:',
          number: OPT_IN_NUMBER,
          line: 'Ask for a text and the plan goes to the number you call from.',
          fine: 'An automated line. Calls are recorded.',
        } },
        { p: 'Toll-free number, pending carrier approval. Today\'s test line is (706) 810-9262.' },
        { p: ['The same card as an image: ', { text: 'room-card-juniper-833.png', to: '/room-card-juniper-833.png' }, '.'] },
      ],
    },
    {
      id: 'script',
      heading: 'What the concierge says',
      blocks: [
        { p: 'The first sentence of every call:' },
        { quote: OPENER },
        { p: 'The next line, on every first call:' },
        { quote: RECORDING_LINE },
        { p: 'When the plan is ready, the concierge asks before it sends anything:' },
        { quote: OFFER_LINE },
        { p: 'The text goes out only if the guest says yes.' },
      ],
    },
    {
      id: 'consent',
      heading: 'What the guest agrees to',
      blocks: [
        { ul: [
          'One text per call at most, sent only after the guest says yes.',
          'Only to the number the guest is calling from. The concierge cannot text any other number, and it never asks for one.',
          'About 1 to 3 texts per month per guest.',
          'The text is the plan the guest asked for: the picks by name, and a reason where it fits. No marketing.',
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
