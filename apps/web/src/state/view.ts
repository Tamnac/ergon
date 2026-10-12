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
import { isPhone, viewportWidth } from '../lib/viewport';
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
/** Todo whose repetition is being edited. */
export const [repeating, setRepeating] = createSignal<Todo | null>(null);
/** Todo whose reminder is being edited. */
export const [reminding, setReminding] = createSignal<Todo | null>(null);
/** What the phone layout shows. */
export const [mobileView, setMobileView] = persistedSignal<'days' | 'lists'>(
  'ergon.mobileView',
  'days',
);
export const [panelOpen, setPanelOpen] = persistedSignal('ergon.panelOpen', true);
export const [activeGroupId, setActiveGroupId] = persistedSignal<string | null>(
  'ergon.activeGroup',
  null,
);

export const activeGroup = () => groups.find((g) => g.id === activeGroupId()) ?? groups[0];

/** Width a day column needs including its gap, and the chrome around the grid. */
const COLUMN_WIDTH = 170;
const CHROME_WIDTH = 112;

/** The day count setting, capped by what fits the window. */
export function dayCount(): number {
  if (isPhone()) return 1;
  const fits = Math.floor((viewportWidth() - CHROME_WIDTH) / COLUMN_WIDTH);
  return Math.max(1, Math.min(settings.dayCount, fits));
}

export const { columns, visibleDays, requestedDays, todosByDate } = createRoot(() => {
  const requested = createMemo(() => dayColumns(start(), dayCount(), settings.condensedWeekends));
  /** The days being navigated to; `visibleDays` follows once their todos are loaded. */
  const requestedDays = createMemo(() => requested().flat());
  // Days switch together with their todos, so columns never show up empty while loading.
  const [days] = createQuery<{ columns: DateStr[][]; todos: Todo[] }>(
    ['todo', 'recurrence'],
    async () => {
      const columns = requested();
      const todos = await storage.todosBetween(columns[0]![0]!, columns.at(-1)!.at(-1)!, today());
      return { columns, todos };
    },
    { columns: [], todos: [] },
  );
  const columns = () => days.columns;
  const visibleDays = createMemo(() => days.columns.flat());
  const todosByDate = createMemo(() => groupBy(days.todos, (todo) => effectiveDate(todo, today())));

  // The week view always starts on the configured first day of the week.
  createEffect(
    on([dayCount, weekStart], ([count, first]) => {
      if (count === 7) setStart((s) => startOfWeek(s, first));
    }),
  );

  return { columns, visibleDays, requestedDays, todosByDate };
});

export function shiftDays(days: number) {
  setStart((s) => addDays(s, days));
}

export function jumpTo(date: DateStr) {
  setStart(dayCount() === 7 ? startOfWeek(date, weekStart()) : date);
}
