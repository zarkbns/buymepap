import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Social crawlers require absolute og URLs, so the public origin is baked in at
// build time. Explicit config wins; on Vercel the project's production domain is
// already known at build time, so a deploy needs no variable set at all.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
process.env.VITE_APP_URL ||=
  process.env.APP_URL || (vercelHost ? `https://${vercelHost}` : 'http://localhost:5173');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
