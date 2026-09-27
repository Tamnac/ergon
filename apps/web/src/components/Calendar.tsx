import {
  addDays,
  addMonths,
  parseDate,
  startOfWeek,
  type DateStr,
  type TodoMark,
} from '@ergon/core';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
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
    dialog.querySelector<HTMLElement>('.calendar-day[tabindex="0"]')?.focus();
    const view = !reducedMotion() && camera(dialog, visibleDays());
    if (view) zoom(dialog, view, true);
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
        <Month
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

function Month(props: { onPick: (date: DateStr) => void; onClose: () => void }) {
  const range = () => ({
    from: visibleDays()[0] ?? today(),
    to: visibleDays().at(-1) ?? today(),
  });
  const inRange = (date: DateStr) => date >= range().from && date <= range().to;
  const [cursor, setCursor] = createSignal(inRange(today()) ? today() : range().from);
  const month = () => cursor().slice(0, 7);
  const days = createMemo(() => {
    const first = startOfWeek(`${month()}-01`, weekStart());
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  });
  const [marks] = createQuery<TodoMark[]>(
    ['todo'],
    () => storage.todoMarks(days()[0]!, days().at(-1)!, today()),
    [],
  );
  const marksByDate = createMemo(() => groupBy(marks, (mark) => mark.date));
  let grid!: HTMLDivElement;

  const moveTo = (date: DateStr) => {
    setCursor(date);
    grid.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
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
        <h2 class="calendar-title">{monthFormat.format(parseDate(`${month()}-01`))}</h2>
        <IconButton
          icon="chevron-right"
          label="Next month"
          onClick={() => setCursor(addMonths(cursor(), 1))}
        />
        <IconButton class="calendar-close" icon="close" label="Close" onClick={props.onClose} />
      </header>
      <div class="calendar-weekdays" aria-hidden="true">
        <For each={days().slice(0, 7)}>
          {(date) => <span>{weekdayFormat.format(parseDate(date))}</span>}
        </For>
      </div>
      <div ref={grid} class="calendar-grid" onKeyDown={onKeyDown}>
        <For each={days()}>
          {(date) => {
            const dayMarks = () => marksByDate().get(date) ?? [];
            const count = () => dayMarks().length;
            return (
              <button
                type="button"
                class="calendar-day"
                classList={{
                  'is-outside': date.slice(0, 7) !== month(),
                  'is-today': date === today(),
                  'is-visible': inRange(date),
                }}
                data-date={date}
                tabIndex={date === cursor() ? 0 : -1}
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
            );
          }}
        </For>
      </div>
    </>
  );
}
