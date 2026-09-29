import type { DateStr } from './date';
import type { Change, Entity, List, ListGroup, Recurrence, Settings, Todo } from './model';

export type ChangeListener = (entities: ReadonlySet<Entity>) => void;

/** A todo reduced to what the month calendar draws. `length` is the text length. */
export interface TodoMark {
  id: string;
  date: DateStr;
  done: boolean;
  length: number;
}

/** What the UI needs from local storage, independent of the SQLite backend. */
export interface Storage {
  /** Stamps and applies changes; resolves with the changes that undo them. */
  write(changes: readonly Change[]): Promise<Change[]>;
  /**
   * Todos dated in `[from, to]` including virtual occurrences, plus undone past todos that
   * roll over if `today` is in range.
   */
  todosBetween(from: DateStr, to: DateStr, today: DateStr): Promise<Todo[]>;
  /** Marks for todos (not headings) whose effective date is in `[from, to]`. */
  todoMarks(from: DateStr, to: DateStr, today: DateStr): Promise<TodoMark[]>;
  listTodos(): Promise<Todo[]>;
  recurrences(): Promise<Recurrence[]>;
  /** Stored occurrences of a recurrence, including skipped ones. */
  seriesTodos(recurrenceId: string): Promise<Todo[]>;
  lists(): Promise<List[]>;
  listGroups(): Promise<ListGroup[]>;
  settings(): Promise<Settings>;
  subscribe(listener: ChangeListener): () => void;
}
