import { MAX_INK } from './model';
import { fromBase64Url, toBase64Url } from './sync/crypto';

/** In row units: the row is 100 high with y 0 at its top; pressure is 0…1. */
export type InkPoint = [x: number, y: number, pressure: number];
export type Stroke = InkPoint[];

export interface Ink {
  strokes: Stroke[];
  /** Written right to left. */
  rtl: boolean;
}

/** How closely stored ink follows the pen: `compact` also drops pressure detail. */
export type InkDetail = 'fine' | 'compact';

const VERSION = 1;
const RTL = 1;
const PRESSURE_STEPS = 15;
/** Stands in for an ink todo's text where only text fits, e.g. notifications. */
export const INK_LABEL = 'Handwritten todo';
/** How far stored ink may reach above and below the row. */
export const INK_OVERFLOW = 50;
/** Decoded ink is kept within this many row units across. */
const MAX_INK_WIDTH = 100_000;

const details = {
  fine: { tolerance: 0.5, pressureWeight: 0 },
  compact: { tolerance: 2, pressureWeight: 0.5 },
} satisfies Record<InkDetail, unknown>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Stores strokes as base64url: version, flags, stroke count, then per stroke its point count and
 * zigzag varint deltas of x, y and pressure step, carried across strokes. Simplifies harder while
 * the result is longer than `MAX_INK`. Returns '' for no points.
 */
export function encodeInk(strokes: readonly Stroke[], detail: InkDetail = 'fine'): string {
  const drawn = strokes.filter((stroke) => stroke.length > 0);
  if (drawn.length === 0) return '';
  let minX = Infinity;
  for (const stroke of drawn) for (const [x] of stroke) minX = Math.min(minX, x);
  const quantized = drawn.map((stroke) =>
    stroke
      .map(([x, y, p]): InkPoint => [
        Math.round(x - minX + 2),
        Math.round(clamp(y, -INK_OVERFLOW, 100 + INK_OVERFLOW)),
        Math.round(clamp(p, 0, 1) * PRESSURE_STEPS),
      ])
      .filter((point, i, all) => i === 0 || point.some((v, k) => v !== all[i - 1]![k])),
  );
  let { tolerance, pressureWeight } = details[detail];
  for (;;) {
    const ink = pack(quantized.map((stroke) => simplify(stroke, tolerance, pressureWeight)));
    if (ink.length <= MAX_INK || tolerance >= 64) return ink;
    tolerance *= 2;
  }
}

function pack(strokes: Stroke[]): string {
  const bytes: number[] = [];
  const uint = (n: number) => {
    for (; n > 127; n >>>= 7) bytes.push((n & 127) | 128);
    bytes.push(n);
  };
  const int = (n: number) => uint(n < 0 ? -2 * n - 1 : 2 * n);
  uint(VERSION);
  uint(isRtl(strokes) ? RTL : 0);
  uint(strokes.length);
  let [px, py, pp] = [0, 0, 0];
  for (const points of strokes) {
    uint(points.length);
    for (const [x, y, p] of points) {
      int(x - px);
      int(y - py);
      int(p - pp);
      [px, py, pp] = [x, y, p];
    }
  }
  return toBase64Url(new Uint8Array(bytes));
}

/** Null for malformed ink or a version this one doesn't know. */
export function decodeInk(ink: string): Ink | null {
  try {
    const bytes = fromBase64Url(ink);
    let at = 0;
    const uint = () => {
      let n = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        const byte = bytes[at++];
        if (byte === undefined) throw new RangeError('Truncated ink');
        n += (byte & 127) * 2 ** shift;
        if (byte < 128) return n;
      }
      throw new RangeError('Malformed ink');
    };
    const int = () => {
      const n = uint();
      return n % 2 ? -(n + 1) / 2 : n / 2;
    };
    const count = () => {
      const n = uint();
      if (n > bytes.length - at) throw new RangeError('Malformed ink');
      return n;
    };
    if (uint() !== VERSION) return null;
    const rtl = (uint() & RTL) !== 0;
    let [x, y, p] = [0, 0, 0];
    const strokes = Array.from({ length: count() }, () =>
      Array.from({ length: count() }, (): InkPoint => {
        x += int();
        y += int();
        p += int();
        return [
          clamp(x, 0, MAX_INK_WIDTH),
          clamp(y, -INK_OVERFLOW, 100 + INK_OVERFLOW),
          clamp(p / PRESSURE_STEPS, 0, 1),
        ];
      }),
    );
    return { strokes, rtl };
  } catch {
    return null;
  }
}

/**
 * Ramer–Douglas–Peucker. A point's distance combines its offset from the segment with how far
 * its pressure is from the pressure interpolated there, `pressureWeight` units per step.
 */
function simplify(points: Stroke, tolerance: number, pressureWeight: number): Stroke {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const [ax, ay, ap] = points[from]!;
    const [bx, by, bp] = points[to]!;
    const length = Math.hypot(bx - ax, by - ay);
    let max = 0;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const [x, y, p] = points[i]!;
      const offset = length
        ? Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / length
        : Math.hypot(x - ax, y - ay);
      const t = length
        ? clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length ** 2, 0, 1)
        : 0;
      const distance = Math.hypot(offset, (p - (ap + (bp - ap) * t)) * pressureWeight);
      if (distance > max) [max, index] = [distance, i];
    }
    if (max > tolerance) {
      keep[index] = 1;
      stack.push([from, index], [index, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Whether the ink progresses right to left: the sign of the rank correlation between writing
 * order and x over all points, so a late correction near the start doesn't flip it.
 */
function isRtl(strokes: readonly Stroke[]): boolean {
  const xs = strokes.flat().map(([x]) => x);
  let score = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) score += Math.sign(xs[j]! - xs[i]!);
  }
  return score < 0;
}

/** Catmull–Rom through the points, about every `step` units; pressure is interpolated linearly. */
export function resample(points: Stroke, step = 2): Stroke {
  if (points.length < 3) return points;
  const out: Stroke = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    const at = (k: 0 | 1, t: number) =>
      0.5 *
      (2 * p1[k] +
        (p2[k] - p0[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t +
        (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t * t * t);
    for (let j = 0; j < n; j++) {
      const t = j / n;
      out.push([at(0, t), at(1, t), p1[2] + (p2[2] - p1[2]) * t]);
    }
  }
  out.push(points.at(-1)!);
  return out;
}

/**
 * The parts of a stroke within x 0…`width` and the row with its overflow, cut where it crosses
 * the edges. A stroke that leaves and comes back becomes several.
 */
export function clipStroke(stroke: Stroke, width: number): Stroke[] {
  const [top, bottom] = [-INK_OVERFLOW, 100 + INK_OVERFLOW];
  const inside = ([x, y]: InkPoint) => x >= 0 && x <= width && y >= top && y <= bottom;
  /** Where the segment from `a`, inside, towards `b`, outside, crosses the edge. */
  const edge = (a: InkPoint, b: InkPoint): InkPoint => {
    let t = 1;
    for (const [k, min, max] of [
      [0, 0, width],
      [1, top, bottom],
    ] as const) {
      if (b[k] > max) t = Math.min(t, (max - a[k]) / (b[k] - a[k]));
      else if (b[k] < min) t = Math.min(t, (min - a[k]) / (b[k] - a[k]));
    }
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const parts: Stroke[] = [];
  let part: Stroke = [];
  stroke.forEach((point, i) => {
    const previous = stroke[i - 1];
    if (inside(point)) {
      if (previous && !inside(previous)) part.push(edge(point, previous));
      part.push(point);
    } else if (previous && inside(previous)) {
      part.push(edge(previous, point));
      parts.push(part);
      part = [];
    }
  });
  if (part.length) parts.push(part);
  return parts;
}

/** Whether the stroke passes within `radius` of (`x`, `y`). */
export function touches(stroke: Stroke, x: number, y: number, radius: number): boolean {
  return stroke.some(([ax, ay], i) => {
    const [bx, by] = stroke[i + 1] ?? [ax, ay];
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = length ? clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length, 0, 1) : 0;
    return Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y) < radius;
  });
}

/** Whether the strokes are a single dot, e.g. a pen tapped instead of writing. */
export function isTap(strokes: readonly Stroke[]): boolean {
  if (strokes.length !== 1) return false;
  const [x0, y0] = strokes[0]![0] ?? [0, 0];
  return strokes[0]!.every(([x, y]) => Math.hypot(x - x0, y - y0) < 3);
}

/** Width of the ink in row units, with room for the stroke's thickness. */
export function inkWidth(strokes: readonly Stroke[]): number {
  let width = 10;
  for (const stroke of strokes) for (const [x] of stroke) width = Math.max(width, x);
  return width + 6;
}
