import type { DayCount } from '@ergon/core';
import { For } from 'solid-js';
import { canUndo, undo, updateSettings } from '../state/actions';
import { settings } from '../state/data';
import { setHelpOpen, setSettingsOpen } from '../state/view';
import { IconButton } from './Icon';
import './Footer.css';

const dayCounts: DayCount[] = [1, 3, 5, 7];

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function Footer() {
  const dark = () => (settings.theme === 'system' ? prefersDark() : settings.theme === 'dark');

  return (
    <footer class="footer">
      <div class="footer-side">
        <IconButton icon="sliders" label="Settings" onClick={() => setSettingsOpen(true)} />
        <IconButton icon="undo" label="Undo" disabled={!canUndo()} onClick={() => void undo()} />
      </div>
      <div class="footer-center">
        <div class="day-count" role="group" aria-label="Visible days">
          <For each={dayCounts}>
            {(count) => (
              <button
                type="button"
                aria-pressed={settings.dayCount === count}
                aria-label={`${count} ${count === 1 ? 'day' : 'days'}`}
                onClick={() => void updateSettings({ dayCount: count })}
              >
                {count}
              </button>
            )}
          </For>
        </div>
        <IconButton
          icon={dark() ? 'sun' : 'moon'}
          label={dark() ? 'Light theme' : 'Dark theme'}
          onClick={() => void updateSettings({ theme: dark() ? 'light' : 'dark' })}
        />
      </div>
      <div class="footer-side footer-end">
        <IconButton icon="help" label="Keyboard shortcuts" onClick={() => setHelpOpen(true)} />
      </div>
    </footer>
  );
}
