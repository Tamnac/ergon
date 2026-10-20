import { fromBase64, unseal, type ReminderPayload } from '@ergon/core';
import { loadReminderKey } from './lib/push-key';

/** Files to keep for offline use, injected by the build; empty in development. */
declare const SW_PRECACHE: { version: string; urls: string[] };

// The DOM types of the app don't include the service worker ones.
interface WaitEvent {
  waitUntil(promise: Promise<unknown>): void;
}
type PushEvent = WaitEvent & { data: { text(): string } | null };
type ClickEvent = WaitEvent & { notification: Notification };
type FetchEvent = { request: Request; respondWith(response: Promise<Response>): void };
type MessageEvent = { data: unknown };
interface WindowClient {
  focus(): Promise<unknown>;
}

const scope = self as unknown as {
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll(options: { type: 'window' }): Promise<WindowClient[]>;
    openWindow(url: string): Promise<unknown>;
    claim(): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: WaitEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: ClickEvent) => void): void;
};

const CACHE_PREFIX = 'ergon-';
const cacheName = CACHE_PREFIX + SW_PRECACHE.version;
const precaching = SW_PRECACHE.urls.length > 0;
const inScope = (path: string) => new URL(path, scope.registration.scope);

// An updated worker waits for the page to ask for it (`applyUpdate`), except on first install.
scope.addEventListener('install', (event) => {
  if (!precaching) return;
  const requests = SW_PRECACHE.urls.map((url) => new Request(inScope(url), { cache: 'reload' }));
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(requests)));
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'skip-waiting') void scope.skipWaiting();
});

/** The app shell from the cache, also for navigations to paths the server answers with it. */
scope.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!precaching || request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith(inScope('api/').pathname)) return;
  const key = request.mode === 'navigate' ? inScope('index.html') : request;
  event.respondWith(
    caches
      .open(cacheName)
      .then((cache) => cache.match(key, { ignoreSearch: true, ignoreVary: true }))
      .then((hit) => hit ?? fetch(request)),
  );
});

/** A pushed reminder is sealed with the account key; the push service only sees ciphertext. */
async function show(sealed: string | undefined) {
  let reminder: ReminderPayload = { id: 'reminder', text: 'Reminder' };
  try {
    const key = await loadReminderKey();
    if (sealed && key)
      reminder = await unseal<ReminderPayload>(fromBase64(key), 'reminder', sealed);
  } catch {
    // A notification must be shown for every push, so the generic one stays.
  }
  await scope.registration.showNotification(reminder.text, { tag: reminder.id });
}

scope.addEventListener('push', (event) => event.waitUntil(show(event.data?.text())));

scope.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    scope.clients.matchAll({ type: 'window' }).then((windows) => {
      const open = windows[0];
      return open ? open.focus() : scope.clients.openWindow(scope.registration.scope);
    }),
  );
});
