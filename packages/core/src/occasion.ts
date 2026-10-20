import type { Todo } from './model';

/** What a completion finishes: one todo, the todos under a heading, or a whole day or list. */
export type Occasion = 'todo' | 'section' | 'column';

/** A section or column needs this many todos to be worth celebrating. */
export const MILESTONE_MIN = 2;

type Item = Pick<Todo, 'id' | 'done' | 'kind'>;

/**
 * What completing todo `id` finishes, given the todos of its day or list in display order.
 * A section is the todos between a heading and the next one; todos before the first heading
 * belong to no section.
 */
export function completionOccasion(items: readonly Item[], id: string): Occasion {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return 'todo';
  const finished = (range: readonly Item[]) => {
    const todos = range.filter((item) => item.kind === 'todo');
    return todos.length >= MILESTONE_MIN && todos.every((item) => item.done || item.id === id);
  };

  if (finished(items)) return 'column';
  const heading = items.slice(0, index).findLastIndex((item) => item.kind === 'heading');
  if (heading < 0) return 'todo';
  const next = items.findIndex((item, i) => i > index && item.kind === 'heading');
  return finished(items.slice(heading + 1, next < 0 ? items.length : next)) ? 'section' : 'todo';
}
