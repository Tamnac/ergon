import { parseDate, type DateStr } from '@ergon/core';
import { For, createComputed, createEffect, createMemo, on } from 'solid-js';
import { isPhone, reducedMotion } from '../lib/viewport';
import { today } from '../state/today';
import { columns, shiftDays, todosByDate, visibleDays } from '../state/view';
import { calendarOpen } from './Calendar';
import { Cap } from './Cap';
import { Column } from './Column';
import './DayGrid.css';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
const SLIDE = { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const SWIPE_DISTANCE = 60;

export function DayGrid() {
  let grid!: HTMLDivElement;
  slideOnNavigate(() => grid);

  let swipe: { x: number; y: number } | undefined;
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    swipe =
      event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!swipe || !touch || !isPhone()) return;
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    swipe = undefined;
    if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy))
      shiftDays(dx < 0 ? 1 : -1);
  };

  const slots = createMemo(() => {
    const map = new Map<DateStr, { column: number; row: number; paired: boolean }>();
    columns().forEach((days, column) =>
      days.forEach((date, row) =>
        map.set(date, { column: column + 1, row: row + 1, paired: days.length > 1 }),
      ),
    );
    return map;
  });

  return (
    <div
      ref={grid}
      class="day-grid"
      style={{ '--columns': columns().length }}
      onTouchStart={onTouchStart}
      onTouchMove={() => {
        if (document.documentElement.classList.contains('is-dragging')) swipe = undefined;
      }}
      onTouchEnd={onTouchEnd}
    >
      <For each={visibleDays()}>
        {(date) => {
          const slot = () => slots().get(date)!;
          return (
            <div
              class="day-slot"
              data-date={date}
              style={{
                'grid-column': slot().column,
                'grid-row': slot().paired ? slot().row : '1 / span 2',
              }}
            >
              <Day date={date} />
            </div>
          );
        }}
      </For>
    </div>
  );
}

/**
 * Slides day columns from their old place when the visible days shift (FLIP). Kept days
 * move, new ones slide in with them; a new shift restarts from the current positions.
 */
function slideOnNavigate(grid: () => HTMLElement) {
  let before = new Map<string, DOMRect>();
  let direction = 0;
  const slots = () => [...grid().querySelectorAll<HTMLElement>('.day-slot')];

  createComputed(
    on(visibleDays, (days, previous) => {
      const [first, last] = [days[0], previous?.[0]];
      direction =
        !first || !last || first === last || reducedMotion() || calendarOpen()
          ? 0
          : first > last
            ? 1
            : -1;
      if (direction) {
        before = new Map(slots().map((slot) => [slot.dataset.date!, slot.getBoundingClientRect()]));
      }
    }),
  );

  createEffect(
    on(visibleDays, () => {
      const sign = direction;
      if (!sign) return;
      direction = 0;
      const current = slots();
      for (const slot of current) for (const animation of slot.getAnimations()) animation.cancel();
      const moves = current.map((slot) => {
        const now = slot.getBoundingClientRect();
        const old = before.get(slot.dataset.date!);
        return { slot, dx: old && old.left - now.left, dy: old ? old.top - now.top : 0 };
      });
      const shift =
        moves.find((move) => move.dx !== undefined)?.dx ?? (sign * grid().clientWidth) / 3;
      // Columns sliding in from the right must not widen the scroll area.
      grid().classList.add('is-sliding');
      const animations = moves.map(({ slot, dx, dy }) =>
        slot.animate(
          [
            {
              transform: `translate(${dx ?? shift}px, ${dy}px)`,
              opacity: dx === undefined ? 0 : 1,
            },
            { transform: 'none', opacity: 1 },
          ],
          SLIDE,
        ),
      );
      Promise.all(animations.map((animation) => animation.finished)).then(
        () => grid().classList.remove('is-sliding'),
        () => {},
      );
    }),
  );
}

function Day(props: { date: DateStr }) {
  const weekday = () => weekdayFormat.format(parseDate(props.date));
  const header = (
    <header
      class="day-header"
      classList={{ 'is-today': props.date === today(), 'is-past': props.date < today() }}
    >
      <h2 class="day-name">
        <Cap text={weekday()} />
      </h2>
      <span class="day-date cap-rest">{dateFormat.format(parseDate(props.date))}</span>
    </header>
  );
  return (
    <Column
      target={{ date: props.date }}
      items={todosByDate().get(props.date) ?? []}
      header={header}
      label={weekday()}
    />
  );
}
