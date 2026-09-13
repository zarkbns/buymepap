import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Social crawlers require absolute og URLs, so the public origin is baked in at
// build time. APP_URL is the single source of truth; VITE_APP_URL overrides it
// for a split deploy where the SPA is served from a different host than the API.
process.env.VITE_APP_URL ||= process.env.APP_URL || 'http://localhost:5173';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
