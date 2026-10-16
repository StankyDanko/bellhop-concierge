// Serves the built dashboard (dashboard/dist) from the same Hono app as the tool server.
// Known client routes get index.html; files are served only from inside dist, by an
// exact path check, so a crafted path cannot read anything else on disk.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIST = fileURLToPath(new URL('../../dashboard/dist', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

/** Client-side routes that render the app shell. */
export const APP_ROUTES = [/^\/$/, /^\/build\/?$/, /^\/privacy\/?$/, /^\/terms\/?$/, /^\/property\/[a-z0-9-]{1,40}\/?$/, /^\/property\/[a-z0-9-]{1,40}\/brief\/?$/];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // Inline style attributes are used for data-driven bar widths; scripts are same-origin only.
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
    if (APP_ROUTES.some((re) => re.test(path))) {
      const index = join(root, 'index.html');
      if (!existsSync(index)) {
        return c.text('The dashboard is not built yet. Run: npm run build:dashboard', 503);
      }
      return send(c, index, 'no-cache');
    }
    const file = normalize(join(root, path));
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      return send(c, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    }
    return next();
  });
}
