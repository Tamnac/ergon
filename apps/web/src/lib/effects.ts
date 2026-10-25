import type { Occasion } from '@ergon/core';
import { createSignal } from 'solid-js';
import { celebrates, pickEffect } from './effect-policy';
import { effectChoice, effectFrequency, effectSound } from './effect-settings';
import { haptic, type Haptic } from './haptics';

/** At most this many special effects run at once; further completions get the strikethrough. */
const MAX_SPECIAL = 3;

export interface EffectContext {
  /** Fixed overlay above the grid for effect elements. */
  layer: HTMLElement;
  /** Aborted on undo or when the todo is toggled again. */
  signal: AbortSignal;
  /** What was finished. Effects can play bigger for a section or a whole day. */
  occasion: Occasion;
  /** Whether the user wants sound; effects stay silent without it. */
  sound: boolean;
  /** Vibrates, if the user has haptics on. */
  haptic(kind: Haptic): void;
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
const registry = new Map<string, { label: string; effect: CompletionEffect }>();
const running = new Map<string, AbortController>();
const special = new Set<string>();
const [active, setActive] = createSignal<ReadonlySet<string>>(new Set());

export const setEffectLayer = (element: HTMLElement) => (layer = element);

/**
 * Adds an effect the user can choose in the settings. The strikethrough is not registered: it
 * is what completions get when no effect plays.
 */
export function registerEffect(name: string, label: string, effect: CompletionEffect) {
  registry.set(name, { label, effect });
}

export const effectChoices = () => [...registry].map(([name, { label }]) => ({ name, label }));

/** The effect for this completion, or null for the plain strikethrough. */
function chooseEffect(occasion: Occasion): string | null {
  if (special.size >= MAX_SPECIAL || !celebrates(occasion, effectFrequency())) return null;
  return pickEffect(effectChoice(), [...registry.keys()]);
}
/** True while a todo's effect runs; the todo hides its own done styling meanwhile. */
export const isCompleting = (id: string) => active().has(id);

export async function playCompletion(
  id: string,
  element: HTMLElement,
  occasion: Occasion = 'todo',
) {
  cancelCompletion(id);
  if (!layer || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const name = chooseEffect(occasion);
  const controller = new AbortController();
  running.set(id, controller);
  if (name) special.add(id);
  setActive(new Set(running.keys()));
  try {
    await (name ? registry.get(name)!.effect : strikethrough)(
      element,
      element.getBoundingClientRect(),
      {
        layer,
        signal: controller.signal,
        occasion,
        sound: effectSound(),
        haptic,
      },
    );
  } finally {
    if (running.get(id) === controller) {
      running.delete(id);
      special.delete(id);
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
    special.delete(key);
  }
  setActive(new Set(running.keys()));
}
