import type { DateStr } from './date';
import { patch, type Change, type Todo } from './model';

/** Day a todo shows on: undone todos from the past roll over to today. */
export function effectiveDate(todo: Pick<Todo, 'date' | 'done'>, today: DateStr): DateStr | null {
  return todo.date !== null && !todo.done && todo.date < today ? today : todo.date;
}

/** Completing a rolled-over todo moves it to today so it stays where it was completed. */
export function completionChanges(
  todo: Pick<Todo, 'id' | 'date'>,
  done: boolean,
  today: DateStr,
): Change[] {
  const moved = done && todo.date !== null && todo.date < today;
  return patch('todo', todo.id, moved ? { done, date: today } : { done });
}
