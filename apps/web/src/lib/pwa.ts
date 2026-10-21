import { createSignal } from 'solid-js';
import { isNative } from './desktop';

const CHECK_INTERVAL = 60 * 60 * 1000;

const [waiting, setWaiting] = createSignal<ServiceWorker | null>(null);

/** Whether a new version of the app has been downloaded and waits for `applyUpdate`. */
export const updateReady = () => waiting() !== null;

/**
 * Registers the service worker that keeps the app shell for offline use. Browser builds only:
 * the native shells bundle the app and development serves it fresh.
 */
export function installServiceWorker() {
  if (!import.meta.env.PROD || isNative || !('serviceWorker' in navigator)) return;
  // A new worker taking over means an update was applied, in this or another tab; the old page
  // can no longer load its chunks. The first worker also takes over, without a reload.
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  void navigator.serviceWorker.register('sw.js').then((registration) => {
    const watch = (worker: ServiceWorker) =>
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
      });
    if (registration.waiting) setWaiting(registration.waiting);
    if (registration.installing) watch(registration.installing);
    registration.addEventListener('updatefound', () => watch(registration.installing!));

    // Browsers only look for a new worker on navigation, which an installed app rarely does.
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < CHECK_INTERVAL) return;
      checked = Date.now();
      registration.update().catch(() => {});
    });
  });
}

/** Switches to the waiting version; every open tab then reloads. */
export function applyUpdate() {
  waiting()?.postMessage({ type: 'skip-waiting' });
}
