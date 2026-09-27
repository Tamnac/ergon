import { parseDate, type DateStr } from '@ergon/core';
import { For, createMemo } from 'solid-js';
import { today } from '../state/today';
import { columns, todosByDate, visibleDays } from '../state/view';
import { Column } from './Column';
import './DayGrid.css';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });

export function DayGrid() {
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
    <div class="day-grid" style={{ '--columns': columns().length }}>
      <For each={visibleDays()}>
        {(date) => {
          const slot = () => slots().get(date)!;
          return (
            <div
              class="day-slot"
              style={{
                'grid-column': slot().column,
                'grid-row': slot().paired ? slot().row : '1 / span 2',
              }}
            >
              <Day date={date} compact={slot().paired} />
            </div>
          );
        }}
      </For>
    </div>
  );
}

function Day(props: { date: DateStr; compact: boolean }) {
  const weekday = () => weekdayFormat.format(parseDate(props.date));
  const header = (
    <header
      class="day-header"
      classList={{ 'is-today': props.date === today(), 'is-past': props.date < today() }}
    >
      <span class="day-date">{dateFormat.format(parseDate(props.date))}</span>
      <h2 class="day-name">{weekday()}</h2>
    </header>
  );
  return (
    <Column
      target={{ date: props.date }}
      items={todosByDate().get(props.date) ?? []}
      header={header}
      label={weekday()}
      rows={props.compact ? 3 : 8}
    />
  );
}
