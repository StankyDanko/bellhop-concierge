// The picks page behind the text's one short link: GET /p/<token>.
//
// A text cannot hyperlink a name, and a long address in a text is clutter. So the text lists the
// picks as "- Name, a few words" and ends with one short link to this page, where each name is
// the link: a place goes to its website or a map, a film, show, or book to a search for it, an
// event to its Ticketmaster page. The page is one static HTML document: no script, no tracker,
// no font to fetch, no guest data beyond the picks themselves. Every target is https (the store
// refuses anything else), opens in a new tab with rel="noopener noreferrer", and the page is
// marked noindex so a search engine never lists someone's night.

/** @param {unknown} s */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Where a pick with no stored target goes: a web search for its name. @param {string} name */
const searchFor = (name) => `https://www.google.com/search?q=${encodeURIComponent(name)}`;

const CSS = `
:root{--bg:#f7f8fa;--card:#fff;--line:#d3d9e4;--ink:#14171f;--dim:#4d5566;--accent:#7a560f;--gold:#d4a437}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--card:#12151c;--line:#2a3140;--ink:#e6e9f0;--dim:#98a1b3;--accent:#e0b757;--gold:#d4a437}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:34rem;margin:0 auto;padding:1.5rem 1rem 2.5rem}
.brand{margin:0 0 .25rem;color:var(--accent);font-size:.8125rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
h1{margin:0 0 1.25rem;font-size:1.75rem;line-height:1.15}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
li{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:12px;padding:1rem 1.125rem}
li a{display:block;color:var(--ink);font-size:1.1875rem;font-weight:600;line-height:1.25;text-decoration:underline;text-decoration-color:var(--gold);text-decoration-thickness:2px;text-underline-offset:.2em}
li a:hover,li a:focus-visible{color:var(--accent)}
li a:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.when{margin:.25rem 0 0;color:var(--accent);font-size:.9375rem;font-weight:600}
.blurb{margin:.25rem 0 0;color:var(--dim)}
footer{margin-top:1.5rem;color:var(--dim);font-size:.875rem}
`;

/**
 * @param {{ title: string, picks: Array<{ name: string, blurb?: string, detail?: string, url?: string|null }> }} page
 * @returns {string} a whole HTML document
 */
export function renderPicksPage({ title, picks }) {
  const heading = esc(title || 'Your picks');
  const cards = picks.map((p) => {
    const href = p.url || searchFor(p.name);
    return `<li><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>`
      + (p.detail ? `<p class="when">${esc(p.detail)}</p>` : '')
      + (p.blurb ? `<p class="blurb">${esc(p.blurb)}</p>` : '')
      + '</li>';
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${heading} | Bellhop Concierge</title>
<style>${CSS}</style>
</head>
<body>
<main>
<p class="brand">Bellhop Concierge</p>
<h1>${heading}</h1>
<ul>
${cards}
</ul>
<footer>Tap a name to open it. Picks from Qloo and Ticketmaster. This page stays up for 30 days.</footer>
</main>
</body>
</html>
`;
}

/** The page's title for the night: follows the text's own header. @param {string|undefined} when @param {boolean} laterEvent */
export function pageTitle(when, laterEvent) {
  if (laterEvent) return 'Your plan';
  return when === 'weekend' ? 'This weekend' : 'Tonight';
}
