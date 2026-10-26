/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [svelte()],
  define: {
    __LAYR_VERSION__: JSON.stringify(pkg.version),
  },
  // Relative base so the built bundle can be served from any path (nginx sub-path, file share, etc.).
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // The Pi serves the bundle locally; keep everything in a handful of files.
    assetsInlineLimit: 4096,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
