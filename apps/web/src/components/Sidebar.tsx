import { For, Show } from 'solid-js';
import { isPhone } from '../lib/viewport';
import { canUndo, undo } from '../state/actions';
import { setSyncOpen, syncState } from '../state/sync';
import { mobileView, setHelpOpen, setMobileView, setSettingsOpen } from '../state/view';
import { IconButton } from './Icon';
import { statusText } from './SyncDialog';
import './Sidebar.css';

const views = [
  ['days', 'Days'],
  ['lists', 'Lists'],
] as const;

/** App chrome: a full-height strip on the right, a bottom bar on phones. */
export function Sidebar() {
  const actions = (
    <div class="sidebar-actions">
      <IconButton icon="undo" label="Undo" disabled={!canUndo()} onClick={() => void undo()} />
      <IconButton
        icon="cloud"
        label={`Sync: ${statusText(syncState())}`}
        class={`sync-button is-${syncState().state}`}
        onClick={() => setSyncOpen(true)}
      />
      <IconButton icon="sliders" label="Settings" onClick={() => setSettingsOpen(true)} />
      <IconButton icon="help" label="Keyboard shortcuts" onClick={() => setHelpOpen(true)} />
    </div>
  );

  return (
    <aside class="sidebar">
      <h1 class="brand">
        Ergon<span class="brand-mark">*</span>
      </h1>
      <Show when={isPhone()} fallback={actions}>
        <div class="view-switch" role="group" aria-label="View">
          <For each={views}>
            {([view, label]) => (
              <button
                type="button"
                aria-pressed={mobileView() === view}
                onClick={() => setMobileView(view)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
        {actions}
      </Show>
    </aside>
  );
}
