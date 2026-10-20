import { effectHaptics } from './effect-settings';

export type Haptic = 'tap' | 'impact';

const DURATION: Record<Haptic, number> = { tap: 10, impact: 35 };

/**
 * Vibrates briefly if the user has haptics on and the device can. Browsers and the Android
 * WebView take `navigator.vibrate`; elsewhere it is missing and this does nothing.
 */
export function haptic(kind: Haptic) {
  if (effectHaptics()) navigator.vibrate?.(DURATION[kind]);
}
