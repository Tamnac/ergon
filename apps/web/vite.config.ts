/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  base: './',
  plugins: [solid()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  build: { target: 'es2023' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
