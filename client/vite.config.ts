/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // [CONCEPT: Dev Proxy] In development the SPA and API share an origin, so no CORS preflights are needed locally.
    proxy: {
      '/api': 'http://localhost:4000',
      '/healthz': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
      '/yjs': { target: 'ws://localhost:4000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
