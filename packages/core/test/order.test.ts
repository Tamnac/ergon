import { describe, expect, it } from 'vitest';
import { compareOrder, orderAt, type Ordered } from '../src';

function insert(items: Ordered[], index: number, id: string): Ordered[] {
  const { order, rekeyed } = orderAt(items, index);
  const updated = items.map((item) => rekeyed.find((r) => r.id === item.id) ?? item);
  return [...updated, { id, order }].toSorted(compareOrder);
}

describe('orderAt', () => {
  it('inserts at start, middle and end', () => {
    let items: Ordered[] = [];
    items = insert(items, 0, 'b');
    items = insert(items, 0, 'a');
    items = insert(items, 2, 'd');
    items = insert(items, 2, 'c');
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps order over many inserts at the same spot', () => {
    let items: Ordered[] = [];
    for (let i = 0; i < 200; i++) items = insert(items, 1, `x${i}`);
    expect(items).toHaveLength(200);
    expect(items.map((i) => i.id).slice(0, 3)).toEqual(['x0', 'x199', 'x198']);
    expect(items.at(-1)!.id).toBe('x1');
  });

  it('re-keys siblings when neighbours share a key', () => {
    const items = [
      { id: 'a', order: 'a0' },
      { id: 'b', order: 'a0' },
    ];
    const { order, rekeyed } = orderAt(items, 1);
    expect(rekeyed).toHaveLength(2);
    const result = [...rekeyed, { id: 'new', order }].toSorted(compareOrder);
    expect(result.map((i) => i.id)).toEqual(['a', 'new', 'b']);
  });
});
