import thudUrl from '../assets/thud.mp3?url';

/** A low thump, for things landing. */
export function thud() {
  new Audio(thudUrl).play().catch(() => undefined);
}
