// Mounts the innkeeper dashboard on the tool server's Hono app: JSON under /api, the built
// React app at /, /build, and /property/:id.

import { createApiRoutes } from './routes.js';
import { serveDashboard } from './static.js';

/**
 * @param {import('hono').Hono} app
 * @param {Parameters<typeof createApiRoutes>[0] & { distDir?: string }} deps
 */
export function mountDashboard(app, { distDir, ...deps }) {
  app.route('/api', createApiRoutes(deps));
  serveDashboard(app, { distDir });
}

/** Dashboard settings from the environment. Every variable is optional. */
export function dashboardEnv(env = process.env) {
  return {
    adminToken: env.DASHBOARD_ADMIN_TOKEN ?? '',
    demoNumber: env.PUBLIC_DEMO_NUMBER ?? '',
    repoUrl: env.PUBLIC_REPO_URL ?? '',
    publishWebhookUrl: env.PUBLISH_WEBHOOK_URL ?? '',
    publishWebhookSecret: env.PUBLISH_WEBHOOK_SECRET ?? '',
  };
}
