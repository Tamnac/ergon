import {
  addDays,
  dayColumns,
  effectiveDate,
  startOfWeek,
  type DateStr,
  type Todo,
} from '@ergon/core';
import { createEffect, createMemo, createRoot, createSignal, on } from 'solid-js';
import { persistedSignal } from '../lib/persisted';
import { groupBy, groups, settings, weekStart } from './data';
import { createQuery } from './query';
import { storage } from './storage';
import { today } from './today';

/** Where a todo lives: on a day or in a list. */
export type Target = { date: DateStr } | { listId: string };

export const targetKey = (target: Target) =>
  'date' in target ? `date:${target.date}` : `list:${target.listId}`;

export const [start, setStart] = createSignal(today());
export const [editingId, setEditingId] = createSignal<string | null>(null);
/** `targetKey` of the column whose add input is open. */
export const [addingKey, setAddingKey] = createSignal<string | null>(null);
/** Todo to focus once it renders in the column with `targetKey` `key` (e.g. after moving it to another day). */
export const [focusRequest, setFocusRequest] = createSignal<{ id: string; key: string } | null>(
  null,
);
export const [settingsOpen, setSettingsOpen] = createSignal(false);
export const [helpOpen, setHelpOpen] = createSignal(false);
export const [panelOpen, setPanelOpen] = persistedSignal('ergon.panelOpen', true);
export const [activeGroupId, setActiveGroupId] = persistedSignal<string | null>(
  'ergon.activeGroup',
  null,
);

export const activeGroup = () => groups.find((g) => g.id === activeGroupId()) ?? groups[0];

export const { columns, visibleDays, todosByDate } = createRoot(() => {
  const columns = createMemo(() =>
    dayColumns(start(), settings.dayCount, settings.condensedWeekends),
  );
  const visibleDays = createMemo(() => columns().flat());
  const [dayTodos] = createQuery<Todo[]>(
    ['todo'],
    () => storage.todosBetween(visibleDays()[0]!, visibleDays().at(-1)!, today()),
    [],
  );
  const todosByDate = createMemo(() => groupBy(dayTodos, (todo) => effectiveDate(todo, today())));

  // The week view always starts on the configured first day of the week.
  createEffect(
    on([() => settings.dayCount, weekStart], ([count, first]) => {
      if (count === 7) setStart((s) => startOfWeek(s, first));
    }),
  );

  return { columns, visibleDays, todosByDate };
});

export function shiftDays(days: number) {
  setStart((s) => addDays(s, days));
}

export function jumpTo(date: DateStr) {
  setStart(settings.dayCount === 7 ? startOfWeek(date, weekStart()) : date);
}
