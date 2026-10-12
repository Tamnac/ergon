import type { DayCount, Theme } from '@ergon/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { For, Show, createResource } from 'solid-js';
import { updateSettings } from '../state/actions';
import {
  closeToTray,
  isDesktop,
  quickAddAvailable,
  quickAddShortcut,
  setCloseToTray,
} from '../lib/desktop';
import { settings } from '../state/data';
import { setSettingsOpen, settingsOpen } from '../state/view';
import { Dialog } from './Dialog';

const accents = [
  '#6d28d9',
  '#2563eb',
  '#0d9488',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#e11d48',
  '#111111',
];
const themes: [Theme, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
];
const dayCounts: DayCount[] = [1, 3, 5, 7];
const weekStarts: [string, string][] = [
  ['', 'Locale default'],
  ['1', 'Monday'],
  ['0', 'Sunday'],
  ['6', 'Saturday'],
];

export function SettingsDialog() {
  return (
    <Dialog title="Settings" open={settingsOpen()} onClose={() => setSettingsOpen(false)}>
      <fieldset class="field">
        <legend class="field-label">Accent color</legend>
        <div class="swatches">
          <For each={accents}>
            {(color) => (
              <button
                type="button"
                class="swatch"
                style={{ background: color }}
                aria-label={color}
                aria-pressed={settings.accent === color}
                onClick={() => void updateSettings({ accent: color })}
              />
            )}
          </For>
          <input
            type="color"
            class="color-input"
            aria-label="Custom accent color"
            value={settings.accent}
            onInput={(e) =>
              document.documentElement.style.setProperty('--accent', e.currentTarget.value)
            }
            onChange={(e) => void updateSettings({ accent: e.currentTarget.value })}
          />
        </div>
      </fieldset>

      <fieldset class="field">
        <legend class="field-label">Theme</legend>
        <div class="segmented">
          <For each={themes}>
            {([value, label]) => (
              <label>
                <input
                  type="radio"
                  name="theme"
                  checked={settings.theme === value}
                  onChange={() => void updateSettings({ theme: value })}
                />
                {label}
              </label>
            )}
          </For>
        </div>
      </fieldset>

      <fieldset class="field">
        <legend class="field-label">Visible days</legend>
        <div class="segmented">
          <For each={dayCounts}>
            {(count) => (
              <label>
                <input
                  type="radio"
                  name="dayCount"
                  checked={settings.dayCount === count}
                  onChange={() => void updateSettings({ dayCount: count })}
                />
                {count}
              </label>
            )}
          </For>
        </div>
      </fieldset>

      <label class="field">
        <span class="field-label">Week starts on</span>
        <select
          class="select"
          value={settings.weekStart?.toString() ?? ''}
          onChange={(e) => {
            const value = e.currentTarget.value;
            void updateSettings({ weekStart: value === '' ? null : Number(value) });
          }}
        >
          <For each={weekStarts}>{([value, label]) => <option value={value}>{label}</option>}</For>
        </select>
      </label>

      <label class="checkbox">
        <input
          type="checkbox"
          checked={settings.condensedWeekends}
          onChange={(e) => void updateSettings({ condensedWeekends: e.currentTarget.checked })}
        />
        Condensed weekends
      </label>

      <Show when={isDesktop}>
        <DesktopSettings />
      </Show>
    </Dialog>
  );
}

function DesktopSettings() {
  const [autostart, { mutate }] = createResource(isEnabled);
  const [shortcutAvailable] = createResource(quickAddAvailable);
  const toggleAutostart = async (on: boolean) => {
    await (on ? enable() : disable());
    mutate(on);
  };

  return (
    <fieldset class="field">
      <legend class="field-label">This computer</legend>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={autostart() ?? false}
          disabled={autostart.loading}
          onChange={(e) => void toggleAutostart(e.currentTarget.checked)}
        />
        Start at login
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={closeToTray()}
          onChange={(e) => setCloseToTray(e.currentTarget.checked)}
        />
        Keep running in the tray when closed
      </label>
      <span class="sync-hint">
        {shortcutAvailable() === false
          ? `${quickAddShortcut} is used by another app, so it can't open Ergon.`
          : `${quickAddShortcut} opens Ergon from anywhere to add a todo.`}
      </span>
    </fieldset>
  );
}
