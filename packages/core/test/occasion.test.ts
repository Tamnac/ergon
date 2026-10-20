import { describe, expect, it } from 'vitest';
import { completionOccasion } from '../src';

/** 't' is a todo, 'T' a done todo, '#' a heading; ids are the positions. */
const items = (layout: string) =>
  [...layout].map((char, i) => ({
    id: String(i),
    done: char === 'T',
    kind: char === '#' ? ('heading' as const) : ('todo' as const),
  }));

const occasion = (layout: string, index: number) =>
  completionOccasion(items(layout), String(index));

describe('completionOccasion', () => {
  it('is a plain todo while others are left', () => {
    expect(occasion('ttt', 0)).toBe('todo');
    expect(occasion('Ttt', 1)).toBe('todo');
  });

  it('finishes a column with its last undone todo', () => {
    expect(occasion('TTt', 2)).toBe('column');
    expect(occasion('#TTt', 3)).toBe('column');
    expect(occasion('T#Tt#', 3)).toBe('column');
  });

  it('does not celebrate a column of one todo', () => {
    expect(occasion('t', 0)).toBe('todo');
    expect(occasion('#t', 1)).toBe('todo');
  });

  it('finishes a section with the last undone todo under its heading', () => {
    expect(occasion('#Tt#t', 2)).toBe('section');
    expect(occasion('t#Tt#tt', 3)).toBe('section');
    expect(occasion('#Tt', 2)).toBe('column');
  });

  it('ignores todos before the first heading and in other sections', () => {
    expect(occasion('tt#t', 3)).toBe('todo');
    expect(occasion('#Tt#t', 4)).toBe('todo');
    expect(occasion('#tt', 1)).toBe('todo');
  });

  it('is a plain todo for unknown ids', () => {
    expect(completionOccasion(items('TT'), 'x')).toBe('todo');
  });
});
