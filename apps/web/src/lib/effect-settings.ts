import { persistedSignal } from './persisted';
import { RANDOM, type EffectFrequency, type EffectIntensity } from './effect-policy';

// Per device, like the handwriting settings: what suits a phone doesn't suit a desktop.
export const [effectIntensity, setEffectIntensity] = persistedSignal<EffectIntensity>(
  'ergon.effectIntensity',
  'subtle',
);
export const [effectFrequency, setEffectFrequency] = persistedSignal<EffectFrequency>(
  'ergon.effectFrequency',
  'milestones',
);
/** The name of a registered effect, or `random`. */
export const [effectChoice, setEffectChoice] = persistedSignal('ergon.effect', RANDOM);
export const [effectSound, setEffectSound] = persistedSignal('ergon.effectSound', false);
export const [effectHaptics, setEffectHaptics] = persistedSignal('ergon.effectHaptics', true);
