import { Database, type Entity } from '@ergon/core';
import type { Request, Response } from './protocol';
import { openWaSqlite } from './wa-sqlite';

const post = (message: Response) => self.postMessage(message);

/** Tells other tabs' workers that data changed. */
const tabs = new BroadcastChannel('ergon-db');
tabs.addEventListener('message', (event: MessageEvent<Entity[]>) =>
  post({ type: 'change', entities: event.data }),
);

const ready = openWaSqlite('ergon.db')
  .then((driver) => Database.open(driver))
  .then((db) => {
    db.subscribe((changed) => {
      const entities = [...changed];
      post({ type: 'change', entities });
      tabs.postMessage(entities);
    });
    return db;
  });

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, method, args } = event.data;
  try {
    const db = await ready;
    const fn = db[method] as (...args: unknown[]) => Promise<unknown>;
    post({ type: 'result', id, result: await fn.apply(db, args) });
  } catch (error) {
    post({ type: 'error', id, error });
  }
});
