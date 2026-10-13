import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { reducedMotion } from '../lib/viewport';
import { IconButton } from './Icon';
import './HistoryZoom.css';

const [open, setOpen] = createSignal(false);

const [origin, setOrigin] = createSignal<HTMLElement>();

/** `from` is the element showing the current year, which the timeline's year flies out of. */
export const openHistory = (from?: HTMLElement) => {
  setOrigin(from);
  setOpen(true);
};

/** Years before present (1950), the usual dating for prehistory. */
const bp = (years: number) => 1950 - years;

const BIRTH_AGE = 29;
const BIRTH_YEAR = new Date().getFullYear() - BIRTH_AGE;
const SAPIENS_AGE = 300_000;
const LABEL_SHIFT = 9;

/**
 * In label priority: when two labels would overlap, the later one is hidden.
 * `shift` moves the label vertically (px) so events that end up closer than a line can both be read.
 */
const EVENTS = [
  { year: 2026.25, label: 'Artemis II flies around the Moon', when: 'April 2026' },
  { year: 2025.5, label: 'Interstellar comet 3I/ATLAS discovered', when: 'July 2025' },
  { year: 2022.9, label: 'First public LLM chatbot', when: 'November 2022' },
  { year: 2020.2, label: 'COVID-19 pandemic', when: 'March 2020' },
  { year: BIRTH_YEAR, label: 'Your birthdate (probably)', when: `c. ${BIRTH_YEAR}` },
  { year: 2007.5, label: 'The iPhone', when: 'June 2007' },
  { year: 1983, label: 'The internet', when: '1983' },
  {
    year: bp(13_800_000_000),
    label: 'The Big Bang (probably)',
    when: 'c. 13.8 billion years ago',
    shift: -LABEL_SHIFT,
  },
  { year: bp(SAPIENS_AGE), label: 'First Homo sapiens', when: 'c. 300,000 years ago' },
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
  { year: bp(20_000), label: 'Ice age at its coldest', when: 'c. 20,000 years ago' },
  { year: bp(1_000_000), label: 'Control of fire', when: 'c. 1 million years ago' },
  { year: bp(1_900_000), label: 'Homo erectus', when: 'c. 1.9 million years ago' },
  { year: bp(2_600_000), label: 'The ice ages begin', when: 'c. 2.6 million years ago' },
  { year: bp(3_200_000), label: 'Lucy, an early human ancestor', when: 'c. 3.2 million years ago' },
  { year: bp(7_000_000), label: 'Split from the chimpanzee line', when: 'c. 7 million years ago' },
  { year: bp(55_000_000), label: 'First primates', when: 'c. 55 million years ago' },
  { year: bp(66_000_000), label: 'Asteroid ends the dinosaurs', when: 'c. 66 million years ago' },
  { year: bp(130_000_000), label: 'Flowering plants', when: 'c. 130 million years ago' },
  { year: bp(201_000_000), label: 'End-Triassic extinction', when: 'c. 201 million years ago' },
  { year: bp(220_000_000), label: 'First mammals', when: 'c. 220 million years ago' },
  { year: bp(233_000_000), label: 'First dinosaurs', when: 'c. 233 million years ago' },
  { year: bp(252_000_000), label: 'The Great Dying', when: 'c. 252 million years ago' },
  { year: bp(372_000_000), label: 'Late Devonian extinction', when: 'c. 372 million years ago' },
  { year: bp(450_000_000), label: 'First sharks', when: 'c. 450 million years ago' },
  { year: bp(445_000_000), label: 'End-Ordovician extinction', when: 'c. 445 million years ago' },
  { year: bp(470_000_000), label: 'Plants reach land', when: 'c. 470 million years ago' },
  { year: bp(538_000_000), label: 'Cambrian explosion', when: 'c. 538 million years ago' },
  { year: bp(700_000_000), label: 'Snowball Earth', when: 'c. 700 million years ago' },
  { year: bp(1_600_000_000), label: 'Multicellular life', when: 'c. 1.6 billion years ago' },
  { year: bp(2_000_000_000), label: 'Complex cells', when: 'c. 2 billion years ago' },
  { year: bp(2_400_000_000), label: 'Oxygen fills the air', when: 'c. 2.4 billion years ago' },
  { year: bp(3_700_000_000), label: 'First life', when: 'c. 3.7 billion years ago' },
  {
    year: bp(4_540_000_000),
    label: 'The Sun and the Earth form',
    when: 'c. 4.5 billion years ago',
  },
  {
    year: bp(13_600_000_000),
    label: 'First stars',
    when: 'c. 13.6 billion years ago',
    shift: LABEL_SHIFT,
  },
  { year: bp(9_000_000_000), label: 'The Milky Way’s disk forms', when: 'c. 9 billion years ago' },
];

const MIN_SPAN = 2;
const MAX_SPAN = 13_800_000_000;
/** Pause after the year lands, while the axis grows, before the zoom starts. */
const DELAY = 3500;
const FLIGHT = 1300;
const TRAVEL_PER_E_FOLD = 2000;
/** Spans where the zoom rests so the event in view can be read. */
const STOPS = [
  { span: BIRTH_AGE * 1.6, hold: 100 },
  { span: SAPIENS_AGE * 1.6, hold: 100 },
  { span: MAX_SPAN, hold: 0 },
];
/** Distance above the track over which things fade in. */
const FADE = 64;
const MIN_TICK_GAP = 6;
const LABEL_GAP = 22;
const TICK_SIZES = [1, 10, 100, 1000, 10_000, 100_000, 1e6, 1e7, 1e8, 1e9];

const LEGS = STOPS.map((stop, i) => {
  const from = STOPS[i - 1]?.span ?? MIN_SPAN;
  return {
    from,
    to: stop.span,
    hold: stop.hold,
    travel: Math.log(stop.span / from) * TRAVEL_PER_E_FOLD,
  };
});
const DURATION = LEGS.reduce((total, leg) => total + leg.travel + leg.hold, 0);

const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', compactDisplay: 'long' });
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

/** The span shown `elapsed` ms into the zoom: eases between stops and rests at each. */
function spanAt(elapsed: number) {
  for (const leg of LEGS) {
    if (elapsed < leg.travel) return leg.from * (leg.to / leg.from) ** ease(elapsed / leg.travel);
    elapsed -= leg.travel + leg.hold;
    if (elapsed < 0) return leg.to;
  }
  return MAX_SPAN;
}

function formatYear(year: number) {
  if (year > 0) return String(year);
  if (year <= -1e6) return `${compactFormat.format(-year)} years ago`;
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

/** Moves `to` from where `from` is on screen to its own place. */
function flyYear(from: HTMLElement, to: HTMLElement) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const scale =
    parseFloat(getComputedStyle(from).fontSize) / parseFloat(getComputedStyle(to).fontSize);
  return to.animate(
    [
      {
        transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${scale})`,
        color: getComputedStyle(from).color,
      },
      { transform: 'none', color: getComputedStyle(to).color },
    ],
    { duration: FLIGHT, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' },
  );
}

/** Zooms out from now, at the bottom of the track, to all of human history. */
function Timeline() {
  const now = currentYear();
  const [span, setSpan] = createSignal(reducedMotion() ? MAX_SPAN : MIN_SPAN);
  const [height, setHeight] = createSignal(0);
  const [ready, setReady] = createSignal(reducedMotion() || !origin());
  let track!: HTMLDivElement;
  let year!: HTMLSpanElement;
  let flying = false;

  onMount(() => {
    const observer = new ResizeObserver(() => setHeight(track.clientHeight));
    observer.observe(track);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    if (!height() || ready() || flying) return;
    flying = true;
    const animation = flyYear(origin()!, year);
    animation.onfinish = () => setReady(true);
    onCleanup(() => animation.cancel());
  });

  createEffect(() => {
    if (!ready() || reducedMotion()) return;
    let start: number | undefined;
    let frame = requestAnimationFrame(function step(time) {
      start ??= time;
      const elapsed = Math.max(0, time - start - DELAY);
      setSpan(spanAt(elapsed));
      if (elapsed < DURATION) frame = requestAnimationFrame(step);
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
        const y = at(event.year) + (event.shift ?? 0);
        if (y < -FADE / 2 || taken.some((other) => Math.abs(other - y) < LABEL_GAP)) return false;
        taken.push(y);
        return true;
      }),
    );
  });

  return (
    <div ref={track} class="history-track" classList={{ 'is-ready': ready() }}>
      <div class="history-body">
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
              style={{
                transform: `translateY(${at(event.year)}px)`,
                opacity: edge(at(event.year)),
              }}
            >
              <span class="history-dot" />
              <span
                class="history-label"
                style={{ transform: `translateY(${event.shift ?? 0}px)` }}
              >
                {event.label} <span class="history-when">{event.when}</span>
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="history-event history-now" style={{ transform: `translateY(${height()}px)` }}>
        <span class="history-dot" />
        <span ref={year} class="history-year">
          {Math.floor(now)}
        </span>
        <span class="history-here">You are here</span>
      </div>
    </div>
  );
}
