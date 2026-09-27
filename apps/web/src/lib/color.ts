/** Black or white, whichever reads better on the given `#rrggbb` background. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#ffffff';
  const n = parseInt(match[1]!, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
