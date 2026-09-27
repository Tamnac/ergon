import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export interface Ordered {
  id: string;
  order: string;
}

export function compareOrder(a: Ordered, b: Ordered): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Order key for inserting at `index` into sorted `siblings`.
 * If neighbours share a key (e.g. after concurrent inserts or rollover), all siblings
 * are re-keyed and returned in `rekeyed`.
 */
export function orderAt(
  siblings: readonly Ordered[],
  index: number,
): { order: string; rekeyed: Ordered[] } {
  const before = siblings[index - 1]?.order ?? null;
  const after = siblings[index]?.order ?? null;
  try {
    return { order: generateKeyBetween(before, after), rekeyed: [] };
  } catch {
    const keys = generateNKeysBetween(null, null, siblings.length + 1);
    return {
      order: keys[index]!,
      rekeyed: siblings.map((s, i) => ({ id: s.id, order: keys[i < index ? i : i + 1]! })),
    };
  }
}
