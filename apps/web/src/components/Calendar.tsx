import {
  addDays,
  addMonths,
  parseDate,
  startOfWeek,
  type DateStr,
  type TodoMark,
} from '@ergon/core';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { reducedMotion } from '../lib/viewport';
import { groupBy, weekStart } from '../state/data';
import { createQuery } from '../state/query';
import { storage } from '../state/storage';
import { today } from '../state/today';
import { jumpTo, requestedDays, visibleDays } from '../state/view';
import { IconButton } from './Icon';
import './Calendar.css';

const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });
const MAX_MARKS = 12;
const ZOOM = { duration: 380, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' };
const keySteps: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

const [open, setOpen] = createSignal(false);
export { open as calendarOpen };

export const openCalendar = () => setOpen(true);

const GRID_DAYS = 42;
const GAP = 32;
/** The smallest a month is shown at; as many as fit are shown. */
const MONTH_SIZE = { width: 320, height: 360 };

/** The size of the area the months are laid out in. */
const [area, setArea] = createSignal({ width: 0, height: 0 });

/** Layout size, unaffected by the zoom animation's transform. */
const measure = (element: Element | null) => {
  if (element) setArea({ width: element.clientWidth, height: element.clientHeight });
};

/** How many months of at least `min` fit along `space`. */
const fit = (space: number, min: number) => Math.max(1, Math.floor((space + GAP) / (min + GAP)));

const gridStart = (month: DateStr) => startOfWeek(month, weekStart());

const markWidth = (length: number) => Math.round(Math.min(28, 6 + length / 2));

function bounds(elements: Element[]) {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return { left, top, width: Math.max(...rects.map((r) => r.right)) - left };
}

/**
 * The camera for zooming between calendar and day grid: the transform (origin 0 0) that
 * puts the calendar cells of `days` where the day columns are.
 */
function camera(dialog: HTMLElement, days: readonly DateStr[]) {
  const cells = days.flatMap((date) => [...dialog.querySelectorAll(`[data-date="${date}"]`)]);
  const slots = [...document.querySelectorAll('.day-slot')];
  if (!cells.length || !slots.length) return undefined;
  const from = bounds(cells);
  const to = bounds(slots);
  const scale = to.width / from.width;
  const x = to.left - scale * from.left;
  const y = to.top - scale * from.top;
  return {
    zoomedIn: `translate(${x}px, ${y}px) scale(${scale})`,
    zoomedOut: `translate(${-x / scale}px, ${-y / scale}px) scale(${1 / scale})`,
  };
}

/** Animates the calendar and the app behind it as one view; `out` zooms out to the calendar. */
function zoom(dialog: HTMLElement, view: NonNullable<ReturnType<typeof camera>>, out: boolean) {
  const app = document.querySelector<HTMLElement>('.app')!;
  const calendarFrames = [
    { transformOrigin: '0 0', transform: view.zoomedIn, opacity: 0 },
    { transformOrigin: '0 0', opacity: 1, offset: 0.6 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
  ];
  const appFrames = [
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
    { transformOrigin: '0 0', transform: view.zoomedOut, opacity: 0 },
  ];
  const options = { ...ZOOM, direction: out ? 'normal' : 'reverse' } as const;
  app.animate(appFrames, options);
  return dialog.animate(calendarFrames, { ...options, fill: 'forwards' });
}

export function Calendar() {
  let dialog!: HTMLDialogElement;
  let closing = false;

  const cancelAnimations = () => {
    for (const element of [dialog, document.querySelector('.app')]) {
      for (const animation of element?.getAnimations() ?? []) animation.cancel();
    }
  };

  createEffect(() => {
    if (!open() || dialog.open) return;
    closing = false;
    dialog.showModal();
    measure(dialog.querySelector('.calendar-months'));
    // The months are laid out for the measured size once this update has run.
    queueMicrotask(() => {
      dialog.querySelector<HTMLElement>('.calendar-day[tabindex="0"]')?.focus();
      const view = !reducedMotion() && camera(dialog, visibleDays());
      if (view) zoom(dialog, view, true);
    });
  });

  /** Zooms back into the days being shown (after a pick, the new ones), then closes. */
  const close = async () => {
    if (closing) return;
    closing = true;
    cancelAnimations();
    const view = !reducedMotion() && camera(dialog, requestedDays());
    if (view) await zoom(dialog, view, false).finished.catch(() => {});
    dialog.close();
    cancelAnimations();
  };

  return (
    <dialog
      ref={dialog}
      class="calendar"
      aria-label="Calendar"
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
      onClose={() => setOpen(false)}
    >
      <Show when={open()}>
        <MonthView
          onPick={(date) => {
            jumpTo(date);
            void close();
          }}
          onClose={() => void close()}
        />
      </Show>
    </dialog>
  );
}

function MonthView(props: { onPick: (date: DateStr) => void; onClose: () => void }) {
  const range = () => ({
    from: visibleDays()[0] ?? today(),
    to: visibleDays().at(-1) ?? today(),
  });
  const inRange = (date: DateStr) => date >= range().from && date <= range().to;
  const [cursor, setCursor] = createSignal(inRange(today()) ? today() : range().from);
  const cursorMonth = () => `${cursor().slice(0, 7)}-01`;
  const layout = createMemo(
    () => ({
      columns: fit(area().width, MONTH_SIZE.width),
      rows: fit(area().height, MONTH_SIZE.height),
    }),
    undefined,
    { equals: (a, b) => a.columns === b.columns && a.rows === b.rows },
  );
  const count = () => layout().columns * layout().rows;
  const months = createMemo(() => {
    const before = Math.floor((count() - 1) / 2);
    return Array.from({ length: count() }, (_, i) => addMonths(cursorMonth(), i - before));
  });
  const [marks] = createQuery<TodoMark[]>(
    ['todo', 'recurrence'],
    () =>
      storage.todoMarks(
        gridStart(months()[0]!),
        addDays(gridStart(months().at(-1)!), GRID_DAYS - 1),
        today(),
      ),
    [],
  );
  const marksByDate = createMemo(() => groupBy(marks, (mark) => mark.date));
  const title = () =>
    count() === 1
      ? monthFormat.format(parseDate(cursorMonth()))
      : monthFormat.formatRange(parseDate(months()[0]!), parseDate(months().at(-1)!));
  let root!: HTMLDivElement;

  onMount(() => {
    const observer = new ResizeObserver(() => measure(root));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  const moveTo = (date: DateStr) => {
    setCursor(date);
    root.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = keySteps[event.key];
    if (step) moveTo(addDays(cursor(), step));
    else if (event.key === 'PageUp') moveTo(addMonths(cursor(), -1));
    else if (event.key === 'PageDown') moveTo(addMonths(cursor(), 1));
    else if (event.key === 'Home') moveTo(today());
    else return;
    event.preventDefault();
  };

  return (
    <>
      <header class="calendar-header">
        <IconButton
          icon="chevron-left"
          label="Previous month"
          onClick={() => setCursor(addMonths(cursor(), -1))}
        />
        <h2 class="calendar-title">{title()}</h2>
        <IconButton
          icon="chevron-right"
          label="Next month"
          onClick={() => setCursor(addMonths(cursor(), 1))}
        />
        <IconButton class="calendar-close" icon="close" label="Close" onClick={props.onClose} />
      </header>
      <div
        ref={root}
        class="calendar-months"
        classList={{ 'is-multi': count() > 1 }}
        style={{
          'grid-template-columns': `repeat(${layout().columns}, minmax(0, 1fr))`,
          'grid-template-rows': `repeat(${layout().rows}, minmax(0, 1fr))`,
          gap: `${GAP}px`,
        }}
        onKeyDown={onKeyDown}
      >
        <For each={months()}>
          {(start) => (
            <MonthGrid
              start={start}
              multi={count() > 1}
              cursor={cursor()}
              marksByDate={marksByDate()}
              inRange={inRange}
              onPick={props.onPick}
            />
          )}
        </For>
      </div>
    </>
  );
}

function MonthGrid(props: {
  start: DateStr;
  multi: boolean;
  cursor: DateStr;
  marksByDate: Map<DateStr, TodoMark[]>;
  inRange: (date: DateStr) => boolean;
  onPick: (date: DateStr) => void;
}) {
  const month = props.start.slice(0, 7);
  const days = createMemo(() => {
    const first = gridStart(props.start);
    return Array.from({ length: GRID_DAYS }, (_, i) => addDays(first, i));
  });

  return (
    <section class="calendar-month" aria-label={monthFormat.format(parseDate(props.start))}>
      <Show when={props.multi}>
        <h3 class="calendar-caption">{monthFormat.format(parseDate(props.start))}</h3>
      </Show>
      <div class="calendar-weekdays" aria-hidden="true">
        <For each={days().slice(0, 7)}>
          {(date) => <span>{weekdayFormat.format(parseDate(date))}</span>}
        </For>
      </div>
      <div class="calendar-grid">
        <For each={days()}>
          {(date) => {
            const dayMarks = () => props.marksByDate.get(date) ?? [];
            const count = () => dayMarks().length;
            return (
              <Show when={!props.multi || date.startsWith(month)} fallback={<span />}>
                <button
                  type="button"
                  class="calendar-day"
                  classList={{
                    'is-outside': !date.startsWith(month),
                    'is-today': date === today(),
                    'is-visible': props.inRange(date),
                  }}
                  data-date={date}
                  tabIndex={date === props.cursor ? 0 : -1}
                  aria-label={`${dateFormat.format(parseDate(date))}, ${count()} ${count() === 1 ? 'todo' : 'todos'}`}
                  aria-current={date === today() ? 'date' : undefined}
                  onClick={() => props.onPick(date)}
                >
                  <span class="calendar-date">{Number(date.slice(8))}</span>
                  <span class="calendar-marks" aria-hidden="true">
                    <For each={dayMarks().slice(0, MAX_MARKS)}>
                      {(mark) => (
                        <span
                          class="calendar-mark"
                          classList={{ 'is-done': mark.done }}
                          style={{ width: `${markWidth(mark.length)}px` }}
                        />
                      )}
                    </For>
                    <Show when={count() > MAX_MARKS}>
                      <span class="calendar-more">+{count() - MAX_MARKS}</span>
                    </Show>
                  </span>
                </button>
              </Show>
            );
          }}
        </For>
      </div>
    </section>
  );
}
