import { resample, type InkDetail, type Stroke } from '@ergon/core';
import { getStroke } from 'perfect-freehand';
import { persistedSignal } from './persisted';

export const [inkSmoothing, setInkSmoothing] = persistedSignal('ergon.inkSmoothing', true);
export const [inkPressure, setInkPressure] = persistedSignal('ergon.inkPressure', true);
/** Applies when ink is written; smoothing and pressure only change how it's drawn. */
export const [inkDetail, setInkDetail] = persistedSignal<InkDetail>('ergon.inkDetail', 'fine');

/** Width from pressure 0 to 1 spans 12.5% to 100% of the stroke size. */
const pressureEasing = (x: number) => 0.125 + (x - 0.125) * (7 / 6);

/** SVG path of a stroke's outline. Finished strokes are resampled and get an end cap. */
export function strokePath(stroke: Stroke, finished = true): string {
  const pressure = inkPressure();
  return toPath(
    getStroke(finished ? resample(stroke) : stroke, {
      size: 7,
      thinning: pressure ? 0.75 : 0,
      easing: pressure ? pressureEasing : (x) => x,
      smoothing: 0.5,
      streamline: inkSmoothing() ? 0.75 : 0,
      simulatePressure: false,
      last: finished,
    }),
  );
}

const average = (a: number, b: number) => ((a + b) / 2).toFixed(2);

function toPath(points: number[][]): string {
  if (points.length < 4) return '';
  const [a, b, c] = points as [number[], number[], number[]];
  let d = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(2)} ${average(b[0]!, c[0]!)},${average(b[1]!, c[1]!)} T`;
  for (let i = 2; i < points.length - 1; i++) {
    const [p, q] = [points[i]!, points[i + 1]!];
    d += `${average(p[0]!, q[0]!)},${average(p[1]!, q[1]!)} `;
  }
  return d + 'Z';
}
