import type { Occasion } from '@ergon/core';

export type EffectIntensity = 'off' | 'subtle' | 'dramatic';

/** Which completions get an effect: all, a random few of the plain ones, or milestones only. */
export type EffectFrequency = 'always' | 'sometimes' | 'milestones';

/** Chance that a plain todo gets an effect with `sometimes`. Milestones always do. */
export const SOMETIMES_CHANCE = 0.2;

/** The value of the effect setting that picks a different effect each time. */
export const RANDOM = 'random';

/**
 * Whether a completion gets a special effect instead of the plain strikethrough. An effect on
 * every todo wears off, so by default only finishing a section or a whole day gets one.
 */
export function celebrates(
  occasion: Occasion,
  { intensity, frequency }: { intensity: EffectIntensity; frequency: EffectFrequency },
  random: () => number = Math.random,
): boolean {
  if (intensity === 'off') return false;
  if (occasion !== 'todo' || frequency === 'always') return true;
  return frequency === 'sometimes' && random() < SOMETIMES_CHANCE;
}

/** The effect to play: the chosen one if it exists, otherwise any for `random`. */
export function pickEffect(
  choice: string,
  names: readonly string[],
  random: () => number = Math.random,
): string | null {
  if (choice !== RANDOM) return names.includes(choice) ? choice : null;
  return names[Math.floor(random() * names.length)] ?? null;
}
