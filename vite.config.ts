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
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/parser/**', 'src/storage/**'],
    },
  },
});
