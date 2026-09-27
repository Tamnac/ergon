import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { reducedMotion } from '../lib/viewport';
import { IconButton } from './Icon';
import './HistoryZoom.css';

const [open, setOpen] = createSignal(false);

export const openHistory = () => setOpen(true);

/** Years before present (1950), the usual dating for prehistory. */
const bp = (years: number) => 1950 - years;

/** In label priority: when two labels would overlap, the later one is hidden. */
const EVENTS = [
  { year: bp(300_000), label: 'First Homo sapiens', when: 'c. 300,000 years ago' },
  { year: 1969, label: 'Moon landing', when: '1969' },
  { year: bp(60_000), label: 'Humans spread out of Africa', when: 'c. 60,000 years ago' },
  { year: -3200, label: 'Writing', when: 'c. 3200 BCE' },
  { year: -10_000, label: 'Farming', when: 'c. 10,000 BCE' },
  { year: bp(36_000), label: 'Chauvet cave paintings', when: 'c. 36,000 years ago' },
  { year: bp(142_000), label: 'Oldest known jewelry', when: 'c. 142,000 years ago' },
  { year: -4, label: 'Jesus', when: 'c. 4 BCE – 30 CE' },
  { year: 570, label: 'Muhammad', when: 'c. 570–632' },
  { year: -1800, label: 'Abraham', when: 'c. 1800 BCE, by tradition' },
  { year: -2560, label: 'Great Pyramid of Giza', when: 'c. 2560 BCE' },
  { year: 1440, label: 'Printing press', when: 'c. 1440' },
  { year: bp(17_000), label: 'Lascaux cave paintings', when: 'c. 17,000 years ago' },
];

const MIN_SPAN = 1;
const MAX_SPAN = 330_000;
const DELAY = 600;
const DURATION = 9000;
/** Distance above the track over which things fade in. */
const FADE = 64;
const MIN_TICK_GAP = 6;
const LABEL_GAP = 22;
const TICK_SIZES = [1, 10, 100, 1000, 10_000, 100_000];

const numberFormat = new Intl.NumberFormat();
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

function formatYear(year: number) {
  if (year > 0) return String(year);
  return year === 0 ? '1 CE' : `${numberFormat.format(-year)} BCE`;
}

/** The current year with a fraction for how far into it we are. */
function currentYear() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  return year + (now.getTime() - start) / (new Date(year + 1, 0, 1).getTime() - start);
}

export function HistoryZoom() {
  let dialog!: HTMLDialogElement;

  createEffect(() => {
    if (open() && !dialog.open) dialog.showModal();
  });

  return (
    <dialog
      ref={dialog}
      class="history"
      aria-label="Human history"
      onClick={() => dialog.close()}
      onClose={() => setOpen(false)}
    >
      <Show when={open()}>
        <Timeline />
      </Show>
      <IconButton class="history-close" icon="close" label="Close" onClick={() => dialog.close()} />
    </dialog>
  );
}

/** Zooms out from now, at the bottom of the track, to all of human history. */
function Timeline() {
  const now = currentYear();
  const [span, setSpan] = createSignal(reducedMotion() ? MAX_SPAN : MIN_SPAN);
  const [height, setHeight] = createSignal(0);
  let track!: HTMLDivElement;

  onMount(() => {
    const observer = new ResizeObserver(() => setHeight(track.clientHeight));
    observer.observe(track);
    onCleanup(() => observer.disconnect());
    if (reducedMotion()) return;
    let start: number | undefined;
    let frame = requestAnimationFrame(function step(time) {
      start ??= time;
      const t = clamp((time - start - DELAY) / DURATION);
      setSpan(MIN_SPAN * (MAX_SPAN / MIN_SPAN) ** ease(t));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const perYear = () => height() / span();
  const at = (year: number) => Math.max(height() - (now - year) * perYear(), -2 * FADE);
  const edge = (y: number) => clamp(1 + y / FADE);

  const ticks = createMemo(() => {
    if (!height()) return [];
    const step = TICK_SIZES.find((size) => size * perYear() >= MIN_TICK_GAP) ?? MAX_SPAN;
    const oldest = now - span() - FADE / perYear();
    const years = [];
    for (let year = Math.floor(now / step) * step; year >= oldest; year -= step) years.push(year);
    return years;
  });

  const labeled = createMemo(() => {
    const taken = [height()];
    return new Set(
      EVENTS.filter((event) => {
        const y = at(event.year);
        if (y < -FADE / 2 || taken.some((other) => Math.abs(other - y) < LABEL_GAP)) return false;
        taken.push(y);
        return true;
      }),
    );
  });

  return (
    <div ref={track} class="history-track">
      <div class="history-axis" />
      <For each={ticks()}>
        {(year) => {
          const size = TICK_SIZES.findLast((size) => year % size === 0)!;
          const gap = () => size * perYear();
          const label = () => clamp((gap() - 36) / 36);
          return (
            <div
              class="history-tick"
              style={{
                transform: `translateY(${at(year)}px)`,
                opacity: edge(at(year)) * clamp((gap() - MIN_TICK_GAP) / 12),
              }}
            >
              <span style={{ opacity: label() }}>{formatYear(year)}</span>
              <span class="history-tick-line" style={{ width: `${4 + 8 * label()}px` }} />
            </div>
          );
        }}
      </For>
      <For each={EVENTS}>
        {(event) => (
          <div
            class="history-event"
            classList={{ 'is-labeled': labeled().has(event) }}
            style={{ transform: `translateY(${at(event.year)}px)`, opacity: edge(at(event.year)) }}
          >
            <span class="history-dot" />
            <span class="history-label">
              {event.label} <span class="history-when">{event.when}</span>
            </span>
          </div>
        )}
      </For>
      <div class="history-event history-now" style={{ transform: `translateY(${height()}px)` }}>
        <span class="history-dot" />
        <span class="history-year">{Math.floor(now)}</span>
        <span class="history-here">You are here</span>
      </div>
    </div>
  );
}
