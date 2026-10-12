import { isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { createWorkerClient, type DatabaseClient } from '../db/client';
import { createNativeClient } from '../db/native';

export const worker: DatabaseClient = isTauri()
  ? createNativeClient()
  : createWorkerClient(
      new Worker(new URL('../db/worker.ts', import.meta.url), { type: 'module', name: 'ergon-db' }),
    );
export const storage = worker.storage;

export const [storageError, setStorageError] = createSignal<unknown>();
