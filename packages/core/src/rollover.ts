import type { DateStr } from './date';
import type { Change, Todo } from './model';
import { todoChanges } from './recurrence';

/** Day a todo shows on: undone non-recurring todos from the past roll over to today. */
export function effectiveDate(
  todo: Pick<Todo, 'date' | 'done' | 'recurrenceId'>,
  today: DateStr,
): DateStr | null {
  return todo.date !== null && !todo.done && todo.recurrenceId === null && todo.date < today
    ? today
    : todo.date;
}

/** Completing a rolled-over todo moves it to today so it stays where it was completed. */
export function completionChanges(todo: Todo, done: boolean, today: DateStr): Change[] {
  const moved = done && effectiveDate({ ...todo, done: false }, today) !== todo.date;
  return todoChanges(todo, moved ? { done, date: today } : { done });
}
