import type { ChangeListener, Entity, Storage } from '@ergon/core';
import {
  storageMethods,
  syncMethods,
  type Request,
  type Response,
  type StorageMethod,
} from './protocol';
import type { SyncControl, SyncState } from './sync';

/** An `Error` from the worker; `code` is set for sync server errors. */
export class WorkerError extends Error {
  readonly code: string | undefined;

  constructor(name: string, message: string, code?: string) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

/** Main-thread `Storage` and `SyncControl` backed by the database worker. */
export function createWorkerClient(worker: Worker): {
  storage: Storage;
  sync: SyncControl;
  onSyncState(listener: (state: SyncState) => void): void;
} {
  let nextId = 0;
  const pending = new Map<number, PromiseWithResolvers<unknown>>();
  const listeners = new Set<ChangeListener>();
  const syncListeners = new Set<(state: SyncState) => void>();

  worker.addEventListener('message', ({ data }: MessageEvent<Response>) => {
    if (data.type === 'change') {
      const entities = new Set<Entity>(data.entities);
      for (const listener of listeners) listener(entities);
      return;
    }
    if (data.type === 'sync') {
      for (const listener of syncListeners) listener(data.state);
      return;
    }
    const call = pending.get(data.id);
    pending.delete(data.id);
    if (data.type === 'result') call?.resolve(data.result);
    else call?.reject(new WorkerError(data.error.name, data.error.message, data.error.code));
  });

  const call = (target: Request['target'], method: string, args: unknown[]) => {
    const id = nextId++;
    const result = Promise.withResolvers<unknown>();
    pending.set(id, result);
    worker.postMessage({ id, target, method, args } as Request);
    return result.promise;
  };
  const proxy = <T>(target: Request['target'], methods: readonly string[]) =>
    Object.fromEntries(
      methods.map((method) => [method, (...args: unknown[]) => call(target, method, args)]),
    ) as T;

  return {
    storage: {
      ...proxy<Pick<Storage, StorageMethod>>('storage', storageMethods),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    sync: proxy<SyncControl>('sync', syncMethods),
    onSyncState: (listener) => void syncListeners.add(listener),
  };
}
