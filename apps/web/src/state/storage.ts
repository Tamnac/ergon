import { createSignal } from 'solid-js';
import { createWorkerStorage } from '../db/client';

export const storage = createWorkerStorage(
  new Worker(new URL('../db/worker.ts', import.meta.url), { type: 'module', name: 'ergon-db' }),
);

export const [storageError, setStorageError] = createSignal<unknown>();
