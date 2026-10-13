import { isTime, type DayCount, type InkDetail, type Theme } from '@ergon/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { For, Show, createResource, createSignal } from 'solid-js';
import { updateSettings } from '../state/actions';
import {
  closeToTray,
  isDesktop,
  quickAddAvailable,
  quickAddShortcut,
  setCloseToTray,
} from '../lib/desktop';
import {
  inkDetail,
  inkPressure,
  inkSmoothing,
  setInkDetail,
  setInkPressure,
  setInkSmoothing,
} from '../lib/ink';
import { settings } from '../state/data';
import {
  disableReminders,
  enableReminders,
  pushSupported,
  remindersOn,
  syncOn,
} from '../state/reminders';
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
const inkDetails: [InkDetail, string][] = [
  ['fine', 'Fine'],
  ['compact', 'Compact'],
];
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

      <ReminderSettings />

      <HandwritingSettings />

      <Show when={isDesktop}>
        <DesktopSettings />
      </Show>
    </Dialog>
  );
}

function ReminderSettings() {
  const [error, setError] = createSignal<string>();
  const available = () => isDesktop || (pushSupported && syncOn());

  const toggle = async (on: boolean) => {
    setError();
    try {
      await (on ? enableReminders() : disableReminders());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <fieldset class="field">
      <legend class="field-label">Reminders</legend>
      <label class="field-row">
        Default time
        <input
          class="input"
          type="time"
          required
          value={settings.reminderTime}
          onChange={(e) => {
            if (isTime(e.currentTarget.value)) {
              void updateSettings({ reminderTime: e.currentTarget.value });
            }
          }}
        />
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={remindersOn() && available()}
          disabled={!available()}
          onChange={(e) => void toggle(e.currentTarget.checked)}
        />
        Remind me on this device
      </label>
      <Show when={!isDesktop && !available()}>
        <span class="sync-hint">
          {pushSupported
            ? 'Sign in to sync to get reminders in the browser.'
            : "This browser can't show reminders when Ergon is closed."}
        </span>
      </Show>
      <Show when={error()}>
        {(message) => (
          <span class="sync-hint" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </fieldset>
  );
}

function HandwritingSettings() {
  return (
    <fieldset class="field">
      <legend class="field-label">Handwriting</legend>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={inkSmoothing()}
          onChange={(e) => setInkSmoothing(e.currentTarget.checked)}
        />
        Smooth strokes
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          checked={inkPressure()}
          onChange={(e) => setInkPressure(e.currentTarget.checked)}
        />
        Pressure changes stroke width
      </label>
      <div class="segmented" role="radiogroup" aria-label="Detail">
        <For each={inkDetails}>
          {([value, label]) => (
            <label>
              <input
                type="radio"
                name="inkDetail"
                checked={inkDetail() === value}
                onChange={() => setInkDetail(value)}
              />
              {label}
            </label>
          )}
        </For>
      </div>
      <span class="sync-hint">Compact stores less detail. It applies to what you write next.</span>
    </fieldset>
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
