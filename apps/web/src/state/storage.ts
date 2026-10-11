import { createSignal } from 'solid-js';
import { createWorkerClient } from '../db/client';

export const worker = createWorkerClient(
  new Worker(new URL('../db/worker.ts', import.meta.url), { type: 'module', name: 'ergon-db' }),
);
export const storage = worker.storage;

export const [storageError, setStorageError] = createSignal<unknown>();
