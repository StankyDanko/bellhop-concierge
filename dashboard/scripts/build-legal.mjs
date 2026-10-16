// Renders dashboard/src/legal-content.js into dist/privacy.html and dist/terms.html: whole
// HTML documents with no scripts, so a reviewer's fetcher that runs no JavaScript still reads
// the policy. The React pages render the same module, so the words cannot drift apart.
// Runs after vite in `npm run build:dashboard` (vite empties dist/ first).
//
//   /usr/bin/node dashboard/scripts/build-legal.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EFFECTIVE, FOOTER, PRIVACY, REPO_URL, TERMS, segments } from '../src/legal-content.js';

const DASH = fileURLToPath(new URL('..', import.meta.url));
const DIST = `${DASH}dist`;
if (!existsSync(DIST)) { console.error('dashboard/dist is missing: run vite build first'); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The house tokens, inlined as they are (comments dropped), so these pages use the same
// colors and type as the app in both themes.
const tokens = ['tokens.css', 'concierge.tokens.css']
  .map((f) => readFileSync(`${DASH}${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n+/g, '\n'))
  .join('\n');

const CSS = `${tokens}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--color-bg);color:var(--color-text);font-family:var(--font-sans);font-size:var(--text-md);line-height:1.6;overflow-wrap:anywhere}
h1,h2,p,ul{margin:0}
a{color:var(--color-accent-text);text-underline-offset:.18em}
.wrap{max-width:calc(var(--prose-max) + 2rem);margin:0 auto;padding:0 1rem}
.top{border-bottom:1px solid var(--color-border);background:var(--color-surface)}
.top a{display:inline-flex;align-items:center;min-height:48px;font-weight:600;color:var(--color-text);text-decoration:none}
main.wrap{padding:2rem 1rem 4rem}
.eyebrow{font-size:var(--text-xs);font-weight:600;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--color-text-dim)}
h1{font-size:var(--text-2xl);line-height:1.15;margin-top:.5rem}
.meta{margin-top:.5rem;font-size:var(--text-sm);color:var(--color-text-dim)}
header{padding-bottom:1rem;border-bottom:1px solid var(--color-border)}
.lead{margin-top:1.5rem;font-size:var(--text-lg);line-height:1.45}
section{margin-top:2rem}
section h2{font-size:var(--text-lg);line-height:1.3}
section>*+*{margin-top:.75rem}
ul{padding-left:1.25em}
li+li{margin-top:.5rem}
.key{padding:.75rem 1rem;border-left:3px solid var(--color-accent);background:var(--color-surface-2);font-weight:500}
main a{display:inline-block;min-height:48px;padding-block:calc((48px - 1.6em)/2);margin-block:calc((48px - 1.6em)/-2)}
footer{border-top:1px solid var(--color-border);padding:2rem 0;color:var(--color-text-dim)}
footer p,footer nav{font-size:var(--text-sm)}
footer p+p,footer nav+p,footer p+nav{margin-top:.5rem}
footer nav{display:flex;flex-wrap:wrap;gap:0 1rem}
footer nav a{display:inline-flex;align-items:center;min-height:48px}
.bridge{font-size:var(--text-xs)}`;

function inline(value) {
  return segments(value).map((s) => {
    if (typeof s === 'string') return esc(s);
    const href = s.to ?? s.href;
    return `<a href="${esc(href)}"${s.href ? ' rel="noopener"' : ''}>${esc(s.text)}</a>`;
  }).join('');
}

function block(b) {
  if (b.ul) return `<ul>${b.ul.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
  if (b.key) return `<p class="key">${esc(b.key)}</p>`;
  return `<p>${inline(b.p)}</p>`;
}

function render(page) {
  const sections = page.sections.map((sec) => {
    const id = `${page.title.toLowerCase()}-${sec.id}`;
    return `<section aria-labelledby="${id}">\n<h2 id="${id}">${esc(sec.heading)}</h2>\n${sec.blocks.map(block).join('\n')}\n</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(page.docTitle)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<div class="top"><div class="wrap"><a href="/">Bellhop Concierge</a></div></div>
<main class="wrap">
<article aria-labelledby="legal-title">
<header>
<p class="eyebrow">Bellhop Concierge</p>
<h1 id="legal-title">${esc(page.title)}</h1>
<p class="meta">Effective ${esc(EFFECTIVE)}</p>
</header>
<p class="lead">${inline(page.lead)}</p>
${sections}
</article>
</main>
<footer><div class="wrap">
<p>${esc(FOOTER.edition)}</p>
<nav aria-label="Site"><a href="${esc(REPO_URL)}" rel="noopener">Source</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
<p>${esc(FOOTER.sources)}</p>
<p class="bridge">${esc(FOOTER.bridge)}</p>
</div></footer>
</body>
</html>
`;
}

for (const [file, page] of [['privacy.html', PRIVACY], ['terms.html', TERMS]]) {
  const html = render(page);
  writeFileSync(`${DIST}/${file}`, html);
  console.log(`dist/${file}  ${(html.length / 1024).toFixed(1)} kB`);
}
