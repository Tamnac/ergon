import type { Hlc } from './hlc';
import type { Op } from './model';

/** Last-write-wins: an op replaces the current value of its field if its clock is newer. */
export function wins(incoming: Hlc, current: Hlc | undefined): boolean {
  return current === undefined || incoming > current;
}

export function fieldKey(op: Pick<Op, 'entity' | 'id' | 'field'>): string {
  return `${op.entity}\u0000${op.id}\u0000${op.field}`;
}

/** Winning op per field. Order of `ops` does not affect the result. */
export function lww(ops: Iterable<Op>): Map<string, Op> {
  const state = new Map<string, Op>();
  for (const op of ops) {
    const key = fieldKey(op);
    if (wins(op.hlc, state.get(key)?.hlc)) state.set(key, op);
  }
  return state;
}
