/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

/** The sync server behind `/api` in dev and preview (`go run .` in apps/server). */
const api = { '/api': process.env.ERGON_SERVER ?? 'http://localhost:8080' };

export default defineConfig({
  base: './',
  server: { proxy: api },
  preview: { proxy: api },
  plugins: [solid()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  build: { target: 'es2023' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
