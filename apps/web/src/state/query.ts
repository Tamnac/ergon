import type { Entity } from '@ergon/core';
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { setStorageError, storage } from './storage';

/**
 * Store holding the result of `fetch`, refetched when its reactive inputs change or
 * the database reports a change to one of `entities`. Rows keep their identity by id.
 */
export function createQuery<T extends object>(
  entities: readonly Entity[],
  fetch: () => Promise<T>,
  initial: T,
): [data: T, ready: Accessor<boolean>] {
  const [data, setData] = createStore<T>(initial);
  const [ready, setReady] = createSignal(false);
  const [version, setVersion] = createSignal(0);

  onCleanup(
    storage.subscribe((changed) => {
      if (entities.some((entity) => changed.has(entity))) setVersion((v) => v + 1);
    }),
  );

  let latest = 0;
  createEffect(() => {
    version();
    const run = ++latest;
    fetch().then((value) => {
      if (run !== latest) return;
      setData(reconcile(value, { key: 'id' }));
      setReady(true);
      setStorageError(undefined);
    }, setStorageError);
  });

  return [data, ready];
}
