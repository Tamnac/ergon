import { describe, expect, it } from 'vitest';
import { formatHlc, lww, type Op } from '../src';
import { rng, shuffle } from './random';

function randomOps(random: () => number, count: number): Op[] {
  const fields = ['text', 'done', 'date'] as const;
  return Array.from({ length: count }, (_, i) => ({
    entity: 'todo',
    id: `t${Math.floor(random() * 3)}`,
    field: fields[Math.floor(random() * fields.length)]!,
    value: `v${i}`,
    hlc: formatHlc(Math.floor(random() * 20), Math.floor(random() * 3), `n${i}`),
  }));
}

describe('lww', () => {
  it('keeps the newest op per field', () => {
    const ops: Op[] = [
      { entity: 'todo', id: 'a', field: 'text', value: 'new', hlc: formatHlc(2, 0, 'x') },
      { entity: 'todo', id: 'a', field: 'text', value: 'old', hlc: formatHlc(1, 0, 'x') },
    ];
    expect([...lww(ops).values()].map((op) => op.value)).toEqual(['new']);
  });

  it('is independent of op order', () => {
    const random = rng(42);
    for (let round = 0; round < 50; round++) {
      const ops = randomOps(random, 30);
      const expected = lww(ops);
      for (let i = 0; i < 5; i++) expect(lww(shuffle(ops, random))).toEqual(expected);
    }
  });
});
