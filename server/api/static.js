// Serves the built dashboard (dashboard/dist) from the same Hono app as the tool server.
// Known client routes get index.html; files are served only from inside dist, by an
// exact path check, so a crafted path cannot read anything else on disk.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIST = fileURLToPath(new URL('../../dashboard/dist', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.vtt': 'text/vtt; charset=utf-8',
};

/** Audio and video are streamed and answer byte ranges: Safari will not play a video without them. */
const MEDIA = new Set(['.mp4', '.webm', '.mp3', '.m4a']);
/** The most one range answer carries; the player asks again for the rest. */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/**
 * Reads a single "bytes=a-b" range against a file size. Returns null for no header, 'bad' for a
 * range that cannot be satisfied, else { start, end } with end inclusive and capped.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start;
  let end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'bad';
  return { start, end: Math.min(end, start + MAX_RANGE_BYTES - 1) };
}

/**
 * Pages served as whole HTML documents, built from dashboard/src/legal-content.js by
 * dashboard/scripts/build-legal.mjs, so a reader that runs no JavaScript still gets the
 * policy. Checked before the app shell. `/sms-terms` is the name a carrier review asks for, and
 * `/sms-opt-in` shows a reviewer how a guest asks for a text.
 */
export const STATIC_PAGES = [
  { re: /^\/privacy\/?$/, file: 'privacy.html' },
  { re: /^\/(sms-)?terms\/?$/, file: 'terms.html' },
  { re: /^\/sms-opt-in\/?$/, file: 'sms-opt-in.html' },
];

/** Client-side routes that render the app shell (the legal pages too, if their files are missing). */
export const APP_ROUTES = [/^\/$/, /^\/build\/?$/, /^\/privacy\/?$/, /^\/(sms-)?terms\/?$/, /^\/sms-opt-in\/?$/, /^\/property\/[a-z0-9-]{1,40}\/?$/, /^\/property\/[a-z0-9-]{1,40}\/brief\/?$/];

/** Names a reader is likely to type, sent to the real route. */
export const REDIRECTS = [
  { re: /^\/builder\/?$/, to: '/build' },
  { re: /^\/brief\/?$/, to: '/property/demo/brief' },
];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // Inline style attributes are used for data-driven bar widths; scripts are same-origin only.
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/**
 * @param {import('hono').Hono} app
 * @param {{ distDir?: string }} [opts]
 */
export function serveDashboard(app, { distDir = DEFAULT_DIST } = {}) {
  const root = normalize(distDir) + sep;

  const send = (c, file, cacheControl) => {
    const body = readFileSync(file);
    return c.body(body, 200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cacheControl, ...SECURITY_HEADERS });
  };

  app.get('*', async (c, next) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const moved = REDIRECTS.find((r) => r.re.test(path));
    if (moved) return c.redirect(moved.to, 301);
    const legal = STATIC_PAGES.find((p) => p.re.test(path));
    if (legal && existsSync(join(root, legal.file))) return send(c, join(root, legal.file), 'no-cache');
    if (APP_ROUTES.some((re) => re.test(path))) {
      const index = join(root, 'index.html');
      if (!existsSync(index)) {
        return c.text('The dashboard is not built yet. Run: npm run build:dashboard', 503);
      }
      return send(c, index, 'no-cache');
    }
    const file = normalize(join(root, path));
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile() && MEDIA.has(extname(file))) {
      const size = statSync(file).size;
      const range = parseRange(c.req.header('range'), size);
      const head = { 'Content-Type': TYPES[extname(file)], 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=300', ...SECURITY_HEADERS };
      if (range === 'bad') return c.body(null, 416, { ...head, 'Content-Range': `bytes */${size}` });
      const { start, end } = range ?? { start: 0, end: size - 1 };
      const stream = Readable.toWeb(createReadStream(file, { start, end }));
      return c.body(stream, range ? 206 : 200, {
        ...head, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      });
    }
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      return send(c, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    }
    return next();
  });
}
