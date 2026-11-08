import { Show, createEffect, onCleanup, onMount } from 'solid-js';
import { Calendar } from './components/Calendar';
import { DayGrid } from './components/DayGrid';
import { Header } from './components/Header';
import { HelpDialog } from './components/HelpDialog';
import { HistoryZoom } from './components/HistoryZoom';
import { ListsPanel, TabBar } from './components/ListsPanel';
import { ReminderDialog } from './components/ReminderDialog';
import { RepeatDialog } from './components/RepeatDialog';
import { ScopeDialog } from './components/ScopeDialog';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { SyncDialog } from './components/SyncDialog';
import { UpdatePrompt } from './components/UpdatePrompt';
import { applyAccent } from './lib/accent';
import { setEffectLayer } from './lib/effects';
import { installDesktop, isDesktop, isNative } from './lib/desktop';
import { updateFavicon } from './lib/favicon';
import { installServiceWorker } from './lib/pwa';
import { addToToday, installShortcuts } from './lib/shortcuts';
import { isPhone } from './lib/viewport';
import { addGroup } from './state/actions';
import { groups, groupsReady, settings, settingsReady } from './state/data';
import { installReminders } from './state/reminders';
import { storageError } from './state/storage';
import { pendingLink, setSyncOpen } from './state/sync';
import { mobileView } from './state/view';

/** Fixed id so devices that seed concurrently end up with the same tab. */
const DEFAULT_GROUP_ID = 'default';

export function App() {
  createEffect(() => {
    if (!settingsReady()) return;
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    const derived = applyAccent(settings.accent);
    updateFavicon(settings.theme, settings.accent);
    localStorage.setItem(
      'ergon.appearance',
      JSON.stringify({ theme: settings.theme, accent: settings.accent, ...derived }),
    );
  });

  createEffect(() => {
    if (groupsReady() && groups.length === 0) void addGroup('Personal', DEFAULT_GROUP_ID);
  });

  onMount(() => onCleanup(installShortcuts()));
  onMount(() => {
    if (isDesktop) onCleanup(installDesktop(addToToday));
  });
  installReminders();
  onMount(installServiceWorker);
  onMount(() => {
    if (pendingLink()) setSyncOpen(true);
  });

  const showDays = () => !isPhone() || mobileView() === 'days';
  const showLists = () => !isPhone() || mobileView() === 'lists';

  return (
    <div class="app" classList={{ 'is-phone': isPhone() }}>
      <Show when={showDays()}>
        <Header />
      </Show>
      <main class="main">
        <Show when={storageError()}>
          <p class="error" role="alert">
            Local storage is unavailable, so changes can't be saved.{' '}
            {isNative
              ? String(storageError())
              : 'This browser may not support the Origin Private File System, or it is disabled in private mode.'}
          </p>
        </Show>
        <Show when={showDays()}>
          <DayGrid />
        </Show>
        <Show when={showLists()}>
          <ListsPanel />
        </Show>
      </main>
      <Show when={showLists()}>
        <TabBar />
      </Show>
      <Sidebar />
      <div class="effect-layer" ref={setEffectLayer} />
      <SettingsDialog />
      <SyncDialog />
      <HelpDialog />
      <SearchDialog />
      <RepeatDialog />
      <ReminderDialog />
      <ScopeDialog />
      <Calendar />
      <HistoryZoom />
      <UpdatePrompt />
    </div>
  );
}
