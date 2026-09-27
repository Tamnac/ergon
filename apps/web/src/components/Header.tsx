import { today } from '../state/today';
import { jumpTo, shiftDays } from '../state/view';
import { IconButton } from './Icon';
import './Header.css';

export function Header() {
  let picker!: HTMLInputElement;

  return (
    <header class="header">
      <div class="header-side" />
      <h1 class="brand">
        Ergon<span class="brand-mark">*</span>
      </h1>
      <nav class="header-side header-nav" aria-label="Days">
        <button type="button" class="chip" onClick={() => jumpTo(today())}>
          Today
        </button>
        <IconButton icon="chevrons-left" label="Previous week" onClick={() => shiftDays(-7)} />
        <IconButton icon="chevron-left" label="Previous day" onClick={() => shiftDays(-1)} />
        <IconButton icon="chevron-right" label="Next day" onClick={() => shiftDays(1)} />
        <IconButton icon="chevrons-right" label="Next week" onClick={() => shiftDays(7)} />
        <span class="date-picker">
          <IconButton icon="calendar" label="Pick a date" onClick={() => picker.showPicker()} />
          <input
            ref={picker}
            type="date"
            class="date-input"
            tabIndex={-1}
            aria-label="Go to date"
            onChange={(event) => {
              if (event.currentTarget.value) jumpTo(event.currentTarget.value);
            }}
          />
        </span>
      </nav>
    </header>
  );
}
