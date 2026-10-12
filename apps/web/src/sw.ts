import { fromBase64, unseal, type ReminderPayload } from '@ergon/core';
import { loadReminderKey } from './lib/push-key';

// The DOM types of the app don't include the service worker ones.
interface WaitEvent {
  waitUntil(promise: Promise<unknown>): void;
}
type PushEvent = WaitEvent & { data: { text(): string } | null };
type ClickEvent = WaitEvent & { notification: Notification };
interface WindowClient {
  focus(): Promise<unknown>;
}

const scope = self as unknown as {
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll(options: { type: 'window' }): Promise<WindowClient[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: ClickEvent) => void): void;
};

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
