import { clipStroke, inkWidth, touches, type Stroke } from '@ergon/core';
import { For, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { strokePath } from '../lib/ink';
import './InkSurface.css';

const COMMIT_DELAY = 5000;
/** How close, in row units, the eraser has to come to a stroke to remove it. */
const ERASE_RADIUS = 8;

/** Safari's `Touch` from an Apple Pencil. */
type Stylus = Touch & { touchType?: 'direct' | 'stylus' };

interface Pointer {
  id: number;
  erase: boolean;
  points: Stroke;
  /** The row, measured once per stroke. */
  rect: DOMRect;
}

/**
 * A row to write on with a pen. Commits a while after the pen lifts (held while it hovers
 * nearby), on a press or focus elsewhere, when the page is hidden, or on Enter; Esc cancels,
 * Ctrl+Z removes the last stroke. Ink is cut off outside the row and half a row above and below. `onCommit` gets the strokes if they changed, otherwise `onCancel` runs.
 */
export function InkSurface(props: {
  /** Ink being edited; the surface stays open until it commits or cancels. */
  initial?: Stroke[];
  /** Where `initial` was shown (scaled to fit or aligned right), so it stays put while edited. */
  shownIn?: DOMRect;
  onCommit: (strokes: Stroke[]) => void;
  onCancel?: () => void;
  /** Shown on the surface, e.g. a button for other pointers. */
  children?: JSX.Element;
}) {
  let area!: HTMLDivElement;
  let surface!: HTMLDivElement;
  let live!: SVGPathElement;
  const editing = props.initial !== undefined;
  const [strokes, setStrokes] = createSignal<Stroke[]>(props.initial ?? []);
  const [drawing, setDrawing] = createSignal(false);
  let pointer: Pointer | undefined;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHover = 0;
  /** Pointer type of the last press, which comes before its `touchstart`. */
  let pressedWith = '';

  const open = () => editing || strokes().length > 0 || drawing();

  const schedule = (delay = COMMIT_DELAY) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const since = performance.now() - lastHover;
      if (since < COMMIT_DELAY) schedule(COMMIT_DELAY - since);
      else commit();
    }, delay);
  };

  const finish = (changed: boolean) => {
    clearTimeout(timer);
    const result = strokes();
    dirty = false;
    setStrokes([]);
    if (changed) props.onCommit(result);
    else props.onCancel?.();
  };

  const commit = () => {
    if (!pointer) finish(dirty);
  };

  const cancel = () => {
    if (!pointer) finish(false);
  };

  const begin = (event: PointerEvent) => {
    pressedWith = event.pointerType;
    if (event.pointerType !== 'pen' || pointer) return;
    event.preventDefault();
    // Preventing the default also keeps focus where it was, e.g. in an open add input.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !area.contains(focused)) focused.blur();
    clearTimeout(timer);
    surface.setPointerCapture(event.pointerId);
    pointer = {
      id: event.pointerId,
      erase: event.button === 5 || event.button === 2 || (event.buttons & 32) !== 0,
      points: [],
      rect: area.getBoundingClientRect(),
    };
    setDrawing(true);
    extend(event);
  };

  /** Adds the event's points to the stroke in progress and redraws only that stroke. */
  const extend = (event: PointerEvent) => {
    if (event.pointerId !== pointer?.id) return;
    const { rect, points, erase } = pointer;
    const unit = 100 / rect.height;
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const e of coalesced.length ? coalesced : [event]) {
      const x = (e.clientX - rect.left) * unit;
      const y = (e.clientY - rect.top) * unit;
      if (!erase) {
        points.push([x, y, e.pressure]);
        continue;
      }
      const near = (stroke: Stroke) => touches(stroke, x, y, ERASE_RADIUS);
      if (strokes().some(near)) {
        setStrokes(strokes().filter((stroke) => !near(stroke)));
        dirty = true;
      }
    }
    if (!erase) live.setAttribute('d', strokePath(points, false));
  };

  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer?.id) return;
    const { points, erase, rect } = pointer;
    pointer = undefined;
    live.setAttribute('d', '');
    const parts = erase ? [] : clipStroke(points, (rect.width * 100) / rect.height);
    if (parts.length > 0) {
      setStrokes([...strokes(), ...parts]);
      dirty = true;
    }
    setDrawing(false);
    schedule();
  };

  onMount(() => {
    if (editing) schedule();
    if (props.shownIn) {
      const rect = area.getBoundingClientRect();
      const unit = 100 / rect.height;
      const scale = (props.shownIn.width * unit) / inkWidth(strokes());
      const left = (props.shownIn.left - rect.left) * unit;
      setStrokes(
        strokes().map((stroke) =>
          stroke.map(([x, y, p]) => [left + x * scale, 50 + (y - 50) * scale, p]),
        ),
      );
    }

    // Pen and touch on the surface write or rest a palm; anything else elsewhere commits.
    const onDocumentDown = (event: PointerEvent) => {
      if (!open()) return;
      if (event.pointerType !== 'mouse' && surface.contains(event.target as Node)) return;
      commit();
    };
    // The row being edited takes focus when the pen opens it.
    const onFocusIn = (event: FocusEvent) => {
      if (open() && !(event.target as Node).contains(area)) commit();
    };
    const onHide = () => {
      if (document.hidden) commit();
    };
    // A pen hovering near the row holds the commit. Firefox reports a hovering pen as a mouse.
    const onDocumentMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons !== 0 || pointer || !open()) return;
      const rect = area.getBoundingClientRect();
      const margin = rect.height / 2;
      if (
        event.clientX > rect.left - margin &&
        event.clientX < rect.right + margin &&
        event.clientY > rect.top - margin &&
        event.clientY < rect.bottom + margin
      ) {
        lastHover = performance.now();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!open()) return;
      if (event.key === 'Enter') commit();
      else if (event.key === 'Escape') cancel();
      else if (
        event.key === 'z' &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        strokes().length
      ) {
        setStrokes(strokes().slice(0, -1));
        dirty = true;
        schedule();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    // A pen writes instead of scrolling; fingers still scroll and swipe. Safari marks the Pencil
    // on the touch itself.
    const onTouchStart = (event: TouchEvent) => {
      const stylus = [...event.changedTouches].some(
        (touch) => (touch as Stylus).touchType === 'stylus',
      );
      if (stylus || pressedWith === 'pen') event.preventDefault();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (pointer) event.preventDefault();
    };
    document.addEventListener('pointerdown', onDocumentDown, true);
    document.addEventListener('pointermove', onDocumentMove);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('visibilitychange', onHide);
    surface.addEventListener('touchstart', onTouchStart, { passive: false });
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocumentDown, true);
      document.removeEventListener('pointermove', onDocumentMove);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('visibilitychange', onHide);
      if (dirty) finish(true);
      clearTimeout(timer);
    });
  });

  return (
    <div ref={area} class="ink-area">
      <svg
        class="ink-draft"
        viewBox="0 -50 100000 200"
        preserveAspectRatio="xMinYMin slice"
        aria-hidden="true"
      >
        <For each={strokes()}>{(stroke) => <path d={strokePath(stroke)} />}</For>
        <path ref={live} />
      </svg>
      <div
        ref={surface}
        class="ink-surface"
        classList={{ 'is-open': open() }}
        onPointerDown={begin}
        onPointerMove={extend}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (open()) event.stopPropagation();
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
