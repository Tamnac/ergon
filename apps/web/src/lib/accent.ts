import { accentTexts, readableOn } from './color';

/**
 * Sets the accent and its derived colors on the page: `--accent-fg` for text on the accent,
 * `--accent-text-light`/`-dark` for the accent as text. Returns them for the pre-paint cache.
 */
export function applyAccent(accent: string) {
  const root = document.documentElement;
  const accentFg = readableOn(accent);
  const { light, dark } = accentTexts(accent);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-fg', accentFg);
  root.style.setProperty('--accent-text-light', light);
  root.style.setProperty('--accent-text-dark', dark);
  return { accentFg, accentTextLight: light, accentTextDark: dark };
}
