// Every word the landing page shows, in one place, so the copy can be swapped without touching
// a component. Numbers here are listed with their measuring command in docs/MEASUREMENTS.md.
// House rules for these strings: no em dashes, never the two-letter abbreviation for the
// software, "innkeeper" for the person at the desk.

export const MEDIA = {
  heroFilm: '/media/film-marisol.mp4',
  heroLoop: '/media/film-marisol-loop.mp4',
  heroPoster: '/media/film-poster.jpg',
  hollisFilm: '/media/film-hollis.mp4',
  callAudio: '/media/call-marisol.mp3',
  callCues: '/media/call-marisol.cues.json',
};

export const HERO = {
  eyebrow: 'Bellhop Concierge',
  title: 'The friend who knows where to go.',
  sub: 'Talk for a minute. Your night arrives by text.',
  callLabel: 'Call Hollis',
  callNote: 'Hollis picks up. Anywhere in the US.',
  copy: 'Copy number',
  copied: 'Number copied.',
  filmLabel: 'A call with Marisol at Casa Coralina',
  soundOn: 'Play with sound',
  soundOff: 'Mute',
  placeholderQuote: '\u201cWho am I speaking with?\u201d',
  placeholderCaption: 'Marisol answers at Casa Coralina, Miami',
  filmNote: 'Edited from real calls.',
};

/** The Casa Coralina line: Marisol answers it. Shown once, quieter than the Hollis number. */
export const MARISOL = {
  lead: 'Staying at Casa Coralina?',
  label: 'Call Marisol',
  number: '+17068109262',
};

export const SCENE = {
  eyebrow: 'One call',
  title: 'Pick up. She picks up.',
  sub: 'No menu. No app. A voice that asks about your night and listens.',
  callTitle: 'Casa Coralina',
  callSub: 'Marisol, the concierge',
  smsFrom: 'Casa Coralina',
  pageTitle: 'Your picks',
  pageBrand: 'Bellhop Concierge',
  smsLabel: 'Text message',
  transcriptLabel: 'The call, line by line',
  concierge: 'Concierge',
  guest: 'Guest',
  replay: 'Play it again',
};

export const REAL_CALL = {
  eyebrow: 'Listen',
  title: 'Hear a real call.',
  sub: 'Recorded on the live line. Nothing scripted on her side.',
  play: 'Play the call',
  pause: 'Pause',
  seek: 'Position in the call',
};

export const STEPS = {
  eyebrow: 'How it works',
  items: [
    { id: 'call', kicker: '01', title: 'Call.', body: 'The number on the room card. A warm voice asks about your night.' },
    { id: 'learn', kicker: '02', title: 'It learns what you love.', body: 'Not a quiz. You just talk; the tastes come out on their own.' },
    { id: 'text', kicker: '03', title: 'Your night, texted.', body: 'One pick at a time, with the reason in your own words. Powered by Qloo\'s taste graph.' },
  ],
  stage: {
    ringing: 'Calling',
    callee: 'Marisol, Casa Coralina',
    delivered: 'Delivered',
    youSaid: 'You said',
    tastes: ['Live Latin music', 'Dancing'],
    graph: 'Qloo taste graph',
    pick: 'Cubaocho',
    pickWhy: 'Live music and a rum bar in Little Havana, somewhere you can dance.',
    sms: 'Bellhop Concierge: Tonight:\n- El Cristo Restaurant, lively cuban restaurant\n- Cubaocho Museum & Performing Arts Center, lively art museum\nTap for links: concierge.southernsky.cloud/p/zwK08X',
  },
};

export const MEMORY = {
  eyebrow: 'Next time',
  title: 'It remembers you.',
  sub: 'Your name, your town, what it sent you. Next call picks up where you left off. Say "forget me" and it does.',
};

export const PROPERTIES = {
  eyebrow: 'For innkeepers',
  title: 'Every property gets its own concierge.',
  line: 'One config file. One number. A voice that knows checkout, the pool hours, and your kind of night.',
  caption: 'Three inns, three voices, one config file each.',
  build: 'Build yours',
  open: 'Open the dashboard',
  example: 'Example',
  tiles: [
    { name: 'Casa Coralina', place: 'Coconut Grove, Miami', concierge: 'Marisol', kind: 'Rental', to: '/property/miami', tone: 'accent' },
    { name: 'The Juniper House', place: 'Savannah, Georgia', concierge: 'Harper', kind: 'Inn', tone: 'taste' },
    { name: 'Laurel Ridge Lodge', place: 'Blue Ridge, North Carolina', concierge: 'Maybelle', kind: 'Lodge', tone: 'plain' },
  ],
};

export const PROOF = {
  eyebrow: 'Under the hood',
  title: 'Live tonight.',
  sub: 'Real line. Real picks. Real texts. Every call recorded, every number kept private.',
  // Read from /api/health-summary at page load; a service shows only when the server says live.
  live: [['qloo', 'Qloo'], ['ticketmaster', 'Ticketmaster'], ['sms', 'Texts']],
  liveWord: 'live',
  // Each fact is listed in docs/MEASUREMENTS.md with the command that produced it.
  facts: [
    { value: '13', label: 'Qloo capabilities in the call path, from entity search to explainability.' },
    { value: '12 of 12', label: 'test callers got a different list than the no-taste baseline.' },
    { value: '158 ms', label: 'median Qloo insights answer, over 47 live calls.' },
  ],
  links: [
    { label: 'Read the code', href: 'https://github.com/StankyDanko/bellhop-concierge' },
    { label: 'How it uses Qloo', href: 'https://github.com/StankyDanko/bellhop-concierge/blob/main/docs/QLOO.md' },
    { label: 'Every measurement', href: 'https://github.com/StankyDanko/bellhop-concierge/blob/main/docs/MEASUREMENTS.md' },
  ],
  capsSummary: 'All thirteen capabilities',
};

export const CLOSER = {
  title: 'Try it. Call Hollis.',
  sub: 'An automated line. Calls are recorded. Texts go only to the phone you call from.',
  callLabel: 'Call Hollis',
  filmLabel: 'Hollis, anyone, anywhere',
  busy: 'We couldn\'t reach the concierge just now. The number stays the same; try again in a minute.',
  noNumber: 'The number appears here once the line is set up.',
};

/**
 * Every Qloo capability the tool server and dashboard call with memory off, counted from the code
 * (docs/MEASUREMENTS.md has the grep for each). Memory's filter.exclude.entities is left out: it
 * runs only when GUEST_MEMORY_SECRET is set.
 */
export const CAPABILITIES = [
  ['Entity search', 'A band name becomes a Qloo artist id.', 'GET /search'],
  ['Place-scoped tag search', '"Thai food" becomes the thai restaurant tag, never a film genre.', 'GET /v2/tags filter.parents.types'],
  ['Location-scoped insights', 'Places near the inn, ranked for this guest.', 'GET /v2/insights filter.location'],
  ['Cuisine as a hard filter', 'A guest who says thai gets thai places.', 'GET /v2/insights filter.tags'],
  ['Cross-domain affinity', 'A music taste picks a restaurant, and a film to watch at the inn.', 'GET /v2/insights signal.* + filter.type'],
  ['Per-person scoring', 'Which pick leans to the guest, the plus-one, or both.', 'GET /v2/insights filter.results.entities'],
  ['Explainability', 'The reason behind a pick, when Qloo names one.', 'feature.explainability=true'],
  ['Popularity baseline', 'What anyone nearby would be told, for the contrast.', 'GET /v2/insights, no signal'],
  ['Heatmap', 'Where around the inn a taste runs hottest, with quality.', 'GET /v2/insights filter.type=urn:heatmap heatmap.dimensions'],
  ['Named areas', 'The neighborhoods where callers\' tastes run hottest.', 'GET /v2/insights output.heatmap.boundary'],
  ['Demographics', 'Which age groups lean toward guest tastes.', 'GET /v2/insights filter.type=urn:demographics'],
  ['Tag insights', 'What callers lean toward, and what the town leans toward.', 'GET /v2/insights filter.type=urn:tag'],
  ['Audience compare', 'Where the two lists share a tag.', 'GET /v2/analysis/compare'],
];
