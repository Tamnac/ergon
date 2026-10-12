import { addDays, schedule } from '@ergon/core';
import { invoke } from '@tauri-apps/api/core';
import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import { isDesktop } from '../lib/desktop';
import { persistedSignal } from '../lib/persisted';
import { clearReminderKey, saveReminderKey } from '../lib/push-key';
import { storage } from './storage';
import { sync, syncState } from './sync';
import { today } from './today';

const HORIZON_DAYS = 14;
/** The desktop shell holds this many upcoming reminders, the server this many per account. */
const NATIVE_LIMIT = 50;
const SERVER_LIMIT = 100;
/** The desktop shell still shows reminders that came due this long ago, e.g. while it was off. */
const GRACE = 60 * 60 * 1000;
const DEBOUNCE = 500;

/** Whether this device shows reminders. A browser also needs push permission and sync. */
export const [remindersOn, setRemindersOn] = persistedSignal('ergon.reminders', isDesktop);

/** Whether this browser can receive pushed reminders. */
export const pushSupported =
  !isDesktop && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const syncOn = () => syncState().state !== 'off';

export async function enableReminders(): Promise<void> {
  if (!isDesktop) await subscribe();
  setRemindersOn(true);
}

export async function disableReminders(): Promise<void> {
  setRemindersOn(false);
  if (isDesktop) return;
  await sync.deletePush().catch(() => {});
  await dropPush();
}

async function dropPush() {
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  await clearReminderKey();
}

/** Registers this browser for pushed reminders; `reuse` keeps an existing subscription. */
async function subscribe(reuse = false) {
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error('Notifications are blocked for this site.');
  }
  const registration = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const { vapid, key } = await sync.pushSetup();
  await saveReminderKey(key);
  let subscription = await registration.pushManager.getSubscription();
  if (!reuse || !subscription) {
    // A subscription made for another server's key can't be reused.
    await subscription?.unsubscribe();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapid,
    });
  }
  const { endpoint, keys } = subscription.toJSON();
  await sync.putPush({ endpoint: endpoint!, p256dh: keys!.p256dh!, auth: keys!.auth! });
}

/** A new sign-in is a new device on the server, without this browser's subscription. */
async function restorePush() {
  try {
    await subscribe(true);
  } catch (error) {
    console.error(error);
    if (Notification.permission !== 'granted') setRemindersOn(false);
  }
}

/**
 * Hands the upcoming reminders to the desktop shell, which shows them offline, and to the
 * sync server, which pushes them to browsers. Every signed-in device uploads, so completing
 * a todo on one cancels its reminder on the others. Uploads wait for the sync to catch up, so
 * a stale local state never replaces the server's.
 */
async function publish() {
  const day = today();
  const reminders = await storage.reminders(addDays(day, -1), addDays(day, HORIZON_DAYS));
  const now = Date.now();
  const tasks: Promise<unknown>[] = [];
  if (isDesktop) {
    const upcoming = remindersOn() ? schedule(reminders, now - GRACE, NATIVE_LIMIT) : [];
    tasks.push(invoke('set_reminders', { reminders: upcoming }));
  }
  if (syncState().state === 'synced') {
    tasks.push(sync.putReminders(schedule(reminders, now, SERVER_LIMIT)));
  }
  await Promise.all(tasks);
}

let running: Promise<void> | undefined;
let again = false;

/** Runs `publish` one at a time, again if asked meanwhile, so the last state wins. */
function update(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await publish();
    } while (again);
  })().finally(() => (running = undefined));
  return running;
}

/** Keeps the desktop shell and the server up to date with the reminders. Call within a component. */
export function installReminders() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void update().catch((error) => console.error(error)), DEBOUNCE);
  };
  const unsubscribe = storage.subscribe((changed) => {
    if (changed.has('todo') || changed.has('recurrence')) request();
  });
  onCleanup(() => {
    unsubscribe();
    clearTimeout(timer);
  });

  const status = createMemo(() => syncState().state);
  createEffect(on([remindersOn, status, today], request));

  const signedIn = createMemo(syncOn);
  createEffect(
    on(
      signedIn,
      (now, was) => {
        if (!pushSupported) return;
        if (now && remindersOn()) void restorePush();
        else if (was && !now) void dropPush();
      },
      { defer: true },
    ),
  );
}
