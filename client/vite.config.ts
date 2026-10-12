/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // y-monaco imports 'monaco-editor/esm/vs/…', a path that Monaco 0.57's package "exports" map no longer allows
      // (it now maps 'monaco-editor/x' to 'esm/vs/x'). Rewrite it so both resolve to the same single Monaco instance.
      { find: /^monaco-editor\/esm\/vs\/(.*)$/, replacement: 'monaco-editor/$1' },
    ],
  },
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
