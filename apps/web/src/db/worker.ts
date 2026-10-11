import { Database, type Entity } from '@ergon/core';
import type { Request, Response, WorkerError } from './protocol';
import { createSync } from './sync';
import { openWaSqlite } from './wa-sqlite';

const post = (message: Response) => self.postMessage(message);

/** Tells other tabs' workers that data changed. */
const tabs = new BroadcastChannel('ergon-db');

const ready = openWaSqlite('ergon.db')
  .then((driver) => Database.open(driver))
  .then((db) => {
    const sync = createSync(db, (state) => post({ type: 'sync', state }));
    db.subscribe((changed) => {
      const entities = [...changed];
      post({ type: 'change', entities });
      tabs.postMessage(entities);
      sync.changed();
    });
    tabs.addEventListener('message', (event: MessageEvent<Entity[]>) => {
      post({ type: 'change', entities: event.data });
      sync.changed();
    });
    return { db, sync };
  });

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, target, method, args } = event.data;
  try {
    const services = await ready;
    const service = services[target === 'storage' ? 'db' : 'sync'];
    const fn = service[method as keyof typeof service] as (...args: unknown[]) => Promise<unknown>;
    post({ type: 'result', id, result: await fn.apply(service, args) });
  } catch (error) {
    post({ type: 'error', id, error: toWorkerError(error) });
  }
});

function toWorkerError(error: unknown): WorkerError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const { name, message } = error;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? { name, message, code } : { name, message };
}
