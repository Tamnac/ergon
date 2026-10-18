import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { persistedSignal } from './persisted';

/** Whether the app runs in the Tauri shell, with native storage, instead of a browser. */
export const isNative = isTauri();

/** Whether the shell is the Android app. */
export const isAndroid = isNative && navigator.userAgent.includes('Android');

/** Whether the shell is the desktop app, with a tray, shortcut and window. */
export const isDesktop = isNative && !isAndroid;

/** Hide the window instead of quitting when it is closed; the tray icon quits. */
export const [closeToTray, setCloseToTray] = persistedSignal('ergon.closeToTray', false);

/** The global shortcut that opens the window to add a todo, as shown to the user. */
export const quickAddShortcut = navigator.userAgent.includes('Mac')
  ? '⌘ + Shift + Space'
  : 'Ctrl + Shift + Space';

/** Whether the shell could register the quick-add shortcut; another app may own it. */
export const quickAddAvailable = (): Promise<boolean> =>
  invoke<boolean>('quick_add_shortcut_registered');

/** Connects the window to the tray and the global quick-add shortcut. Returns a cleanup. */
export function installDesktop(onQuickAdd: () => void): () => void {
  const window = getCurrentWindow();
  const unlisten = [
    listen('quick-add', onQuickAdd),
    window.onCloseRequested((event) => {
      if (!closeToTray()) return;
      event.preventDefault();
      void window.hide();
    }),
  ];
  return () => unlisten.forEach((promise) => void promise.then((fn) => fn()));
}
