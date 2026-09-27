import type { ChangeListener, Entity, Storage } from '@ergon/core';
import { methods, type Method, type Request, type Response } from './protocol';

/** Main-thread `Storage` backed by the database worker. */
export function createWorkerStorage(worker: Worker): Storage {
  let nextId = 0;
  const pending = new Map<number, PromiseWithResolvers<unknown>>();
  const listeners = new Set<ChangeListener>();

  worker.addEventListener('message', ({ data }: MessageEvent<Response>) => {
    if (data.type === 'change') {
      const entities = new Set<Entity>(data.entities);
      for (const listener of listeners) listener(entities);
      return;
    }
    const call = pending.get(data.id);
    pending.delete(data.id);
    if (data.type === 'result') call?.resolve(data.result);
    else call?.reject(data.error);
  });

  const call = (method: Method, args: unknown[]) => {
    const id = nextId++;
    const request: Request = { id, method, args };
    const result = Promise.withResolvers<unknown>();
    pending.set(id, result);
    worker.postMessage(request);
    return result.promise;
  };

  const proxies = Object.fromEntries(
    methods.map((method) => [method, (...args: unknown[]) => call(method, args)]),
  ) as Pick<Storage, Method>;

  return {
    ...proxies,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
