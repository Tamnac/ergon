import { Show, createEffect, onCleanup, onMount } from 'solid-js';
import { DayGrid } from './components/DayGrid';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { ListsPanel } from './components/ListsPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { readableOn } from './lib/color';
import { setEffectLayer } from './lib/effects';
import { installShortcuts } from './lib/shortcuts';
import { addGroup } from './state/actions';
import { groups, groupsReady, settings, settingsReady } from './state/data';
import { storageError } from './state/storage';

/** Fixed id so devices that seed concurrently end up with the same tab. */
const DEFAULT_GROUP_ID = 'default';

export function App() {
  createEffect(() => {
    if (!settingsReady()) return;
    const root = document.documentElement;
    const accentFg = readableOn(settings.accent);
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--accent-fg', accentFg);
    localStorage.setItem(
      'ergon.appearance',
      JSON.stringify({ theme: settings.theme, accent: settings.accent, accentFg }),
    );
  });

  createEffect(() => {
    if (groupsReady() && groups.length === 0) void addGroup('Personal', DEFAULT_GROUP_ID);
  });

  onMount(() => onCleanup(installShortcuts()));

  return (
    <>
      <Header />
      <main class="main">
        <Show when={storageError()}>
          <p class="error" role="alert">
            Local storage is unavailable, so changes can't be saved. This browser may not support
            the Origin Private File System, or it is disabled in private mode.
          </p>
        </Show>
        <DayGrid />
        <ListsPanel />
      </main>
      <Footer />
      <div class="effect-layer" ref={setEffectLayer} />
      <SettingsDialog />
      <HelpDialog />
    </>
  );
}
