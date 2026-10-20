/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

/** The sync server behind `/api` in dev and preview (`go run .` in apps/server). */
const api = { '/api': process.env.ERGON_SERVER ?? 'http://localhost:8080' };

/** What the service worker keeps for offline use: `urls` are relative to its scope. */
interface Precache {
  version: string;
  urls: string[];
}

/** Everything but source maps, the worker itself and the woff fallback of fonts that have woff2. */
const isPrecached = (file: string) => file !== 'sw.js' && !/\.(map|woff)$/.test(file);

/**
 * Bundles src/sw.ts into a classic script served as /sw.js. It sits at the root so the service
 * worker controls the whole app, and is bundled so it can use the core's crypto. In a build it
 * is given the list of files to precache; its version changes whenever one of them does.
 */
function serviceWorker(): Plugin {
  let publicDir = '';
  const bundle = async (minify: boolean, precache: Precache) => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      define: { SW_PRECACHE: JSON.stringify(precache) },
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
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use('/sw.js', (_request, response, next) => {
        bundle(false, { version: 'dev', urls: [] }).then((code) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(code);
        }, next);
      });
    },
    generateBundle: {
      order: 'post',
      async handler(_options, output) {
        const files = new Map<string, string | Uint8Array>();
        for (const [name, item] of Object.entries(output)) {
          files.set(name, item.type === 'chunk' ? item.code : item.source);
        }
        if (existsSync(publicDir)) {
          for (const name of readdirSync(publicDir, { recursive: true, encoding: 'utf8' })) {
            const path = join(publicDir, name);
            if (statSync(path).isFile()) files.set(name.replaceAll('\\', '/'), readFileSync(path));
          }
        }
        const urls = [...files.keys()].filter(isPrecached).toSorted();
        const hash = createHash('sha256');
        for (const url of urls) hash.update(url).update(files.get(url)!);
        const version = hash.digest('hex').slice(0, 12);
        const source = await bundle(true, { version, urls });
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
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
