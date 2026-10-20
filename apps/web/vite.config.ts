import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const webPort = Number(process.env.VITE_PORT || 8000);
const apiPort = Number(process.env.VITE_API_PORT || 4001);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The web app reads only apps/web/.env*. Server secrets live in the root .env, which Vite never loads,
  // so they cannot end up in the browser bundle.
  server: {
    port: webPort,
    // The API runs on :4001; proxying keeps cookies same-origin in development.
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
