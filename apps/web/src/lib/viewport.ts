import { createSignal } from 'solid-js';

const [viewportWidth, setViewportWidth] = createSignal(window.innerWidth);
window.addEventListener('resize', () => setViewportWidth(window.innerWidth));

export { viewportWidth };

/** Matches the `.is-phone` layout in the CSS. */
export const isPhone = () => viewportWidth() < 480;

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
