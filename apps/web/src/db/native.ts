import { invoke } from '@tauri-apps/api/core';
import { Database, type ChangeListener, type SecretStore, type SqlDriver } from '@ergon/core';
import type { DatabaseClient } from './client';
import { storageMethods, syncMethods } from './protocol';
import { createSync, type SyncState } from './sync';

/** Rust commands reject with a plain string. */
async function call<T = void>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw typeof error === 'string' ? new Error(error) : error;
  }
}

/** SQLite in the desktop app's Rust process. */
const driver: SqlDriver = {
  exec: (sql) => call('sql_exec', { sql }),
  query: (sql, params = []) => call('sql_query', { sql, params }),
};

/** The OS keychain. */
const secrets: SecretStore = {
  get: async (key) => (await call<string | null>('secret_get', { key })) ?? undefined,
  set: (key, value) => call('secret_set', { key, value: value ?? null }),
};

/** The shell keeps one connection, so a transaction left open by a reloaded page must end. */
async function openDatabase(): Promise<Database> {
  await driver.exec('ROLLBACK').catch(() => {});
  return Database.open(driver, Date.now, secrets);
}

/** The database and sync engine on the main thread, for the desktop app. */
export function createNativeClient(): DatabaseClient {
  const listeners = new Set<ChangeListener>();
  const syncListeners = new Set<(state: SyncState) => void>();

  const ready = openDatabase().then((db) => {
    const sync = createSync(db, (state) => syncListeners.forEach((listener) => listener(state)), {
      app: 'Ergon Desktop',
    });
    db.subscribe((changed) => {
      listeners.forEach((listener) => listener(changed));
      sync.changed();
    });
    return { db, sync };
  });

  const forward = <T>(service: 'db' | 'sync', methods: readonly string[]) =>
    Object.fromEntries(
      methods.map((method) => [
        method,
        async (...args: unknown[]) => {
          const target = (await ready)[service];
          const fn = target[method as keyof typeof target] as (...args: unknown[]) => unknown;
          return fn.apply(target, args);
        },
      ]),
    ) as T;

  return {
    storage: {
      ...forward<DatabaseClient['storage']>('db', storageMethods),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    sync: forward<DatabaseClient['sync']>('sync', syncMethods),
    onSyncState: (listener) => void syncListeners.add(listener),
  };
}
