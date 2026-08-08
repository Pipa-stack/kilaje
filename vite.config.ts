import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    // `npm run dev` serves the UI; the API comes from `npm run dev:server`.
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    watch: {
      // Tooling that writes scratch files into the project must not trigger a
      // full page reload while a workout is being logged.
      ignored: ['**/.gstack/**', '**/dist/**', '**/coverage/**'],
    },
  },
  preview: {
    // Railway serves the app behind its own proxy domain.
    allowedHosts: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Boots an Express + PGlite server in Node for the jsdom suites to call.
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/parser/**', 'src/storage/**'],
    },
  },
});
