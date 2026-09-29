import {
  addDays,
  addMonths,
  effectiveDate,
  occurrences,
  parseDate,
  parseRule,
  type Recurrence,
  type Todo,
} from '@ergon/core';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  formFor,
  ruleOf,
  weekdayPosition,
  type Ends,
  type MonthlyBy,
  type RepeatForm,
  type RepeatMode,
} from '../lib/repeat';
import { setRepeat } from '../state/actions';
import { recurrences, weekStart } from '../state/data';
import { today } from '../state/today';
import { repeating, setRepeating } from '../state/view';
import { Dialog } from './Dialog';

const modes: [RepeatMode, string][] = [
  ['none', "Don't repeat"],
  ['daily', 'Daily'],
  ['weekdays', 'Every weekday'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
  ['custom', 'Custom rule'],
];
const units: Partial<Record<RepeatMode, string>> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};
const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'];
/** A Sunday, to name weekdays by index. */
const SUNDAY = '2026-01-04';
const PREVIEW_COUNT = 5;

const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
const previewFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function RepeatDialog() {
  /** The todo and its recurrence, once that has loaded. */
  const editing = createMemo(
    () => {
      const todo = repeating();
      const recurrence = recurrences.find((r) => r.id === todo?.recurrenceId);
      return todo && (todo.recurrenceId === null || recurrence) ? { todo, recurrence } : null;
    },
    null,
    { equals: (a, b) => a?.todo === b?.todo && a?.recurrence === b?.recurrence },
  );
  return (
    <Dialog title="Repeat" open={repeating() !== null} onClose={() => setRepeating(null)}>
      <Show when={editing()} keyed>
        {({ todo, recurrence }) => (
          <RepeatEditor todo={todo} recurrence={recurrence} onDone={() => setRepeating(null)} />
        )}
      </Show>
    </Dialog>
  );
}

function RepeatEditor(props: {
  todo: Todo;
  recurrence: Recurrence | undefined;
  onDone: () => void;
}) {
  const { todo, recurrence } = props;
  const date = todo.occurrence ?? effectiveDate(todo, today()) ?? today();
  const [form, setForm] = createStore<RepeatForm>(formFor(recurrence?.rrule ?? null, date));
  /** Whether "this and following" differs from "all". */
  const splittable = recurrence !== undefined && date > recurrence.startDate;
  const [scope, setScope] = createSignal<'following' | 'all'>('following');

  const result = createMemo((): { rrule: string | null } | { error: string } => {
    try {
      return { rrule: ruleOf(form, date) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  const error = () => {
    const r = result();
    return 'error' in r ? r.error : undefined;
  };
  const rrule = () => {
    const r = result();
    return 'rrule' in r ? r.rrule : null;
  };

  const preview = createMemo(() => {
    const rule = rrule();
    if (rule === null) return [];
    const start = recurrence && splittable && scope() === 'all' ? recurrence.startDate : date;
    const from = start > today() ? start : today();
    return occurrences(parseRule(rule), start, from, addMonths(from, 120)).slice(0, PREVIEW_COUNT);
  });

  const weekdayName = weekdayLong.format(parseDate(date));
  const position = weekdayPosition(date);
  const weekDays = () => Array.from({ length: 7 }, (_, i) => (weekStart() + i) % 7);
  const interval = () => units[form.mode];

  const selectMode = (mode: RepeatMode) => {
    const current = rrule();
    if (mode === 'custom' && current !== null) setForm('custom', current);
    setForm('mode', mode);
  };

  const toggleDay = (day: number, on: boolean) =>
    setForm('days', (days) => (on ? [...days, day] : days.filter((d) => d !== day)));

  const save = (event: SubmitEvent) => {
    event.preventDefault();
    if (error() !== undefined) return;
    const rule = rrule();
    if (rule !== (recurrence?.rrule ?? null)) {
      void setRepeat(todo, rule, splittable ? scope() : 'all');
    }
    props.onDone();
  };

  return (
    <form class="repeat-form" onSubmit={save}>
      <label class="field">
        <span class="field-label">Repeat</span>
        <select
          class="select"
          autofocus
          value={form.mode}
          onChange={(e) => selectMode(e.currentTarget.value as RepeatMode)}
        >
          <For each={modes}>{([value, label]) => <option value={value}>{label}</option>}</For>
        </select>
      </label>

      <Show when={interval()}>
        {(unit) => (
          <label class="field">
            <span class="field-label">Every</span>
            <span class="field-row">
              <input
                class="input input-number"
                type="number"
                min="1"
                value={form.interval}
                onInput={(e) => setForm('interval', e.currentTarget.valueAsNumber)}
              />
              {form.interval === 1 ? unit() : `${unit()}s`}
            </span>
          </label>
        )}
      </Show>

      <Show when={form.mode === 'weekly'}>
        <fieldset class="field">
          <legend class="field-label">On</legend>
          <div class="segmented">
            <For each={weekDays()}>
              {(day) => (
                <label>
                  <input
                    type="checkbox"
                    checked={form.days.includes(day)}
                    onChange={(e) => toggleDay(day, e.currentTarget.checked)}
                  />
                  {weekdayShort.format(parseDate(addDays(SUNDAY, day)))}
                </label>
              )}
            </For>
          </div>
        </fieldset>
      </Show>

      <Show when={form.mode === 'monthly'}>
        <label class="field">
          <span class="field-label">On</span>
          <select
            class="select"
            value={form.monthlyBy}
            onChange={(e) => setForm('monthlyBy', e.currentTarget.value as MonthlyBy)}
          >
            <option value="day">Day {Number(date.slice(8))}</option>
            <option value="weekday">
              The {ordinals[position.nth - 1]} {weekdayName}
            </option>
            <Show when={position.fromEnd === -1}>
              <option value="last-weekday">The last {weekdayName}</option>
            </Show>
            <option value="last-day">The last day</option>
          </select>
        </label>
      </Show>

      <Show when={form.mode === 'custom'}>
        <label class="field">
          <span class="field-label">Rule (RRULE)</span>
          <input
            class="input"
            spellcheck={false}
            value={form.custom}
            placeholder="FREQ=WEEKLY;BYDAY=MO,TH"
            onInput={(e) => setForm('custom', e.currentTarget.value)}
          />
        </label>
      </Show>

      <Show when={form.mode !== 'none' && form.mode !== 'custom'}>
        <div class="field">
          <span class="field-label">Ends</span>
          <span class="field-row">
            <select
              class="select"
              aria-label="Ends"
              value={form.ends}
              onChange={(e) => setForm('ends', e.currentTarget.value as Ends)}
            >
              <option value="never">Never</option>
              <option value="until">On</option>
              <option value="count">After</option>
            </select>
            <Show when={form.ends === 'until'}>
              <input
                class="input"
                type="date"
                aria-label="End date"
                min={date}
                value={form.until}
                onInput={(e) => setForm('until', e.currentTarget.value)}
              />
            </Show>
            <Show when={form.ends === 'count'}>
              <input
                class="input input-number"
                type="number"
                aria-label="Number of times"
                min="1"
                value={form.count}
                onInput={(e) => setForm('count', e.currentTarget.valueAsNumber)}
              />
              times
            </Show>
          </span>
        </div>
      </Show>

      <Show when={splittable && form.mode !== 'none'}>
        <fieldset class="field">
          <legend class="field-label">Change</legend>
          <div class="segmented">
            <label>
              <input
                type="radio"
                name="repeat-scope"
                checked={scope() === 'following'}
                onChange={() => setScope('following')}
              />
              This and following
            </label>
            <label>
              <input
                type="radio"
                name="repeat-scope"
                checked={scope() === 'all'}
                onChange={() => setScope('all')}
              />
              All
            </label>
          </div>
        </fieldset>
      </Show>

      <Show when={error()}>
        {(message) => (
          <p class="hint repeat-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={preview().length > 0}>
        <p class="hint" aria-label="Next dates">
          Next:{' '}
          {preview()
            .map((d) => previewFormat.format(parseDate(d)))
            .join(' · ')}
        </p>
      </Show>
      <Show when={recurrence && form.mode === 'none'}>
        <p class="hint">Stops repeating from this day on.</p>
      </Show>

      <div class="dialog-actions">
        <button type="button" class="button" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" class="button button-primary" disabled={error() !== undefined}>
          Save
        </button>
      </div>
    </form>
  );
}
