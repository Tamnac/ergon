const DATABASE = 'ergon-push';
const STORE = 'keys';
const REMINDERS = 'reminders';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener('upgradeneeded', () => request.result.createObjectStore(STORE));
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  }).finally(() => db.close());
}

/**
 * The key (base64) the service worker unseals pushed reminders with. It lives in IndexedDB
 * because the service worker runs without the page.
 */
export const saveReminderKey = (key: string) =>
  run('readwrite', (store) => store.put(key, REMINDERS)).then(() => {});
export const loadReminderKey = (): Promise<string | undefined> =>
  run('readonly', (store) => store.get(REMINDERS) as IDBRequest<string | undefined>);
export const clearReminderKey = () =>
  run('readwrite', (store) => store.delete(REMINDERS)).then(() => {});
