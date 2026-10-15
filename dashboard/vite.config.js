// Vite builds the dashboard into dashboard/dist, which the Hono server serves at /.
// In development, /api is proxied to the tool server (npm run mock, port 8787).
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
