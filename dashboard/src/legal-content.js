// The words on /privacy and /terms, in one place. The React pages render this module, and
// dashboard/scripts/build-legal.mjs renders the same module into dist/privacy.html and
// dist/terms.html, the copies a fetcher that runs no JavaScript reads. Edit here only.
//
// Every claim matches the code: server/lib/pii-guard.js (what reaches Qloo),
// server/lib/ticketmaster.js (what reaches Ticketmaster), server/lib/sessions.js (what is
// stored), server/tools/send-sms.js (who gets a text, and how often), and SESSION_GATE in
// server/api/routes.js (the five-call floor).
//
// Shapes: a page has a title, a lead, and sections. A section has blocks:
//   { p: Inline }  a paragraph       { ul: Inline[] }  a list       { key: string }  set apart
// Inline is a string, or an array of strings and links: { text, href } leaves the site,
// { text, to } stays in it.

export const EFFECTIVE = 'October 16, 2026';
export const SITE = 'https://southernsky.cloud';
export const REPO_URL = 'https://github.com/StankyDanko/bellhop-concierge';
export const BRIDGE = 'Bellhop Concierge is a product of SouthernSky, a service of E Brands, LLC.';
export const SMS_SENTENCE = 'Mobile numbers and consent are never sold, shared, or transferred to third parties for marketing.';

/** The footer, shared by the app shell and the static pages. */
export const FOOTER = {
  edition: 'Bellhop Concierge, an edition of Bellhop by SouthernSky. AGPL-3.0.',
  sources: 'Picks from the Qloo taste graph and Ticketmaster.',
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
        'The concierge says it is automated and that the call is recorded, in its first sentence.',
        "The call runs on ElevenLabs' voice platform, which records it. This server never stores a transcript or a recording.",
        'The demo inn, The Juniper House, is fictional. The calls to it are real.',
      ] }],
    },
    {
      id: 'qloo',
      heading: 'What a call sends to Qloo',
      blocks: [
        { p: "Taste ids, tags, the inn's coordinates, a search radius, and filters such as a kind of place. The one free-text field is the taste you named, capped at 80 characters." },
        { p: 'Never your name, your phone number, or your room. Every outbound parameter is checked against an allowlist before it leaves the server, and a taste that contains an email address, a phone number, or a room number is refused. Ticketmaster gets a location, a date range, and a kind of event, nothing about you.' },
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
        { p: ['How your number is handled is on the ', { text: 'privacy page', to: '/privacy' }, '.'] },
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

/** Inline -> an array of segments, so both renderers walk one shape. */
export const segments = (inline) => (Array.isArray(inline) ? inline : [inline]);
