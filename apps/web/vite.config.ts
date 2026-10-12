/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { build, defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

/** The sync server behind `/api` in dev and preview (`go run .` in apps/server). */
const api = { '/api': process.env.ERGON_SERVER ?? 'http://localhost:8080' };

/**
 * Bundles src/sw.ts into a classic script served as /sw.js. It sits at the root so the service
 * worker controls the whole app, and is bundled so it can use the core's crypto.
 */
function serviceWorker(): Plugin {
  const bundle = async (minify: boolean) => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify,
        target: 'es2023',
        lib: {
          entry: fileURLToPath(new URL('src/sw.ts', import.meta.url)),
          formats: ['iife'],
          name: 'ergonServiceWorker',
        },
      },
    });
    const [bundle] = [result].flat().filter((item) => 'output' in item);
    return bundle!.output[0].code;
  };
  return {
    name: 'ergon-service-worker',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_request, response, next) => {
        bundle(false).then((code) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(code);
        }, next);
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: await bundle(true) });
    },
  };
}

export default defineConfig({
  base: './',
  server: { proxy: api },
  preview: { proxy: api },
  plugins: [solid(), serviceWorker()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  build: { target: 'es2023' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
