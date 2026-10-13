import { describe, expect, it } from 'vitest';
import {
  clipStroke,
  decodeInk,
  encodeInk,
  inkWidth,
  isTap,
  MAX_INK,
  resample,
  toBase64Url,
  touches,
  type Stroke,
} from '../src';

const line = (from: number, to: number, y: number, steps = 20): Stroke =>
  Array.from({ length: steps + 1 }, (_, i) => [from + ((to - from) * i) / steps, y, 0.5]);

describe('ink encoding', () => {
  it('round trips quantized points, shifted to start at x 2', () => {
    const strokes: Stroke[] = [
      [
        [40.4, 10.2, 0.2],
        [60, 90, 1],
      ],
      [[70, 20, 0]],
    ];
    expect(decodeInk(encodeInk(strokes))).toEqual({
      strokes: [
        [
          [2, 10, 3 / 15],
          [22, 90, 1],
        ],
        [[32, 20, 0]],
      ],
      rtl: false,
    });
  });

  it('clamps y to the overflow around the row and drops repeated points', () => {
    const ink = decodeInk(
      encodeInk([
        [
          [0, -80, 0.5],
          [0, -80, 0.5],
          [5, 300, 0.5],
        ],
      ]),
    );
    expect(ink?.strokes).toEqual([
      [
        [2, -50, 0.5333333333333333],
        [7, 150, 0.5333333333333333],
      ],
    ]);
  });

  it('simplifies straight lines to their ends', () => {
    expect(decodeInk(encodeInk([line(0, 300, 50)]))?.strokes[0]).toHaveLength(2);
  });

  it('keeps pressure changes only in fine detail', () => {
    const stroke: Stroke = line(0, 100, 50).map(([x, y], i) => [x, y, i % 2 ? 1 : 0.2]);
    const points = (detail: 'fine' | 'compact') =>
      decodeInk(encodeInk([stroke], detail))!.strokes[0]!.length;
    expect(points('fine')).toBe(2);
    expect(points('compact')).toBeGreaterThan(2);
    const wobbly: Stroke = line(0, 100, 50).map(([x, y, p], i) => [x, y + (i % 2), p]);
    expect(decodeInk(encodeInk([wobbly], 'fine'))!.strokes[0]!.length).toBeGreaterThan(
      decodeInk(encodeInk([wobbly], 'compact'))!.strokes[0]!.length,
    );
  });

  it('detects right-to-left writing despite a correction at the start', () => {
    const words = [line(300, 200, 40), line(180, 80, 60)];
    expect(decodeInk(encodeInk(words))?.rtl).toBe(true);
    expect(decodeInk(encodeInk([line(0, 100, 40), line(120, 300, 60), line(0, 10, 20)]))?.rtl).toBe(
      false,
    );
  });

  it('encodes no points as empty', () => {
    expect(encodeInk([])).toBe('');
    expect(encodeInk([[]])).toBe('');
  });

  it('simplifies harder to stay within MAX_INK', () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const scribble: Stroke[] = Array.from({ length: 60 }, () =>
      Array.from({ length: 200 }, (_, i) => [i * 3 + random() * 40, random() * 100, random()]),
    );
    expect(encodeInk(scribble).length).toBeLessThanOrEqual(MAX_INK);
  });

  it('rejects malformed ink and unknown versions', () => {
    const ink = encodeInk([line(0, 100, 50)]);
    expect(decodeInk('')).toBeNull();
    expect(decodeInk('!!')).toBeNull();
    expect(decodeInk(ink.slice(0, -2))).toBeNull();
    expect(decodeInk(toBase64Url(new Uint8Array([2, 0, 0])))).toBeNull();
    expect(decodeInk(toBase64Url(new Uint8Array([1, 0, 100])))).toBeNull();
  });
});

describe('ink geometry', () => {
  it('resamples between points and keeps the ends', () => {
    const stroke: Stroke = [
      [0, 0, 0],
      [10, 0, 1],
      [20, 10, 1],
    ];
    const out = resample(stroke);
    expect(out[0]).toEqual([0, 0, 0]);
    expect(out.at(-1)).toEqual([20, 10, 1]);
    expect(out.length).toBeGreaterThan(10);
    expect(out[2]![2]).toBeCloseTo(0.4);
  });

  it('finds strokes near a point, between their points too', () => {
    const stroke = line(0, 100, 50, 1);
    expect(touches(stroke, 50, 55, 8)).toBe(true);
    expect(touches(stroke, 50, 60, 8)).toBe(false);
    expect(touches([[10, 10, 0]], 12, 12, 8)).toBe(true);
  });

  it('cuts strokes off at the edges, splitting where they leave and come back', () => {
    const stroke: Stroke = [
      [50, 50, 0.5],
      [150, 50, 0.5],
      [150, 250, 0.5],
      [50, 250, 0.5],
      [50, 100, 0.5],
      [60, 100, 0.5],
    ];
    expect(clipStroke(stroke, 100)).toEqual([
      [
        [50, 50, 0.5],
        [100, 50, 0.5],
      ],
      [
        [50, 150, 0.5],
        [50, 100, 0.5],
        [60, 100, 0.5],
      ],
    ]);
    expect(clipStroke(line(0, 100, 50), 100)).toEqual([line(0, 100, 50)]);
    expect(clipStroke(line(120, 200, 50), 100)).toEqual([]);
  });

  it('tells taps from writing', () => {
    expect(isTap([[[10, 10, 0.5]]])).toBe(true);
    expect(isTap([line(10, 11, 50, 3)])).toBe(true);
    expect(isTap([line(10, 30, 50)])).toBe(false);
    expect(isTap([[[10, 10, 0.5]], [[40, 10, 0.5]]])).toBe(false);
    expect(isTap([])).toBe(false);
  });

  it('measures width with room for the stroke', () => {
    expect(
      inkWidth([
        [
          [2, 0, 0],
          [80, 0, 0],
        ],
      ]),
    ).toBe(86);
    expect(inkWidth([])).toBe(16);
  });
});
