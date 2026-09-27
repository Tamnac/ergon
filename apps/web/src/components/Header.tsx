import { Show, createResource } from 'solid-js';
import { randomHoliday } from '../lib/holidays';
import { isPhone } from '../lib/viewport';
import { today } from '../state/today';
import { jumpTo, shiftDays, visibleDays } from '../state/view';
import { openCalendar } from './Calendar';
import { openHistory } from './HistoryZoom';
import { IconButton } from './Icon';
import './Header.css';

export function Header() {
  const years = () => {
    const first = visibleDays()[0]?.slice(0, 4);
    const last = visibleDays().at(-1)?.slice(0, 4);
    return first === last ? first : `${first}–${last}`;
  };

  return (
    <header class="header">
      <div class="header-start">
        <Show when={!isPhone()}>
          <Holiday />
        </Show>
      </div>
      <nav class="header-nav" aria-label="Days">
        <IconButton icon="chevrons-left" label="Previous week" onClick={() => shiftDays(-7)} />
        <IconButton icon="chevron-left" label="Previous day" onClick={() => shiftDays(-1)} />
        <button type="button" class="nav-today" onClick={() => jumpTo(today())}>
          Today
        </button>
        <IconButton icon="chevron-right" label="Next day" onClick={() => shiftDays(1)} />
        <IconButton icon="chevrons-right" label="Next week" onClick={() => shiftDays(7)} />
      </nav>
      <div class="header-end">
        <button type="button" class="year" onClick={openHistory}>
          {years()}
        </button>
        <IconButton icon="calendar" label="Calendar" onClick={openCalendar} />
      </div>
    </header>
  );
}

function Holiday() {
  const [name] = createResource(today, randomHoliday);
  return (
    <span class="holiday" title={name()}>
      {name()}
    </span>
  );
}
