import { ImportError, type DayCount, type InkDetail, type Theme } from '@ergon/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { updateSettings } from '../state/actions';
import {
  closeToTray,
  isAndroid,
  isDesktop,
  isNative,
  quickAddAvailable,
  quickAddShortcut,
  setCloseToTray,
} from '../lib/desktop';
import { applyAccent } from '../lib/accent';
import { effectChoices } from '../lib/effects';
import { RANDOM, type EffectFrequency, type EffectIntensity } from '../lib/effect-policy';
import {
  effectChoice,
  effectFrequency,
  effectHaptics,
  effectIntensity,
  effectSound,
  setEffectChoice,
  setEffectFrequency,
  setEffectHaptics,
  setEffectIntensity,
  setEffectSound,
} from '../lib/effect-settings';
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
  exactAlarmsAllowed,
  openExactAlarmSettings,
  pushSupported,
  remindersOn,
  syncOn,
} from '../state/reminders';
import { exportAs, importTeuxDeux } from '../state/transfer';
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
const effectIntensities: [EffectIntensity, string][] = [
  ['off', 'Off'],
  ['subtle', 'Subtle'],
  ['dramatic', 'Dramatic'],
];
const effectFrequencies: [EffectFrequency, string][] = [
  ['milestones', 'Sections and days'],
  ['sometimes', 'Now and then'],
  ['always', 'Every todo'],
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
          <label
            class="color-custom"
            classList={{ 'is-selected': !accents.includes(settings.accent) }}
            title="Custom color"
          >
            <input
              type="color"
              aria-label="Custom accent color"
              value={settings.accent}
              onInput={(e) => applyAccent(e.currentTarget.value)}
              onChange={(e) => void updateSettings({ accent: e.currentTarget.value })}
            />
            <span
              class="color-custom-swatch"
              style={{
                background: accents.includes(settings.accent) ? undefined : settings.accent,
              }}
            />
          </label>
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

      <Show when={effectChoices().length > 0}>
        <EffectSettings />
      </Show>

      <HandwritingSettings />

      <DataSettings />

      <Show when={isDesktop}>
        <DesktopSettings />
      </Show>
    </Dialog>
  );
}

function ReminderSettings() {
  const [error, setError] = createSignal<string>();
  const available = () => isNative || (pushSupported && syncOn());

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
      <label class="checkbox">
        <input
          type="checkbox"
          checked={remindersOn() && available()}
          disabled={!available()}
          onChange={(e) => void toggle(e.currentTarget.checked)}
        />
        Remind me on this device
      </label>
      <Show when={!isNative && !available()}>
        <span class="sync-hint">
          {pushSupported
            ? 'Sign in to sync to get reminders in the browser.'
            : "This browser can't show reminders when Ergon is closed."}
        </span>
      </Show>
      <Show when={isAndroid && remindersOn()}>
        <ExactAlarmHint />
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

function DataSettings() {
  let file!: HTMLInputElement;
  const [message, setMessage] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);

  const report = (text: string, error = false) => {
    setFailed(error);
    setMessage(text);
  };

  const run = async (task: () => Promise<string | void>) => {
    report('');
    try {
      const done = await task();
      if (done) report(done);
    } catch (cause) {
      report(cause instanceof ImportError ? cause.message : `Failed: ${String(cause)}`, true);
    }
  };

  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  const importFile = (selected: File | undefined) =>
    run(async () => {
      if (!selected) return;
      const { todos, lists } = await importTeuxDeux(selected);
      return `Imported ${plural(todos, 'todo')} and ${plural(lists, 'list')}.`;
    });

  return (
    <fieldset class="field">
      <legend class="field-label">Your data</legend>
      <div class="field-row">
        <button type="button" class="button" onClick={() => void run(() => exportAs('json'))}>
          Export JSON
        </button>
        <button type="button" class="button" onClick={() => void run(() => exportAs('markdown'))}>
          Export Markdown
        </button>
      </div>
      <div class="field-row">
        <button type="button" class="button" onClick={() => file.click()}>
          Import from TeuxDeux
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,.csv,application/json,text/csv"
          aria-label="TeuxDeux backup file"
          onChange={(e) => {
            const selected = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            void importFile(selected);
          }}
        />
      </div>
      <span class="sync-hint">
        Import the data.json or data.csv of a TeuxDeux backup. Todos are added to their days, and
        its lists as a new tab.
      </span>
      <Show when={message()}>
        {(text) => (
          <span class="sync-hint" role={failed() ? 'alert' : 'status'}>
            {text()}
          </span>
        )}
      </Show>
    </fieldset>
  );
}

function ExactAlarmHint() {
  const [allowed, { refetch }] = createResource(exactAlarmsAllowed);
  const recheck = () => {
    if (document.visibilityState === 'visible') void refetch();
  };
  onMount(() => {
    document.addEventListener('visibilitychange', recheck);
    onCleanup(() => document.removeEventListener('visibilitychange', recheck));
  });

  return (
    <Show when={allowed() === false}>
      <span class="sync-hint">
        Android may show reminders minutes late unless Ergon can set exact alarms.
      </span>
      <button type="button" class="button" onClick={() => void openExactAlarmSettings()}>
        Allow exact alarms
      </button>
    </Show>
  );
}

function EffectSettings() {
  return (
    <fieldset class="field">
      <legend class="field-label">Completion effects</legend>
      <div class="segmented" role="radiogroup" aria-label="Intensity">
        <For each={effectIntensities}>
          {([value, label]) => (
            <label>
              <input
                type="radio"
                name="effectIntensity"
                checked={effectIntensity() === value}
                onChange={() => setEffectIntensity(value)}
              />
              {label}
            </label>
          )}
        </For>
      </div>
      <Show when={effectIntensity() !== 'off'}>
        <div class="segmented" role="radiogroup" aria-label="When">
          <For each={effectFrequencies}>
            {([value, label]) => (
              <label>
                <input
                  type="radio"
                  name="effectFrequency"
                  checked={effectFrequency() === value}
                  onChange={() => setEffectFrequency(value)}
                />
                {label}
              </label>
            )}
          </For>
        </div>
        <select
          class="select"
          aria-label="Effect"
          value={effectChoice()}
          onChange={(e) => setEffectChoice(e.currentTarget.value)}
        >
          <option value={RANDOM}>Random</option>
          <For each={effectChoices()}>
            {(choice) => <option value={choice.name}>{choice.label}</option>}
          </For>
        </select>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={effectSound()}
            onChange={(e) => setEffectSound(e.currentTarget.checked)}
          />
          Play sounds
        </label>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={effectHaptics()}
            onChange={(e) => setEffectHaptics(e.currentTarget.checked)}
          />
          Vibrate on impact
        </label>
        <span class="sync-hint">
          Finishing the last todo under a heading, or the last on a day or list, always gets an
          effect. Other todos follow the setting above. Nothing plays when the system asks for
          reduced motion.
        </span>
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
      <span class="sync-hint">
        Ergon simplifies your strokes to save data. Compact has a bit less detail but will make the
        app a bit leaner
      </span>
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
