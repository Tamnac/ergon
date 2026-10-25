import { explosion } from './effect-explosion';
import { stamp } from './effect-stamp';
import { registerEffect } from './effects';

export function registerEffects() {
  registerEffect('stamp', 'Stamp', stamp);
  registerEffect('explosion', 'Explosion', explosion);
}
