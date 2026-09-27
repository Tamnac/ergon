import { createSignal } from 'solid-js';

export interface EffectContext {
  /** Fixed overlay above the grid for effect elements. */
  layer: HTMLElement;
  /** Aborted on undo or when the todo is toggled again. */
  signal: AbortSignal;
}

/** Plays after a todo has been marked done. `rect` is the todo text's viewport rect. */
export type CompletionEffect = (
  element: HTMLElement,
  rect: DOMRect,
  context: EffectContext,
) => Promise<void>;

export const strikethrough: CompletionEffect = async (_element, rect, { layer, signal }) => {
  const line = document.createElement('div');
  line.className = 'effect-strike';
  Object.assign(line.style, {
    left: `${rect.left}px`,
    top: `${rect.top + rect.height / 2}px`,
    width: `${rect.width}px`,
  });
  layer.append(line);
  const animation = line.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
    duration: 200,
    easing: 'cubic-bezier(.2,.8,.2,1)',
  });
  signal.addEventListener('abort', () => animation.cancel());
  try {
    await animation.finished;
  } catch {
    // cancelled
  } finally {
    line.remove();
  }
};

let layer: HTMLElement | undefined;
let effect: CompletionEffect = strikethrough;
const running = new Map<string, AbortController>();
const [active, setActive] = createSignal<ReadonlySet<string>>(new Set());

export const setEffectLayer = (element: HTMLElement) => (layer = element);
export const setCompletionEffect = (next: CompletionEffect) => (effect = next);
/** True while a todo's effect runs; the todo hides its own done styling meanwhile. */
export const isCompleting = (id: string) => active().has(id);

export async function playCompletion(id: string, element: HTMLElement) {
  cancelCompletion(id);
  if (!layer || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const controller = new AbortController();
  running.set(id, controller);
  setActive(new Set(running.keys()));
  try {
    await effect(element, element.getBoundingClientRect(), {
      layer,
      signal: controller.signal,
    });
  } finally {
    if (running.get(id) === controller) {
      running.delete(id);
      setActive(new Set(running.keys()));
    }
  }
}

/** Cancels the effect for `id`, or all effects. */
export function cancelCompletion(id?: string) {
  for (const [key, controller] of running) {
    if (id !== undefined && key !== id) continue;
    controller.abort();
    running.delete(key);
  }
  setActive(new Set(running.keys()));
}
