/** Surfaces text sits on, as in tokens.css: the darkest light one and the lightest dark one. */
const LIGHT_SURFACE = '#f4f4f5';
const DARK_SURFACE = '#19191b';
/** WCAG AA for normal text. */
const TEXT_CONTRAST = 4.5;

type Rgb = [number, number, number];

function parse(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1]!, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const toHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Black or white, whichever reads better on the given `#rrggbb` background. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const rgb = parse(hex);
  return rgb && luminance(rgb) > 0.179 ? '#000000' : '#ffffff';
}

/**
 * `hex` moved toward `toward` (black or white) by as little as needed to reach `TEXT_CONTRAST`
 * on `surface`. Accent colors that are fine as text stay as they are.
 */
function readableAccent(hex: string, surface: string, toward: '#000000' | '#ffffff'): string {
  const from = parse(hex);
  if (!from) return hex;
  const [background, target] = [parse(surface)!, parse(toward)!];
  for (let t = 0; t < 1; t += 0.02) {
    const mixed = from.map((c, i) => c + (target[i]! - c) * t) as Rgb;
    if (contrast(mixed, background) >= TEXT_CONTRAST) return t === 0 ? hex : toHex(mixed);
  }
  return toward;
}

/** The accent adjusted to be readable as text on light and on dark surfaces. */
export function accentTexts(accent: string): { light: string; dark: string } {
  return {
    light: readableAccent(accent, LIGHT_SURFACE, '#000000'),
    dark: readableAccent(accent, DARK_SURFACE, '#ffffff'),
  };
}
